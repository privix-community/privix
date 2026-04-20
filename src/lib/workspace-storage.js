/**
 * Privix Community — Workspace 隔离:localStorage 命名空间 monkey-patch
 *
 * 原理:
 *   每个 workspace 一个命名空间(default 用 bare key,其他 workspace 用 `pcws.<id>.` 前缀)。
 *   通过覆写 localStorage.getItem/setItem/removeItem,对除了"全局键"以外的所有 key 自动加/去前缀。
 *
 *   这样已有代码(`localStorage.getItem('some-key')`)无需改动,切换 workspace 即自动读到对应命名空间数据。
 *   Default workspace 保持裸键,已安装用户升级后不会丢数据。
 *
 * 加载时机:必须在 src/main.js 最顶部 import,早于其他模块任何 localStorage 访问。
 */

const ACTIVE_KEY = 'privix-community-active-workspace'
const META_KEY = 'privix-community-workspaces'
const DEFAULT_WORKSPACE_ID = 'default'
const NAMESPACE_PREFIX = 'pcws.'

// 这些键永远不走命名空间(跨 workspace 共享)
const GLOBAL_KEYS = new Set([
  ACTIVE_KEY,
  META_KEY,
  'privix-community-locale',
  'privix-community-theme-preset',
  'privix-community-user-css-enabled',
  'privix-community-user-css',
])

// 监听 workspace 切换,供 UI 层订阅
const _listeners = new Set()

// monkey-patch 前保存的原生方法引用 — install 后由 installWorkspaceStorage 覆写
let _rawStorage = null
let _patched = false
let rawGet = (key) => (_rawStorage ? _rawStorage.getItem(key) : null)
let rawSet = (key, value) => (_rawStorage ? _rawStorage.setItem(key, value) : undefined)
let rawRemove = (key) => (_rawStorage ? _rawStorage.removeItem(key) : undefined)

/**
 * 获取当前活跃 workspace ID。未设置则回退到 'default'。
 */
export function getActiveWorkspaceId() {
  if (!_rawStorage) return DEFAULT_WORKSPACE_ID
  return rawGet(ACTIVE_KEY) || DEFAULT_WORKSPACE_ID
}

/**
 * 设置活跃 workspace ID(不校验是否存在 — 调用方负责)。
 * 不自动 reload,调用方决定是否刷新 UI。
 */
export function setActiveWorkspaceId(id) {
  const wsId = id || DEFAULT_WORKSPACE_ID
  rawSet(ACTIVE_KEY, wsId)
  for (const fn of _listeners) { try { fn(wsId) } catch { /* noop */ } }
}

export function onWorkspaceChange(fn) {
  _listeners.add(fn)
  return () => _listeners.delete(fn)
}

function transformKey(key) {
  if (GLOBAL_KEYS.has(key)) return key
  const wsId = getActiveWorkspaceId()
  if (wsId === DEFAULT_WORKSPACE_ID) return key
  return `${NAMESPACE_PREFIX}${wsId}.${key}`
}

/**
 * 安装 monkey-patch。幂等,重复调用无害。
 */
export function installWorkspaceStorage() {
  if (_patched) return
  const target = _rawStorage || (typeof window !== 'undefined' ? window.localStorage : null)
  if (!target) return
  _rawStorage = target
  const orig = {
    getItem: target.getItem.bind(target),
    setItem: target.setItem.bind(target),
    removeItem: target.removeItem.bind(target),
  }
  target.getItem = (k) => orig.getItem(transformKey(k))
  target.setItem = (k, v) => orig.setItem(transformKey(k), v)
  target.removeItem = (k) => orig.removeItem(transformKey(k))
  rawGet = orig.getItem
  rawSet = orig.setItem
  rawRemove = orig.removeItem
  _patched = true
}

/**
 * 删除某 workspace 的所有 namespaced 数据(用于"删除工作区"操作)。
 * Default workspace 不能这样删 — 需手动清理 bare key(上层调用者决定策略)。
 */
export function purgeWorkspaceData(workspaceId) {
  if (!_rawStorage || !workspaceId || workspaceId === DEFAULT_WORKSPACE_ID) return 0
  const prefix = `${NAMESPACE_PREFIX}${workspaceId}.`
  const keysToRemove = []
  for (let i = 0; i < _rawStorage.length; i++) {
    const k = _rawStorage.key(i)
    if (k && k.startsWith(prefix)) keysToRemove.push(k)
  }
  for (const k of keysToRemove) rawRemove(k)
  return keysToRemove.length
}

/**
 * 暴露给测试:允许注入 mock localStorage。生产代码不要用。
 * 调用后仍需 installWorkspaceStorage() 才会真正 patch mock。
 */
export function __setRawStorageForTest(storage) {
  _rawStorage = storage
  _patched = false
}
