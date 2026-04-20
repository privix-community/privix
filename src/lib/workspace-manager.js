/**
 * Privix Community — Workspace CRUD 管理
 *
 * Workspace 语义:一个隔离的工作空间 — 自己的聊天会话、助手会话、设置(部分)、敏感检测配置等。
 * Default workspace 使用裸 localStorage 键(兼容老用户);其他 workspace 有 `pcws.<id>.` 前缀。
 *
 * 本模块提供 UI 层可用的 API,底层命名空间切换由 workspace-storage.js 负责。
 */

import { getActiveWorkspaceId, setActiveWorkspaceId, purgeWorkspaceData } from './workspace-storage.js'

const META_KEY = 'privix-community-workspaces'
const DEFAULT_WORKSPACE_ID = 'default'
const DEFAULT_WORKSPACE_NAME = '默认工作区'
const MAX_NAME_LENGTH = 40

function readMeta() {
  try {
    const raw = window.localStorage.getItem(META_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    return parsed.filter(ws => ws && typeof ws.id === 'string' && typeof ws.name === 'string')
  } catch {
    return null
  }
}

function writeMeta(list) {
  window.localStorage.setItem(META_KEY, JSON.stringify(list))
}

/**
 * 返回所有 workspace 列表,default 恒在首位。若不存在 default 则自动创建。
 */
export function listWorkspaces() {
  let list = readMeta()
  if (!list || list.length === 0) {
    list = [{ id: DEFAULT_WORKSPACE_ID, name: DEFAULT_WORKSPACE_NAME, createdAt: Date.now() }]
    writeMeta(list)
  } else if (!list.find(ws => ws.id === DEFAULT_WORKSPACE_ID)) {
    list.unshift({ id: DEFAULT_WORKSPACE_ID, name: DEFAULT_WORKSPACE_NAME, createdAt: Date.now() })
    writeMeta(list)
  }
  return list
}

export function getCurrentWorkspace() {
  const id = getActiveWorkspaceId()
  const list = listWorkspaces()
  return list.find(ws => ws.id === id) || list[0]
}

function genId() {
  const t = Date.now().toString(36)
  const r = Math.random().toString(36).slice(2, 8)
  return `ws-${t}-${r}`
}

/**
 * 创建并切换到新 workspace。不刷新页面 — 调用方决定是否 reload。
 * @returns {{id: string, name: string, createdAt: number}} 新 workspace
 */
export function createWorkspace(rawName) {
  const name = String(rawName || '').trim().slice(0, MAX_NAME_LENGTH) || `工作区 ${new Date().toLocaleDateString()}`
  const list = listWorkspaces()
  const ws = { id: genId(), name, createdAt: Date.now() }
  list.push(ws)
  writeMeta(list)
  setActiveWorkspaceId(ws.id)
  return ws
}

export function renameWorkspace(id, rawName) {
  const name = String(rawName || '').trim().slice(0, MAX_NAME_LENGTH)
  if (!name) return false
  const list = listWorkspaces()
  const ws = list.find(w => w.id === id)
  if (!ws) return false
  ws.name = name
  writeMeta(list)
  return true
}

/**
 * 删除 workspace。Default 不可删除。删除当前 workspace 会切回 default。
 */
export function deleteWorkspace(id) {
  if (!id || id === DEFAULT_WORKSPACE_ID) return false
  const list = listWorkspaces()
  const idx = list.findIndex(w => w.id === id)
  if (idx < 0) return false
  list.splice(idx, 1)
  writeMeta(list)
  purgeWorkspaceData(id)
  if (getActiveWorkspaceId() === id) setActiveWorkspaceId(DEFAULT_WORKSPACE_ID)
  return true
}

export function switchWorkspace(id) {
  const list = listWorkspaces()
  if (!list.find(w => w.id === id)) return false
  setActiveWorkspaceId(id)
  return true
}

export { DEFAULT_WORKSPACE_ID, DEFAULT_WORKSPACE_NAME }
