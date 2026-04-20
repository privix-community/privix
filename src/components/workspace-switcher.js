/**
 * Workspace 切换器组件
 * 位于 sidebar 顶部,点击弹出:当前 workspace 列表 + 新建 / 重命名 / 删除
 * 切换后强制 reload,让所有模块用新命名空间重新加载数据。
 */

import {
  listWorkspaces, getCurrentWorkspace, switchWorkspace,
  createWorkspace, renameWorkspace, deleteWorkspace, DEFAULT_WORKSPACE_ID,
} from '../lib/workspace-manager.js'
import { showModal, showConfirm } from './modal.js'
import { toast } from './toast.js'

function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function renderWorkspaceSwitcher() {
  const current = getCurrentWorkspace()
  return `
    <div class="workspace-switcher" id="workspace-switcher">
      <button type="button" class="workspace-current" id="btn-workspace-toggle" title="${escHtml(current.name)}">
        <span class="workspace-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg></span>
        <span class="workspace-label">${escHtml(current.name)}</span>
        <svg class="workspace-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M6 9l6 6 6-6"/></svg>
      </button>
      <div class="workspace-dropdown" id="workspace-dropdown" hidden></div>
    </div>
  `
}

function renderDropdownMenu() {
  const list = listWorkspaces()
  const current = getCurrentWorkspace()
  const items = list.map(ws => {
    const active = ws.id === current.id ? ' workspace-item-active' : ''
    return `<button type="button" class="workspace-item${active}" data-workspace-id="${escHtml(ws.id)}">
      <span class="workspace-item-name">${escHtml(ws.name)}</span>
      ${ws.id === current.id ? '<span class="workspace-item-check" aria-hidden="true">✓</span>' : ''}
    </button>`
  }).join('')

  const canDelete = current.id !== DEFAULT_WORKSPACE_ID
  return `
    <div class="workspace-dropdown-list">${items}</div>
    <div class="workspace-dropdown-divider"></div>
    <button type="button" class="workspace-action" data-action="create-workspace">
      <span>+ 新建工作区</span>
    </button>
    <button type="button" class="workspace-action" data-action="rename-workspace" ${canDelete ? '' : 'disabled'}>
      <span>✏ 重命名当前</span>
    </button>
    <button type="button" class="workspace-action workspace-action-danger" data-action="delete-workspace" ${canDelete ? '' : 'disabled'}>
      <span>🗑 删除当前</span>
    </button>
  `
}

function closeDropdown(dropdown) {
  if (!dropdown) return
  dropdown.hidden = true
  dropdown.classList.remove('workspace-dropdown-open')
}

function openDropdown(dropdown) {
  dropdown.innerHTML = renderDropdownMenu()
  dropdown.hidden = false
  dropdown.classList.add('workspace-dropdown-open')
}

/**
 * 绑定 switcher 事件。必须在 sidebar 渲染后调用一次。
 * 提供 onSwitched 回调用于切换后重渲染 / reload。
 */
export function bindWorkspaceSwitcher(sidebarEl, { onSwitched } = {}) {
  const toggleBtn = sidebarEl.querySelector('#btn-workspace-toggle')
  const dropdown = sidebarEl.querySelector('#workspace-dropdown')
  if (!toggleBtn || !dropdown) return

  const doSwitch = (id) => {
    const current = getCurrentWorkspace()
    if (id === current.id) { closeDropdown(dropdown); return }
    if (!switchWorkspace(id)) { toast('切换失败', 'error'); return }
    closeDropdown(dropdown)
    if (onSwitched) onSwitched(id)
    else window.location.reload()
  }

  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    if (dropdown.hidden) openDropdown(dropdown)
    else closeDropdown(dropdown)
  })

  dropdown.addEventListener('click', (e) => {
    const item = e.target.closest('.workspace-item')
    if (item) { doSwitch(item.dataset.workspaceId); return }

    const action = e.target.closest('.workspace-action')?.dataset?.action
    if (!action) return
    e.stopPropagation()

    if (action === 'create-workspace') {
      closeDropdown(dropdown)
      showModal({
        title: '新建工作区',
        fields: [{ name: 'name', label: '工作区名称', value: '', placeholder: '例:客户项目 · 研究专用' }],
        onConfirm: (result) => {
          const ws = createWorkspace(result.name)
          toast(`已创建「${ws.name}」,切换中...`, 'success')
          setTimeout(() => { if (onSwitched) onSwitched(ws.id); else window.location.reload() }, 300)
        },
      })
      return
    }

    if (action === 'rename-workspace') {
      const current = getCurrentWorkspace()
      if (current.id === DEFAULT_WORKSPACE_ID) return
      closeDropdown(dropdown)
      showModal({
        title: '重命名工作区',
        fields: [{ name: 'name', label: '新名称', value: current.name }],
        onConfirm: (result) => {
          if (renameWorkspace(current.id, result.name)) toast('已重命名', 'success')
        },
      })
      return
    }

    if (action === 'delete-workspace') {
      const current = getCurrentWorkspace()
      if (current.id === DEFAULT_WORKSPACE_ID) return
      closeDropdown(dropdown)
      showConfirm(`确认删除工作区「${current.name}」?该工作区的所有会话、配置、缓存将被清除。此操作不可撤销。`).then(ok => {
        if (!ok) return
        const name = current.name
        deleteWorkspace(current.id)
        toast(`已删除「${name}」`, 'info')
        setTimeout(() => { if (onSwitched) onSwitched(DEFAULT_WORKSPACE_ID); else window.location.reload() }, 300)
      })
    }
  })

  // 点击其他区域关闭下拉
  const outsideClose = (e) => {
    if (!sidebarEl.contains(e.target)) closeDropdown(dropdown)
    else if (!e.target.closest('#workspace-switcher')) closeDropdown(dropdown)
  }
  document.addEventListener('click', outsideClose)

  // 返回清理函数(给 cleanup 用)
  return () => document.removeEventListener('click', outsideClose)
}
