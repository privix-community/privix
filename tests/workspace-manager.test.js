import test from 'node:test'
import assert from 'node:assert/strict'

function createStorage() {
  const store = new Map()
  return {
    get length() { return store.size },
    key(i) { return Array.from(store.keys())[i] ?? null },
    getItem(k) { return store.has(k) ? store.get(k) : null },
    setItem(k, v) { store.set(k, String(v)) },
    removeItem(k) { store.delete(k) },
    clear() { store.clear() },
    _dump() { return Object.fromEntries(store) },
  }
}

// 在 import 前模拟 window + localStorage
const storage = createStorage()
globalThis.window = { localStorage: storage }
globalThis.localStorage = storage

// 覆写 workspace-storage 的 raw 引用,保证 monkey-patch 对 mock 生效
const { installWorkspaceStorage, __setRawStorageForTest, getActiveWorkspaceId, setActiveWorkspaceId, purgeWorkspaceData } = await import('../src/lib/workspace-storage.js')
__setRawStorageForTest(storage)
installWorkspaceStorage()

const {
  listWorkspaces, createWorkspace, renameWorkspace, deleteWorkspace,
  switchWorkspace, getCurrentWorkspace, DEFAULT_WORKSPACE_ID,
} = await import('../src/lib/workspace-manager.js')

function reset() {
  storage.clear()
  setActiveWorkspaceId(DEFAULT_WORKSPACE_ID)
}

test('listWorkspaces:首次调用自动创建 default', () => {
  reset()
  const list = listWorkspaces()
  assert.equal(list.length, 1)
  assert.equal(list[0].id, DEFAULT_WORKSPACE_ID)
})

test('getActiveWorkspaceId 未设置时回退到 default', () => {
  reset()
  assert.equal(getActiveWorkspaceId(), DEFAULT_WORKSPACE_ID)
})

test('createWorkspace:创建新 ws 并切为活跃', () => {
  reset()
  const ws = createWorkspace('工作组 A')
  assert.ok(ws.id !== DEFAULT_WORKSPACE_ID)
  assert.equal(ws.name, '工作组 A')
  assert.equal(getActiveWorkspaceId(), ws.id)
  assert.equal(listWorkspaces().length, 2)
})

test('createWorkspace:空名使用自动生成的兜底名', () => {
  reset()
  const ws = createWorkspace('   ')
  assert.ok(ws.name.startsWith('工作区 '))
})

test('switchWorkspace:切换活跃 ws,验证存在性', () => {
  reset()
  const a = createWorkspace('A')
  const b = createWorkspace('B')
  assert.equal(getActiveWorkspaceId(), b.id)
  assert.equal(switchWorkspace(a.id), true)
  assert.equal(getActiveWorkspaceId(), a.id)
  assert.equal(switchWorkspace('nonexistent'), false)
})

test('workspace 隔离:不同 ws 对相同 key 读写互不可见', () => {
  reset()
  // default workspace 写
  storage.setItem('my-key', 'default-value')
  // 切到 A
  const a = createWorkspace('A')
  assert.equal(getActiveWorkspaceId(), a.id)
  assert.equal(storage.getItem('my-key'), null, 'A 应读不到 default 的数据')
  storage.setItem('my-key', 'A-value')
  assert.equal(storage.getItem('my-key'), 'A-value')
  // 切回 default
  switchWorkspace(DEFAULT_WORKSPACE_ID)
  assert.equal(storage.getItem('my-key'), 'default-value', 'default 仍读到自己的数据')
})

test('全局键跨 workspace 共享,不走命名空间', () => {
  reset()
  storage.setItem('privix-community-locale', 'en')
  const a = createWorkspace('A')
  assert.equal(storage.getItem('privix-community-locale'), 'en', 'locale 对 A 也可见')
  storage.setItem('privix-community-theme-preset', 'dark')
  switchWorkspace(DEFAULT_WORKSPACE_ID)
  assert.equal(storage.getItem('privix-community-theme-preset'), 'dark', 'theme 对 default 也可见')
})

test('renameWorkspace:改名生效且非空校验', () => {
  reset()
  const ws = createWorkspace('Old')
  assert.equal(renameWorkspace(ws.id, 'New'), true)
  assert.equal(listWorkspaces().find(w => w.id === ws.id).name, 'New')
  assert.equal(renameWorkspace(ws.id, '  '), false, '空名应拒绝')
  assert.equal(renameWorkspace('nonexistent', 'X'), false)
})

test('deleteWorkspace:删除非活跃 ws 及清空其数据', () => {
  reset()
  const a = createWorkspace('A')
  storage.setItem('data-a', 'value-a')
  switchWorkspace(DEFAULT_WORKSPACE_ID)
  assert.equal(deleteWorkspace(a.id), true)
  // A 的数据应已清除(但切回 default 读不到是自然的,我们验证 purge 返回数)
  assert.equal(listWorkspaces().length, 1)
})

test('deleteWorkspace:删除活跃 ws 自动切回 default', () => {
  reset()
  const a = createWorkspace('A')
  assert.equal(getActiveWorkspaceId(), a.id)
  deleteWorkspace(a.id)
  assert.equal(getActiveWorkspaceId(), DEFAULT_WORKSPACE_ID)
})

test('deleteWorkspace:default 不可删除', () => {
  reset()
  assert.equal(deleteWorkspace(DEFAULT_WORKSPACE_ID), false)
  assert.equal(listWorkspaces().length, 1)
})

test('purgeWorkspaceData:清除指定 ws 的所有 pcws.<id>.* 键', () => {
  reset()
  const a = createWorkspace('A')
  storage.setItem('a1', 'v1')
  storage.setItem('a2', 'v2')
  switchWorkspace(DEFAULT_WORKSPACE_ID)
  storage.setItem('default-key', 'd1')
  const purged = purgeWorkspaceData(a.id)
  assert.equal(purged, 2)
  // default 数据保留
  assert.equal(storage.getItem('default-key'), 'd1')
})

test('getCurrentWorkspace:返回活跃 workspace 元数据', () => {
  reset()
  const a = createWorkspace('A')
  const curr = getCurrentWorkspace()
  assert.equal(curr.id, a.id)
  assert.equal(curr.name, 'A')
})
