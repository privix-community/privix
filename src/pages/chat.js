/**
 * 聊天页面 - 完整版，对接 OpenClaw Gateway
 * 支持：流式响应、Markdown 渲染、会话管理、Agent 选择、快捷指令
 */
import { api, invalidate } from '../lib/tauri-api.js'
import { navigate } from '../router.js'
import { wsClient, uuid, WsClient } from '../lib/ws-client.js'
import { renderMarkdown } from '../lib/markdown.js'
import { saveMessages, getLocalMessages, isStorageAvailable } from '../lib/message-db.js'
import {
  initSessionStore, setConnectionState, getCachedMessages, syncWithGateway,
  cacheOutboundMessage, cacheInboundMessage,
} from '../lib/session-store.js'
import { toast } from '../components/toast.js'
import { showModal, showConfirm } from '../components/modal.js'
import { icon as svgIcon } from '../lib/icons.js'
import {
  createStreamRenderController,
  isNearBottom,
  shouldForceStreamingRefresh,
} from '../lib/chat-streaming.js'
import { extractGatewayChatContent, mergeGatewayChatState, normalizeGatewayChatEvent } from '../lib/chat-event-compat.js'
import {
  buildChatMessageGroups,
  dedupeHistoryMessages,
  normalizeChatMessage,
} from '../lib/chat-message-view.js'
import { bindCompositionState, createCompositionState, shouldSubmitOnEnter, bindCopyButtons } from '../lib/input-helpers.js'
import { t } from '../lib/i18n.js'
import { checkAndResolveSensitive } from '../lib/sensitive-detect.js'
// Storage key migration: read old key if new key is absent
function migrateLocalStorage(newKey, oldKey) {
  if (localStorage.getItem(newKey) === null && localStorage.getItem(oldKey) !== null) {
    localStorage.setItem(newKey, localStorage.getItem(oldKey))
  }
}
migrateLocalStorage('privix-community-last-session', 'clawpanel-last-session')
migrateLocalStorage('privix-community-chat-selected-model', 'clawpanel-chat-selected-model')
migrateLocalStorage('privix-community-chat-sidebar-open', 'clawpanel-chat-sidebar-open')
migrateLocalStorage('privix-community-chat-session-names', 'clawpanel-chat-session-names')
migrateLocalStorage('privix-community-guide-chat-dismissed', 'clawpanel-guide-chat-dismissed')

const STORAGE_SESSION_KEY = 'privix-community-last-session'
const STORAGE_MODEL_KEY = 'privix-community-chat-selected-model'
const STORAGE_SIDEBAR_KEY = 'privix-community-chat-sidebar-open'
const STORAGE_SESSION_NAMES_KEY = 'privix-community-chat-session-names'
const STORAGE_FAST_MODE_KEY = 'privix-community-chat-fast-sessions'

// 快捷指令数据：延迟求值，避免模块顶层调用 t()
function getCommands() {
  return [
    { title: t('pages.chat.cmd_session'), commands: [
      { cmd: '/new', desc: t('pages.chat.cmd_new'), action: 'exec' },
      { cmd: '/reset', desc: t('pages.chat.cmd_reset'), action: 'exec' },
      { cmd: '/stop', desc: t('pages.chat.cmd_stop'), action: 'exec' },
    ]},
    { title: t('pages.chat.cmd_model'), commands: [
      { cmd: '/model ', desc: t('pages.chat.cmd_model_switch'), action: 'fill' },
      { cmd: '/model list', desc: t('pages.chat.cmd_model_list'), action: 'exec' },
      { cmd: '/model status', desc: t('pages.chat.cmd_model_status'), action: 'exec' },
    ]},
    { title: t('pages.chat.cmd_think'), commands: [
      { cmd: '/think off', desc: t('pages.chat.cmd_think_off'), action: 'exec' },
      { cmd: '/think low', desc: t('pages.chat.cmd_think_low'), action: 'exec' },
      { cmd: '/think medium', desc: t('pages.chat.cmd_think_medium'), action: 'exec' },
      { cmd: '/think high', desc: t('pages.chat.cmd_think_high'), action: 'exec' },
    ]},
    { title: t('pages.chat.cmd_fast'), commands: [
      { cmd: '/fast', desc: t('pages.chat.cmd_fast_toggle'), action: 'exec' },
      { cmd: '/fast on', desc: t('pages.chat.cmd_fast_on'), action: 'exec' },
      { cmd: '/fast off', desc: t('pages.chat.cmd_fast_off'), action: 'exec' },
    ]},
    { title: t('pages.chat.cmd_verbose'), commands: [
      { cmd: '/verbose off', desc: t('pages.chat.cmd_verbose_off'), action: 'exec' },
      { cmd: '/verbose low', desc: t('pages.chat.cmd_verbose_low'), action: 'exec' },
      { cmd: '/verbose high', desc: t('pages.chat.cmd_verbose_high'), action: 'exec' },
      { cmd: '/reasoning off', desc: t('pages.chat.cmd_reasoning_off'), action: 'exec' },
      { cmd: '/reasoning low', desc: t('pages.chat.cmd_reasoning_low'), action: 'exec' },
      { cmd: '/reasoning medium', desc: t('pages.chat.cmd_reasoning_medium'), action: 'exec' },
      { cmd: '/reasoning high', desc: t('pages.chat.cmd_reasoning_high'), action: 'exec' },
    ]},
    { title: t('pages.chat.cmd_info'), commands: [
      { cmd: '/help', desc: t('pages.chat.cmd_help'), action: 'exec' },
      { cmd: '/status', desc: t('pages.chat.cmd_status'), action: 'exec' },
      { cmd: '/context', desc: t('pages.chat.cmd_context'), action: 'exec' },
    ]},
  ]
}

let _sessionKey = null, _page = null, _messagesEl = null, _textarea = null
let _sendBtn = null, _statusDot = null, _typingEl = null, _scrollBtn = null
let _sessionListEl = null, _cmdPanelEl = null, _attachPreviewEl = null, _fileInputEl = null
let _modelSelectEl = null, _fastModeBtn = null
let _currentAiBubble = null, _currentAiWrap = null, _currentAiText = '', _currentAiThinking = '', _currentAiImages = [], _currentAiVideos = [], _currentAiAudios = [], _currentAiFiles = [], _currentRunId = null
let _currentAiStreamTextNode = null
let _isStreaming = false, _isSending = false, _messageQueue = [], _streamStartTime = 0
let _isBootstrappingCommand = false, _lastHistoryHash = ''
let _streamSafetyTimer = null, _unsubEvent = null, _unsubReady = null, _unsubStatus = null
let _streamRenderController = null, _hiddenSessionCommand = null, _hiddenCommandTimer = null
let _textareaComposition = createCompositionState(), _textareaCompositionCleanup = null
let _onDocumentVisibilityChange = null, _onWindowFocus = null
let _seenRunIds = new Set()
let _pageActive = false
let _errorTimer = null, _lastErrorMsg = null
let _responseWatchdog = null, _postFinalCheck = null
let _ultimateTimer = null, _sendTimestamp = 0
let _attachments = []
let _hasEverConnected = false
let _availableModels = []
let _primaryModel = ''
let _selectedModel = ''
let _isApplyingModel = false
let _shouldAutoFollow = true

export async function render() {
  const page = document.createElement('div')
  page.className = 'page chat-page'
  _pageActive = true
  _page = page

  page.innerHTML = `
    <div class="chat-sidebar" id="chat-sidebar">
      <div class="chat-sidebar-header">
        <span>${t('pages.chat.session_list')}</span>
        <button class="chat-sidebar-btn" id="btn-new-session" title="${t('pages.chat.new_session')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
      </div>
      <div class="chat-session-list" id="chat-session-list"></div>
    </div>
    <div class="chat-main">
      <div class="chat-header">
        <div class="chat-status">
          <button class="chat-toggle-sidebar" id="btn-toggle-sidebar" title="${t('pages.chat.session_list')}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>
          <span class="status-dot" id="chat-status-dot"></span>
          <span class="chat-title" id="chat-title">${t('pages.chat.title')}</span>
        </div>
        <div class="chat-header-actions">
          <div class="chat-model-group">
            <select class="form-input" id="chat-model-select" title="${t('pages.chat.switch_model')}" style="width:200px;max-width:28vw;padding:6px 10px;font-size:var(--font-size-xs)">
              <option value="">${t('pages.chat.loading_models')}</option>
            </select>
            <button class="btn btn-sm btn-ghost" id="btn-refresh-models" title="${t('pages.chat.refresh_models')}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
            </button>
          </div>
          <button class="btn btn-sm btn-ghost" id="btn-fast-mode" title="${t('pages.chat.fast_mode_hint')}">${t('pages.chat.fast_mode_on')}</button>
          <button class="btn btn-sm btn-ghost" id="btn-cmd" title="${t('pages.chat.shortcuts')}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M18 3a3 3 0 00-3 3v12a3 3 0 003 3 3 3 0 003-3 3 3 0 00-3-3H6a3 3 0 00-3 3 3 3 0 003 3 3 3 0 003-3V6a3 3 0 00-3-3 3 3 0 00-3 3 3 3 0 003 3h12a3 3 0 003-3 3 3 0 00-3-3z"/></svg>
          </button>
          <button class="btn btn-sm btn-ghost" id="btn-reset-session" title="${t('pages.chat.reset_session')}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>
          </button>
        </div>
      </div>
      <div class="chat-messages" id="chat-messages">
        <div class="typing-indicator" id="typing-indicator" style="display:none">
          <span></span><span></span><span></span>
          <span class="typing-hint"></span>
        </div>
      </div>
      <button class="chat-scroll-btn" id="chat-scroll-btn" style="display:none">↓</button>
      <div class="chat-cmd-panel" id="chat-cmd-panel" style="display:none"></div>
      <div class="chat-attachments-preview" id="chat-attachments-preview" style="display:none"></div>
      <div class="chat-input-area">
        <input type="file" id="chat-file-input" accept="image/*" multiple style="display:none">
        <button class="chat-attach-btn" id="chat-attach-btn" title="${t('pages.chat.upload_image')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
        </button>
        <div class="chat-input-wrapper">
          <textarea id="chat-input" rows="1" placeholder="${t('pages.chat.input_placeholder')}"></textarea>
        </div>
        <button class="chat-send-btn" id="chat-send-btn" disabled>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>
      <div class="chat-disconnect-bar" id="chat-disconnect-bar" style="display:none">${t('pages.chat.reconnecting')}</div>
      <div class="chat-connect-overlay" id="chat-connect-overlay" style="display:none">
        <div class="chat-connect-card">
          <div class="chat-connect-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48"><path d="M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 11-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 002.5 2.5z"/></svg>
          </div>
          <div class="chat-connect-title">${t('pages.chat.gw_not_ready')}</div>
          <div class="chat-connect-desc" id="chat-connect-desc">${t('pages.chat.connecting_gw')}</div>
          <div class="chat-connect-actions">
            <button class="btn btn-primary btn-sm" id="btn-fix-connect">${t('pages.chat.fix_reconnect')}</button>
            <button class="btn btn-secondary btn-sm" id="btn-goto-gateway">${t('pages.chat.gw_settings')}</button>
          </div>
          <div class="chat-connect-hint">${t('pages.chat.first_use_hint')}</div>
        </div>
      </div>
    </div>
  `

  _messagesEl = page.querySelector('#chat-messages')
  _shouldAutoFollow = true
  _textarea = page.querySelector('#chat-input')
  _sendBtn = page.querySelector('#chat-send-btn')
  _statusDot = page.querySelector('#chat-status-dot')
  _typingEl = page.querySelector('#typing-indicator')
  _scrollBtn = page.querySelector('#chat-scroll-btn')
  _sessionListEl = page.querySelector('#chat-session-list')
  _cmdPanelEl = page.querySelector('#chat-cmd-panel')
  _attachPreviewEl = page.querySelector('#chat-attachments-preview')
  _fileInputEl = page.querySelector('#chat-file-input')
  _modelSelectEl = page.querySelector('#chat-model-select')
  _fastModeBtn = page.querySelector('#btn-fast-mode')
  if (_textareaCompositionCleanup) _textareaCompositionCleanup()
  _textareaComposition = createCompositionState()
  _streamRenderController = createStreamRenderController({
    render: doRender,
    isDocumentHidden: () => typeof document !== 'undefined' && document.hidden,
  })
  page.querySelector('#chat-sidebar')?.classList.toggle('open', getSidebarOpen())

  bindEvents(page)
  bindConnectOverlay(page)
  updateFastModeUI()

  // 首次使用引导提示
  showPageGuide(_messagesEl)

  loadModelOptions()
  // 非阻塞：先返回 DOM，后台连接 Gateway
  connectGateway()
  return page
}

const GUIDE_KEY = 'privix-community-guide-chat-dismissed'

function showPageGuide(container) {
  if (localStorage.getItem(GUIDE_KEY)) return
  const guide = document.createElement('div')
  guide.className = 'chat-page-guide'
  guide.innerHTML = `
    <div class="chat-guide-inner">
      <div class="chat-guide-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="28" height="28"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
      </div>
      <div class="chat-guide-content">
        <b>${t('pages.chat.guide_title')}</b>
        <p>${t('pages.chat.guide_body')}</p>
        <p style=”opacity:0.8;font-size:11px”>${t('pages.chat.guide_tip1')}</p>
        <p style=”opacity:0.7;font-size:11px”>${t('pages.chat.guide_tip2')}</p>
      </div>
      <button class=”chat-guide-close” title=”${t('pages.chat.guide_dismiss')}”>&times;</button>
    </div>
  `
  const closeBtn = guide.querySelector('.chat-guide-close')
  if (closeBtn) {
    closeBtn.onclick = () => {
      localStorage.setItem(GUIDE_KEY, '1')
      guide.remove()
    }
  }
  container.insertBefore(guide, container.firstChild)
}

// ── 事件绑定 ──

function bindEvents(page) {
  if (_textareaCompositionCleanup) _textareaCompositionCleanup()
  _textareaCompositionCleanup = bindCompositionState(_textarea, _textareaComposition)

  if (_modelSelectEl) {
    _modelSelectEl.addEventListener('change', () => {
      _selectedModel = _modelSelectEl.value
      if (_selectedModel) localStorage.setItem(STORAGE_MODEL_KEY, _selectedModel)
      else localStorage.removeItem(STORAGE_MODEL_KEY)
      applySelectedModel()
    })
  }

  _textarea.addEventListener('input', () => {
    _textarea.style.height = 'auto'
    _textarea.style.height = Math.min(_textarea.scrollHeight, 150) + 'px'
    updateSendState()
    // 输入 / 时显示指令面板
    if (_textarea.value === '/') showCmdPanel()
    else if (!_textarea.value.startsWith('/')) hideCmdPanel()
  })

  _textarea.addEventListener('keydown', (e) => {
    if (shouldSubmitOnEnter(e, { localIsComposing: _textareaComposition.isActive() })) { e.preventDefault(); sendMessage() }
    if (e.key === 'Escape') hideCmdPanel()
  })

  _sendBtn.addEventListener('click', () => {
    if (_isStreaming) stopGeneration()
    else sendMessage()
  })
  _fastModeBtn?.addEventListener('click', () => {
    if (_isStreaming || _isSending || _isBootstrappingCommand) {
      toast(t('pages.chat.toast_wait_idle'), 'info')
      return
    }
    toggleFastModeForCurrentSession()
  })

  page.querySelector('#btn-toggle-sidebar').addEventListener('click', () => {
    const sidebar = page.querySelector('#chat-sidebar')
    if (!sidebar) return
    const nextOpen = !sidebar.classList.contains('open')
    sidebar.classList.toggle('open', nextOpen)
    setSidebarOpen(nextOpen)
  })
  page.querySelector('#btn-new-session').addEventListener('click', () => showNewSessionDialog())
  page.querySelector('#btn-cmd').addEventListener('click', () => toggleCmdPanel())
  page.querySelector('#btn-reset-session').addEventListener('click', () => resetCurrentSession())
  page.querySelector('#btn-refresh-models')?.addEventListener('click', () => loadModelOptions(true))

  // 文件上传
  page.querySelector('#chat-attach-btn').addEventListener('click', () => _fileInputEl.click())
  _fileInputEl.addEventListener('change', handleFileSelect)
  // 粘贴图片（Ctrl+V）
  _textarea.addEventListener('paste', handlePaste)

  _messagesEl.addEventListener('scroll', () => {
    syncScrollState()
  })
  _scrollBtn.addEventListener('click', () => {
    _shouldAutoFollow = true
    scrollToBottom({ force: true })
  })
  bindCopyButtons(_messagesEl, { wrapperSel: '.msg', bubbleSel: '.msg-bubble, .chat-bubble', iconFn: svgIcon })
  _messagesEl.addEventListener('click', () => hideCmdPanel())

  if (_onDocumentVisibilityChange) document.removeEventListener('visibilitychange', _onDocumentVisibilityChange)
  if (_onWindowFocus) window.removeEventListener('focus', _onWindowFocus)
  _onDocumentVisibilityChange = () => maybeRefreshStreamingBubble()
  _onWindowFocus = () => maybeRefreshStreamingBubble()
  document.addEventListener('visibilitychange', _onDocumentVisibilityChange)
  window.addEventListener('focus', _onWindowFocus)
}

async function loadModelOptions(showToast = false) {
  if (!_modelSelectEl) return
  // 显示加载状态
  _modelSelectEl.innerHTML = `<option value="">${t('pages.chat.loading_models')}</option>`
  _modelSelectEl.disabled = true
  try {
    invalidate('read_openclaw_config')
    const configPromise = api.readOpenclawConfig()
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error(t('pages.chat.error_config_timeout'))), 8000))
    const config = await Promise.race([configPromise, timeoutPromise])
    const providers = config?.models?.providers || {}
    _primaryModel = config?.agents?.defaults?.model?.primary || ''
    const models = []
    const seen = new Set()
    if (_primaryModel) {
      seen.add(_primaryModel)
      models.push(_primaryModel)
    }
    for (const [providerKey, provider] of Object.entries(providers)) {
      for (const item of (provider?.models || [])) {
        const modelId = typeof item === 'string' ? item : item?.id
        if (!modelId) continue
        const full = `${providerKey}/${modelId}`
        if (seen.has(full)) continue
        seen.add(full)
        models.push(full)
      }
    }
    _availableModels = models
    const saved = localStorage.getItem(STORAGE_MODEL_KEY) || ''
    _selectedModel = models.includes(saved) ? saved : (_primaryModel || models[0] || '')
    renderModelSelect()
    if (showToast) toast(t('pages.chat.toast_models_refreshed', { count: models.length }), 'success')
  } catch (e) {
    _availableModels = []
    _primaryModel = ''
    _selectedModel = ''
    renderModelSelect(t('pages.chat.toast_models_failed', { error: e.message || e }))
    if (showToast) toast(t('pages.chat.toast_models_failed', { error: e.message || e }), 'error')
  }
}

function renderModelSelect(errorText = '') {
  if (!_modelSelectEl) return
  if (!_availableModels.length) {
    _modelSelectEl.innerHTML = `<option value="">${escapeAttr(errorText || t('pages.chat.no_models'))}</option>`
    _modelSelectEl.disabled = true
    _modelSelectEl.title = errorText || t('pages.chat.no_models_hint')
    return
  }
  _modelSelectEl.disabled = _isApplyingModel
  _modelSelectEl.innerHTML = _availableModels.map(full => {
    const suffix = full === _primaryModel ? t('pages.chat.primary_model_suffix') : ''
    return `<option value="${escapeAttr(full)}" ${full === _selectedModel ? 'selected' : ''}>${full}${suffix}</option>`
  }).join('')
  _modelSelectEl.title = _selectedModel ? t('pages.chat.switch_model_to', { model: _selectedModel }) : t('pages.chat.switch_model')
}

function escapeAttr(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeHtml(str) {
  return escapeAttr(str).replace(/'/g, '&#39;')
}

function getFastModeStates() {
  try { return JSON.parse(localStorage.getItem(STORAGE_FAST_MODE_KEY) || '{}') } catch { return {} }
}

function getFastModeState(sessionKey) {
  if (!sessionKey) return null
  const states = getFastModeStates()
  return states[sessionKey] || null
}

function saveFastModeState(sessionKey, nextState) {
  if (!sessionKey) return
  const states = getFastModeStates()
  if (nextState) states[sessionKey] = nextState
  else delete states[sessionKey]
  localStorage.setItem(STORAGE_FAST_MODE_KEY, JSON.stringify(states))
}

function shouldHideStoredFastCommandHistory(sessionKey) {
  const state = getFastModeState(sessionKey)
  return Boolean(state && (state.source === 'auto' || state.source === 'button'))
}

function getFastModeCommandIntent(text) {
  const trimmed = (text || '').trim()
  if (trimmed === '/fast on') return 'on'
  if (trimmed === '/fast off') return 'off'
  return null
}

function isFastModeCommand(text) {
  return Boolean(getFastModeCommandIntent(text))
}

function looksLikeFastModeAck(text) {
  return /fast|快速模式|低延迟|low latency/i.test(text || '')
}

function syncFastModePreferenceFromCommand(text) {
  if (!_sessionKey) return
  const intent = getFastModeCommandIntent(text)
  if (intent === 'on') saveFastModeState(_sessionKey, { enabled: true, source: 'manual' })
  else if (intent === 'off') saveFastModeState(_sessionKey, { enabled: false, source: 'manual' })
  updateFastModeUI()
}

function updateFastModeUI() {
  if (!_fastModeBtn) return
  const state = getFastModeState(_sessionKey)
  const enabled = Boolean(state?.enabled)
  _fastModeBtn.textContent = enabled ? t('pages.chat.fast_mode_off') : t('pages.chat.fast_mode_on')
  _fastModeBtn.className = `btn btn-sm ${enabled ? 'btn-secondary' : 'btn-ghost'}`
  _fastModeBtn.title = enabled
    ? t('pages.chat.fast_mode_enabled_hint')
    : t('pages.chat.fast_mode_hint')
}

function isMessageListNearBottom() {
  if (!_messagesEl) return true
  return isNearBottom({
    scrollTop: _messagesEl.scrollTop,
    scrollHeight: _messagesEl.scrollHeight,
    clientHeight: _messagesEl.clientHeight,
  })
}

function syncScrollState() {
  if (!_messagesEl) return true
  const nearBottom = isMessageListNearBottom()
  _shouldAutoFollow = nearBottom
  if (_scrollBtn) _scrollBtn.style.display = nearBottom ? 'none' : 'flex'
  return nearBottom
}

function clearHiddenCommandTimeout() {
  clearTimeout(_hiddenCommandTimer)
  _hiddenCommandTimer = null
}

function finishHiddenSessionCommand() {
  clearHiddenCommandTimeout()
  _hiddenSessionCommand = null
  _isBootstrappingCommand = false
  processMessageQueue()
}

function shouldSuppressHiddenSessionCommand(payload) {
  if (!_hiddenSessionCommand || !_sessionKey) return false
  if (payload.sessionKey && payload.sessionKey !== _hiddenSessionCommand.sessionKey) return false
  if (payload.runId && !_hiddenSessionCommand.runId) _hiddenSessionCommand.runId = payload.runId
  return !_hiddenSessionCommand.runId || !payload.runId || payload.runId === _hiddenSessionCommand.runId
}

async function setFastModeForCurrentSession(enabled, { auto = false, source = auto ? 'auto' : 'button' } = {}) {
  if (!_sessionKey || _isStreaming || _isSending || _isBootstrappingCommand) return false
  const previousState = getFastModeState(_sessionKey)
  const currentlyEnabled = Boolean(previousState?.enabled)

  if (auto && (currentlyEnabled || previousState?.source === 'manual' || previousState?.source === 'button')) {
    updateFastModeUI()
    return false
  }
  if (!auto && currentlyEnabled === enabled) {
    toast(enabled ? t('pages.chat.toast_fast_already_on') : t('pages.chat.toast_fast_already_off'), 'info')
    updateFastModeUI()
    return false
  }

  _hiddenSessionCommand = {
    sessionKey: _sessionKey,
    reason: enabled ? (auto ? 'auto-fast-init' : 'manual-fast-init') : 'manual-fast-disable',
    runId: null,
  }
  _isBootstrappingCommand = true
  clearHiddenCommandTimeout()
  _hiddenCommandTimer = setTimeout(() => {
    finishHiddenSessionCommand()
    updateFastModeUI()
  }, 10000)
  saveFastModeState(_sessionKey, { enabled, source })
  updateFastModeUI()

  try {
    await wsClient.chatSend(_sessionKey, enabled ? '/fast on' : '/fast off')
    if (!auto) {
      toast(enabled ? t('pages.chat.toast_fast_on') : t('pages.chat.toast_fast_off'), 'success')
    } else if (enabled) {
      toast(t('pages.chat.toast_fast_auto_on'), 'success')
    }
    return true
  } catch (error) {
    saveFastModeState(_sessionKey, previousState)
    finishHiddenSessionCommand()
    updateFastModeUI()
    toast(t('pages.chat.toast_fast_toggle_failed', { action: enabled ? t('pages.chat.fast_mode_on') : t('pages.chat.fast_mode_off'), error: error.message || error }), 'error')
    return false
  }
}

async function toggleFastModeForCurrentSession() {
  const enabled = Boolean(getFastModeState(_sessionKey)?.enabled)
  return setFastModeForCurrentSession(!enabled)
}

function maybeRefreshStreamingBubble() {
  if (!_pageActive || !_streamRenderController) return
  if (shouldForceStreamingRefresh({
    isStreaming: _isStreaming,
    isDocumentHidden: typeof document !== 'undefined' && document.hidden,
    hasBufferedText: Boolean(_currentAiBubble && (_currentAiText || _currentAiThinking)),
  })) {
    _streamRenderController.force()
    scrollToBottom()
  }
}

function filterVisibleHistory(messages, sessionKey) {
  if (!shouldHideStoredFastCommandHistory(sessionKey)) return messages
  const visible = []
  let hideAssistantAck = false

  for (const message of messages) {
    if (message.role === 'user' && isFastModeCommand(message.text) && !message.images?.length && !message.videos?.length && !message.audios?.length && !message.files?.length) {
      hideAssistantAck = true
      continue
    }
    if (hideAssistantAck && message.role !== 'user') {
      if (!message.text || looksLikeFastModeAck(message.text)) {
        hideAssistantAck = false
        continue
      }
      hideAssistantAck = false
    }
    visible.push(message)
  }

  return visible
}

/** 本地会话别名缓存 */
function getSessionNames() {
  try { return JSON.parse(localStorage.getItem(STORAGE_SESSION_NAMES_KEY) || '{}') } catch { return {} }
}
function setSessionName(key, name) {
  const names = getSessionNames()
  if (name) names[key] = name
  else delete names[key]
  localStorage.setItem(STORAGE_SESSION_NAMES_KEY, JSON.stringify(names))
}
function getDisplayLabel(key) {
  const custom = getSessionNames()[key]
  return custom || parseSessionLabel(key)
}

function getSidebarOpen() {
  return localStorage.getItem(STORAGE_SIDEBAR_KEY) === '1'
}

function setSidebarOpen(open) {
  localStorage.setItem(STORAGE_SIDEBAR_KEY, open ? '1' : '0')
}

async function applySelectedModel() {
  if (!_selectedModel) {
    toast(t('pages.chat.toast_select_model_first'), 'warning')
    return
  }
  if (!wsClient.gatewayReady || !_sessionKey) {
    toast(t('pages.chat.toast_gw_not_ready'), 'warning')
    return
  }
  _isApplyingModel = true
  renderModelSelect()
  try {
    await wsClient.chatSend(_sessionKey, `/model ${_selectedModel}`)
    toast(t('pages.chat.toast_model_switched', { model: _selectedModel }), 'success')
  } catch (e) {
    toast(t('pages.chat.toast_model_switch_failed', { error: e.message || e }), 'error')
  } finally {
    _isApplyingModel = false
    renderModelSelect()
  }
}

// ── 连接引导遮罩 ──

function bindConnectOverlay(page) {
  const fixBtn = page.querySelector('#btn-fix-connect')
  const gwBtn = page.querySelector('#btn-goto-gateway')

  if (fixBtn) {
    fixBtn.addEventListener('click', async () => {
      fixBtn.disabled = true
      fixBtn.textContent = t('pages.chat.fixing')
      const desc = document.getElementById('chat-connect-desc')
      try {
        if (desc) desc.textContent = t('pages.chat.fixing_desc')
        await api.autoPairDevice()
        await api.reloadGateway()
        if (desc) desc.textContent = t('pages.chat.fix_done_reconnecting')
        // 断开旧连接，重新发起
        wsClient.disconnect()
        setTimeout(() => connectGateway(), 3000)
      } catch (e) {
        if (desc) desc.textContent = t('pages.chat.fix_failed', { error: e.message || e })
      } finally {
        fixBtn.disabled = false
        fixBtn.textContent = t('pages.chat.fix_reconnect')
      }
    })
  }

  if (gwBtn) {
    gwBtn.addEventListener('click', () => navigate('/gateway'))
  }
}

// ── 文件上传 ──

async function handleFileSelect(e) {
  const files = Array.from(e.target.files || [])
  if (!files.length) return

  for (const file of files) {
    if (!file.type.startsWith('image/')) {
      toast(t('pages.chat.toast_image_only'), 'warning')
      continue
    }
    if (file.size > 5 * 1024 * 1024) {
      toast(t('pages.chat.toast_file_too_large', { name: file.name }), 'warning')
      continue
    }

    try {
      const base64 = await fileToBase64(file)
      _attachments.push({
        type: 'image',
        mimeType: file.type,
        fileName: file.name,
        content: base64,
      })
      renderAttachments()
    } catch (e) {
      toast(t('pages.chat.toast_file_read_failed', { name: file.name }), 'error')
    }
  }
  _fileInputEl.value = ''
}

async function handlePaste(e) {
  const items = Array.from(e.clipboardData?.items || [])
  const imageItems = items.filter(item => item.type.startsWith('image/'))
  if (!imageItems.length) return
  e.preventDefault()
  for (const item of imageItems) {
    const file = item.getAsFile()
    if (!file) continue
    if (file.size > 5 * 1024 * 1024) { toast(t('pages.chat.toast_paste_too_large'), 'warning'); continue }
    try {
      const base64 = await fileToBase64(file)
      _attachments.push({ type: 'image', mimeType: file.type || 'image/png', fileName: `paste-${Date.now()}.png`, content: base64 })
      renderAttachments()
    } catch (_) { toast(t('pages.chat.toast_paste_read_failed'), 'error') }
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result
      const match = /^data:[^;]+;base64,(.+)$/.exec(dataUrl)
      if (!match) { reject(new Error(t('pages.chat.error_invalid_data_url'))); return }
      resolve(match[1])
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function renderAttachments() {
  if (!_attachments.length) {
    _attachPreviewEl.style.display = 'none'
    return
  }
  _attachPreviewEl.style.display = 'flex'
  _attachPreviewEl.innerHTML = _attachments.map((att, idx) => `
    <div class="chat-attachment-item">
      <img src="data:${att.mimeType};base64,${att.content}" alt="${att.fileName}">
      <button class="chat-attachment-del" data-idx="${idx}">×</button>
    </div>
  `).join('')

  _attachPreviewEl.querySelectorAll('.chat-attachment-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx)
      _attachments.splice(idx, 1)
      renderAttachments()
    })
  })
  updateSendState()
}

// ── Gateway 连接 ──

async function connectGateway() {
  try {
    // 清理旧的订阅，避免重复监听
    if (_unsubStatus) { _unsubStatus(); _unsubStatus = null }
    if (_unsubReady) { _unsubReady(); _unsubReady = null }
    if (_unsubEvent) { _unsubEvent(); _unsubEvent = null }

    // 初始化会话缓存
    initSessionStore()

    // 订阅状态变化（订阅式，返回 unsub）
    _unsubStatus = wsClient.onStatusChange((status, errorMsg) => {
      if (!_pageActive) return
      updateStatusDot(status)
      setConnectionState(status === 'ready' || status === 'connected')
      const bar = document.getElementById('chat-disconnect-bar')
      const overlay = document.getElementById('chat-connect-overlay')
      const desc = document.getElementById('chat-connect-desc')
      if (status === 'ready' || status === 'connected') {
        _hasEverConnected = true
        if (bar) bar.style.display = 'none'
        if (overlay) overlay.style.display = 'none'
      } else if (status === 'error') {
        // 连接错误：显示引导遮罩而非底部条
        if (bar) bar.style.display = 'none'
        if (overlay) {
          overlay.style.display = 'flex'
          if (desc) desc.textContent = errorMsg || t('pages.chat.connect_failed')
        }
      } else if (status === 'reconnecting' || status === 'disconnected') {
        // 首次连接或多次重连失败时，显示引导遮罩而非底部小条
        if (!_hasEverConnected) {
          if (overlay) { overlay.style.display = 'flex'; if (desc) desc.textContent = t('pages.chat.connecting_gw') }
        } else {
          if (bar) { bar.textContent = t('pages.chat.reconnecting'); bar.style.display = 'flex' }
        }
      } else {
        if (bar) bar.style.display = 'none'
      }
    })

    _unsubReady = wsClient.onReady((hello, sessionKey, err) => {
      if (!_pageActive) return
      const overlay = document.getElementById('chat-connect-overlay')
      if (err?.error) {
        if (overlay) {
          overlay.style.display = 'flex'
          const desc = document.getElementById('chat-connect-desc')
          if (desc) desc.textContent = err.message || t('pages.chat.connect_failed')
        }
        return
      }
      if (overlay) overlay.style.display = 'none'
      showTyping(false)  // Gateway 就绪后关闭加载动画
      // setConnectionState 已由 onStatusChange 在 'ready' 状态时设置
      // 重连后恢复：保留当前 sessionKey，不重复加载历史
      if (!_sessionKey) {
        const saved = localStorage.getItem(STORAGE_SESSION_KEY)
        _sessionKey = saved || sessionKey
        updateSessionTitle()
        updateFastModeUI()
        loadHistory()
      } else {
        // 已有 sessionKey（重连场景），后台同步 Gateway 数据
        syncWithGateway(_sessionKey).then(result => {
          if (result?.isUpdate) loadHistory()
        })
      }
      // 始终刷新会话列表（无论是否有 sessionKey）
      refreshSessionList()
    })

    _unsubEvent = wsClient.onEvent((msg) => {
      if (!_pageActive) return
      handleEvent(msg)
    })

    // 如果已连接且 Gateway 就绪，直接复用
    if (wsClient.connected && wsClient.gatewayReady) {
      const saved = localStorage.getItem(STORAGE_SESSION_KEY)
      _sessionKey = saved || wsClient.sessionKey
      setConnectionState(true)
      updateStatusDot('ready')
      showTyping(false)  // 确保关闭加载动画
      updateSessionTitle()
      updateFastModeUI()
      loadHistory()
      refreshSessionList()
      return
    }

    // 如果正在连接中（重连等），等待 onReady 回调即可
    if (wsClient.connected) return

    // 未连接，发起新连接
    const config = await api.readOpenclawConfig()
    const gw = config?.gateway || {}
    const host = window.__TAURI_INTERNALS__ ? `127.0.0.1:${gw.port || 18789}` : location.host
    const token = gw.auth?.token || gw.authToken || ''

    // 设置确定性 session key（重连时可恢复同一 session）
    const agentId = gw.defaultAgentId || 'main'
    const preferredKey = WsClient.generateSessionKey(agentId)
    wsClient.setPreferredSessionKey(preferredKey)

    wsClient.connect(host, token)
  } catch (e) {
    toast(t('pages.chat.toast_config_failed', { error: e.message }), 'error')
  }
}

// ── 会话管理 ──

async function refreshSessionList() {
  if (!_sessionListEl || !wsClient.gatewayReady) return
  try {
    const result = await wsClient.sessionsList(50)
    const sessions = result?.sessions || result || []
    renderSessionList(sessions)
  } catch (e) {
    console.error('[chat] refreshSessionList error:', e)
  }
}

function renderSessionList(sessions) {
  if (!_sessionListEl) return
  if (!sessions.length) {
    _sessionListEl.innerHTML = `<div class="chat-session-empty">${t('pages.chat.no_sessions')}</div>`
    return
  }
  sessions.sort((a, b) => (b.updatedAt || b.lastActivity || 0) - (a.updatedAt || a.lastActivity || 0))
  _sessionListEl.innerHTML = sessions.map(s => {
    const key = s.sessionKey || s.key || ''
    const active = key === _sessionKey ? ' active' : ''
    const label = parseSessionLabel(key)
    const ts = s.updatedAt || s.lastActivity || s.createdAt || 0
    const timeStr = ts ? formatSessionTime(ts) : ''
    const msgCount = s.messageCount || s.messages || 0
    const agentId = parseSessionAgent(key)
    const displayLabel = getDisplayLabel(key) || label
    return `<div class="chat-session-card${active}" data-key="${escapeAttr(key)}">
      <div class="chat-session-card-header">
        <span class="chat-session-label" title="${t('pages.chat.dblclick_rename')}">${escapeAttr(displayLabel)}</span>
        <button class="chat-session-del" data-del="${escapeAttr(key)}" title="${t('common.delete')}">×</button>
      </div>
      <div class="chat-session-card-meta">
        ${agentId && agentId !== 'main' ? `<span class="chat-session-agent">${escapeAttr(agentId)}</span>` : ''}
        ${msgCount > 0 ? `<span>${t('pages.chat.msg_count', { count: msgCount })}</span>` : ''}
        ${timeStr ? `<span>${timeStr}</span>` : ''}
      </div>
    </div>`
  }).join('')

  _sessionListEl.onclick = (e) => {
    const delBtn = e.target.closest('[data-del]')
    if (delBtn) { e.stopPropagation(); deleteSession(delBtn.dataset.del); return }
    const item = e.target.closest('[data-key]')
    if (item) switchSession(item.dataset.key)
  }
  _sessionListEl.ondblclick = (e) => {
    const labelEl = e.target.closest('.chat-session-label')
    if (!labelEl) return
    const card = labelEl.closest('[data-key]')
    if (!card) return
    e.stopPropagation()
    renameSession(card.dataset.key, labelEl)
  }
}

function formatSessionTime(ts) {
  const d = new Date(typeof ts === 'number' && ts < 1e12 ? ts * 1000 : ts)
  if (isNaN(d.getTime())) return ''
  const now = new Date()
  const diffMs = now - d
  if (diffMs < 60000) return t('pages.chat.time_just_now')
  if (diffMs < 3600000) return t('pages.chat.time_minutes_ago', { count: Math.floor(diffMs / 60000) })
  if (diffMs < 86400000) return t('pages.chat.time_hours_ago', { count: Math.floor(diffMs / 3600000) })
  if (diffMs < 604800000) return t('pages.chat.time_days_ago', { count: Math.floor(diffMs / 86400000) })
  return `${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`
}

function parseSessionAgent(key) {
  const parts = (key || '').split(':')
  return parts.length >= 2 ? parts[1] : ''
}

function parseSessionLabel(key) {
  const parts = (key || '').split(':')
  if (parts.length < 3) return key || t('common.unknown')
  const agent = parts[1] || 'main'
  const channel = parts.slice(2).join(':')
  if (agent === 'main' && channel === 'main') return t('pages.chat.main_session')
  if (agent === 'main') return channel
  return `${agent} / ${channel}`
}

function switchSession(newKey) {
  if (newKey === _sessionKey) return
  _sessionKey = newKey
  localStorage.setItem(STORAGE_SESSION_KEY, newKey)
  _lastHistoryHash = ''
  _shouldAutoFollow = true
  resetStreamState()
  updateSessionTitle()
  updateFastModeUI()
  clearMessages()
  loadHistory()
  refreshSessionList()
}

async function showNewSessionDialog() {
  const defaultAgent = wsClient.snapshot?.sessionDefaults?.defaultAgentId || 'main'

  // 先用默认选项立即显示弹窗
  const initialOptions = [
    { value: 'main', label: t('pages.chat.agent_default', { name: 'main' }) },
    { value: '__new__', label: t('pages.chat.new_agent') }
  ]

  showModal({
    title: t('pages.chat.new_session'),
    fields: [
      { name: 'name', label: t('pages.chat.session_name'), value: '', placeholder: t('pages.chat.session_name_placeholder') },
      { name: 'agent', label: 'Agent', type: 'select', value: defaultAgent, options: initialOptions },
    ],
    onConfirm: (result) => {
      const name = (result.name || '').trim()
      if (!name) { toast(t('pages.chat.toast_enter_name'), 'warning'); return }
      const agent = result.agent || defaultAgent
      if (agent === '__new__') {
        navigate('/agents')
        toast(t('pages.chat.toast_create_agent_hint'), 'info')
        return
      }
      switchSession(`agent:${agent}:${name}`)
      toast(t('pages.chat.toast_session_created'), 'success')
    }
  })

  // 异步加载完整 Agent 列表并更新下拉框
  try {
    const agents = await api.listAgents()
    const agentOptions = agents.map(a => ({
      value: a.id,
      label: `${a.isDefault ? t('pages.chat.agent_default', { name: a.id }) : a.id}${a.identityName ? ' — ' + a.identityName.split(',')[0] : ''}`
    }))
    agentOptions.push({ value: '__new__', label: t('pages.chat.new_agent') })

    // 更新弹窗中的下拉框选项
    const selectEl = document.querySelector('.modal-overlay [data-name="agent"]')
    if (selectEl) {
      const currentValue = selectEl.value
      selectEl.innerHTML = agentOptions.map(o =>
        `<option value="${o.value}" ${o.value === currentValue ? 'selected' : ''}>${o.label}</option>`
      ).join('')
    }
  } catch (e) {
    console.warn('[chat] 加载 Agent 列表失败:', e)
  }
}

async function deleteSession(key) {
  const mainKey = wsClient.snapshot?.sessionDefaults?.mainSessionKey || 'agent:main:main'
  if (key === mainKey) { toast(t('pages.chat.toast_cannot_delete_main'), 'warning'); return }
  const label = parseSessionLabel(key)
  const yes = await showConfirm(t('pages.chat.confirm_delete_session', { name: label }))
  if (!yes) return
  try {
    await wsClient.sessionsDelete(key)
    toast(t('pages.chat.toast_session_deleted'), 'success')
    if (key === _sessionKey) switchSession(mainKey)
    else refreshSessionList()
  } catch (e) {
    toast(t('pages.chat.toast_delete_failed', { error: e.message }), 'error')
  }
}

async function resetCurrentSession() {
  if (!_sessionKey) return
  const label = getDisplayLabel(_sessionKey)
  const yes = await showConfirm(t('pages.chat.confirm_reset_session', { name: label }))
  if (!yes) return
  try {
    await wsClient.sessionsReset(_sessionKey)
    clearMessages()
    _lastHistoryHash = ''
    appendSystemMessage(t('pages.chat.session_reset'))
    toast(t('pages.chat.toast_session_reset'), 'success')
  } catch (e) {
    toast(t('pages.chat.toast_reset_failed', { error: e.message }), 'error')
  }
}

function updateSessionTitle() {
  const el = _page?.querySelector('#chat-title')
  if (el) el.textContent = getDisplayLabel(_sessionKey)
  updateFastModeUI()
}

function renameSession(key, labelEl) {
  const current = getDisplayLabel(key)
  const input = document.createElement('input')
  input.type = 'text'
  input.value = current
  input.className = 'chat-session-rename-input'
  input.style.cssText = 'width:100%;padding:2px 6px;border:1px solid var(--accent);border-radius:4px;background:var(--bg-secondary);color:var(--text-primary);font-size:12px;outline:none'
  const originalText = labelEl.textContent
  labelEl.textContent = ''
  labelEl.appendChild(input)
  input.focus()
  input.select()

  let done = false
  const finish = () => {
    if (done) return
    done = true
    const newName = input.value.trim()
    if (newName && newName !== parseSessionLabel(key)) {
      setSessionName(key, newName)
      toast(t('pages.chat.toast_session_renamed'), 'success')
    } else if (!newName || newName === parseSessionLabel(key)) {
      setSessionName(key, '') // clear custom name
    }
    labelEl.textContent = getDisplayLabel(key)
    // 如果是当前会话，同步更新顶部标题
    if (key === _sessionKey) updateSessionTitle()
  }
  input.addEventListener('blur', finish)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur() }
    if (e.key === 'Escape') { input.value = originalText; input.blur() }
  })
}

// ── 快捷指令面板 ──

function showCmdPanel() {
  if (!_cmdPanelEl) return
  let html = ''
  for (const group of getCommands()) {
    html += `<div class="cmd-group-title">${group.title}</div>`
    for (const c of group.commands) {
      html += `<div class="cmd-item" data-cmd="${c.cmd}" data-action="${c.action}">
        <span class="cmd-name">${c.cmd}</span>
        <span class="cmd-desc">${c.desc}</span>
      </div>`
    }
  }
  _cmdPanelEl.innerHTML = html
  _cmdPanelEl.style.display = 'block'
  _cmdPanelEl.onclick = (e) => {
    const item = e.target.closest('.cmd-item')
    if (!item) return
    hideCmdPanel()
    if (item.dataset.action === 'fill') {
      _textarea.value = item.dataset.cmd
      _textarea.focus()
      updateSendState()
    } else {
      _textarea.value = item.dataset.cmd
      sendMessage()
    }
  }
}

function hideCmdPanel() {
  if (_cmdPanelEl) _cmdPanelEl.style.display = 'none'
}

function toggleCmdPanel() {
  if (_cmdPanelEl?.style.display === 'block') hideCmdPanel()
  else { _textarea.value = '/'; showCmdPanel(); _textarea.focus() }
}

// ── 消息发送 ──

async function sendMessage() {
  const rawText = _textarea.value.trim()
  if (!rawText && !_attachments.length) return

  let text = rawText
  if (rawText) {
    const resolved = await checkAndResolveSensitive(rawText)
    if (resolved.action === 'cancel') return
    text = resolved.text
  }

  hideCmdPanel()
  _textarea.value = ''
  _textarea.style.height = 'auto'
  updateSendState()
  const attachments = [..._attachments]
  _attachments = []
  renderAttachments()
  syncFastModePreferenceFromCommand(text)
  if (_isSending || _isStreaming || _isBootstrappingCommand) { _messageQueue.push({ text, attachments }); return }
  doSend(text, attachments)
}

async function doSend(text, attachments = []) {
  appendUserMessage(text, attachments)
  const msgId = uuid()
  cacheOutboundMessage(_sessionKey, { id: msgId, role: 'user', content: text })
  showTyping(true)
  _isSending = true
  _startResponseWatchdog()
  try {
    await wsClient.chatSend(_sessionKey, text, attachments.length ? attachments : undefined)
  } catch (err) {
    showTyping(false)
    _cancelResponseWatchdog()
    _sendTimestamp = 0
    appendSystemMessage(t('pages.chat.send_failed', { error: err.message }))
  } finally {
    _isSending = false
    updateSendState()
  }
}

function processMessageQueue() {
  if (_messageQueue.length === 0 || _isSending || _isStreaming || _isBootstrappingCommand) return
  const msg = _messageQueue.shift()
  if (typeof msg === 'string') doSend(msg, [])
  else doSend(msg.text, msg.attachments || [])
}

function stopGeneration() {
  if (_currentRunId) wsClient.chatAbort(_sessionKey, _currentRunId).catch(() => {})
}

// ── 事件处理（参照 clawapp 实现） ──

function handleEvent(msg) {
  const { event, payload } = msg
  if (!payload) return

  if (event === 'chat') handleChatEvent(payload)

  // ── 处理所有 agent 事件（OpenClaw 4.5+ 结构化进度） ──
  if (event === 'agent') {
    // 任何 agent 事件都说明 OpenClaw 在活跃处理，重置看门狗
    _resetWatchdogOnActivity()

    const stream = payload?.stream
    const data = payload?.data || {}

    // lifecycle 事件：处理开始/结束
    if (stream === 'lifecycle') {
      const phase = data.phase
      if (phase === 'start' && !_isStreaming) {
        showTyping(true, t('pages.chat.ai_processing'))
      }
    }

    // item 事件（4.5+ 结构化执行步骤：tool/command/patch/search/analysis）
    if (stream === 'item') {
      const title = data.title || data.name || ''
      const kind = data.kind || ''
      if ((data.phase === 'start' || data.phase === 'update') && !_isStreaming) {
        const hint = kind === 'command' ? t('pages.chat.command_running')
          : kind === 'search' ? t('pages.chat.ai_searching')
          : kind === 'analysis' ? t('pages.chat.ai_analyzing')
          : title ? t('pages.chat.ai_executing', { title })
          : t('pages.chat.ai_processing')
        showTyping(true, hint)
      }
    }

    // tool 事件（工具调用）
    if (stream === 'tool' && data.toolCallId) {
      const toolName = data.name || data.toolName || ''
      if (toolName && !_isStreaming) {
        showTyping(true, t('pages.chat.using_tool', { name: toolName }))
      }
    }

    // plan 事件（4.5+ 计划更新）
    if (stream === 'plan' && !_isStreaming) {
      showTyping(true, t('pages.chat.ai_planning'))
    }

    // approval 事件（操作审批）
    if (stream === 'approval' && !_isStreaming) {
      showTyping(true, t('pages.chat.waiting_approval'))
    }

    // thinking 事件（推理/思考）
    if (stream === 'thinking' && !_isStreaming) {
      showTyping(true, t('pages.chat.ai_thinking'))
    }

    // command_output 事件（命令输出增量）
    if (stream === 'command_output' && !_isStreaming) {
      showTyping(true, t('pages.chat.command_running'))
    }

    // compaction 事件
    if (stream === 'compaction') {
      showCompactionHint(true)
    }

    // error 事件
    if (stream === 'error' && data.message && !_isStreaming) {
      showTyping(true, `⚠ ${data.message}`)
    }
  }

  // Compaction 状态指示：上游 2026.3.12 新增 status_reaction 事件
  if (event === 'chat.status_reaction' || event === 'status_reaction') {
    const reaction = payload.reaction || payload.emoji || ''
    if (reaction.includes('compact') || reaction === '🗜️' || reaction === '📦') {
      showCompactionHint(true)
    } else if (!reaction || reaction === 'thinking' || reaction === '💭') {
      showCompactionHint(false)
    }
  }
}

function handleChatEvent(payload) {
  // sessionKey 过滤
  if (payload.sessionKey && payload.sessionKey !== _sessionKey && _sessionKey) return

  const { state } = payload
  const runId = payload.runId
  const normalized = normalizeGatewayChatEvent(payload, _currentAiText)

  if (shouldSuppressHiddenSessionCommand(payload)) {
    if (state === 'error') {
      const errMsg = payload.errorMessage || payload.error?.message || t('common.unknown')
      saveFastModeState(_sessionKey, null)
      updateFastModeUI()
      toast(t('pages.chat.toast_fast_init_failed', { error: errMsg }), 'warning')
      finishHiddenSessionCommand()
    } else if (state === 'final' || state === 'aborted') {
      finishHiddenSessionCommand()
    }
    return
  }

  // 重复 run 过滤：跳过已完成的 runId 的后续事件（Gateway 可能对同一消息触发多个 run）
  if (runId && state === 'final' && _seenRunIds.has(runId)) {
    console.log('[chat] 跳过重复 final, runId:', runId)
    return
  }
  if (runId && state === 'delta' && _seenRunIds.has(runId) && !_isStreaming) {
    console.log('[chat] 跳过已完成 run 的 delta, runId:', runId)
    return
  }

  if (state === 'delta') {
    _cancelResponseWatchdog()
    const mergedState = mergeGatewayChatState({
      text: _currentAiText,
      thinking: _currentAiThinking,
      images: _currentAiImages,
      videos: _currentAiVideos,
      audios: _currentAiAudios,
      files: _currentAiFiles,
    }, normalized)
    if (mergedState.hasContent || mergedState.thinking) {
      showTyping(false)
      if (!_currentAiBubble) {
        _currentRunId = payload.runId
        _currentAiBubble = createStreamBubble()
        _isStreaming = true
        _streamStartTime = Date.now()
        updateSendState()
      }
      _currentAiText = mergedState.text
      _currentAiThinking = mergedState.thinking
      _currentAiImages = mergedState.images
      _currentAiVideos = mergedState.videos
      _currentAiAudios = mergedState.audios
      _currentAiFiles = mergedState.files
      console.debug('[chat] delta normalized', {
        runId,
        textLength: _currentAiText.length,
        thinkingLength: _currentAiThinking.length,
        images: _currentAiImages.length,
        files: _currentAiFiles.length,
      })
      // 每次收到 delta 重置安全超时（90s 无新 delta 则强制结束）
      clearTimeout(_streamSafetyTimer)
      _streamSafetyTimer = setTimeout(() => {
        if (_isStreaming) {
          console.warn('[chat] 流式输出超时（90s 无新数据），强制结束')
          if (_currentAiBubble && _currentAiText) {
            renderFinalMessageContent({
              id: _currentRunId || `assistant-${Date.now()}`,
              role: 'assistant',
              text: _currentAiText,
              thinking: _currentAiThinking,
              timestamp: Date.now(),
              images: _currentAiImages,
              videos: _currentAiVideos,
              audios: _currentAiAudios,
              files: _currentAiFiles,
            })
          }
          appendSystemMessage(t('pages.chat.stream_timeout'))
          resetStreamState()
          processMessageQueue()
        }
      }, 90000)
      _streamRenderController?.schedule()
    }
    return
  }

  if (state === 'final') {
    _cancelResponseWatchdog()
    const mergedState = mergeGatewayChatState({
      text: _currentAiText,
      thinking: _currentAiThinking,
      images: _currentAiImages,
      videos: _currentAiVideos,
      audios: _currentAiAudios,
      files: _currentAiFiles,
      usage: normalized.usage,
    }, normalized)
    const finalText = mergedState.text || ''
    _currentAiText = mergedState.text
    _currentAiThinking = mergedState.thinking
    _currentAiImages = mergedState.images
    _currentAiVideos = mergedState.videos
    _currentAiAudios = mergedState.audios
    _currentAiFiles = mergedState.files
    const hasContent = mergedState.hasContent
    // 忽略空 final（Gateway 会为一条消息触发多个 run，部分是空 final）
    if (!_currentAiBubble && !hasContent) return
    // 标记 runId 为已处理，防止重复
    if (runId) {
      _seenRunIds.add(runId)
      if (_seenRunIds.size > 200) {
        const first = _seenRunIds.values().next().value
        _seenRunIds.delete(first)
      }
    }
    showTyping(false)
    // 如果流式阶段没有创建 bubble，从 final message 中提取
    if (!_currentAiBubble && hasContent) {
      _currentRunId = payload.runId
      _currentAiBubble = createStreamBubble()
    }
    console.debug('[chat] final normalized', {
      runId,
      textLength: finalText.length,
      thinkingLength: _currentAiThinking.length,
      hasContent,
      images: _currentAiImages.length,
      files: _currentAiFiles.length,
    })
    if (_currentAiBubble) {
      renderFinalMessageContent({
        id: payload.runId || _currentRunId || `assistant-${Date.now()}`,
        role: 'assistant',
        text: _currentAiText,
        thinking: _currentAiThinking,
        timestamp: Date.now(),
        images: _currentAiImages,
        videos: _currentAiVideos,
        audios: _currentAiAudios,
        files: _currentAiFiles,
        meta: buildRuntimeMeta(payload, normalized.usage),
      })
    }
    if (_currentAiText || _currentAiImages.length) {
      const aiMsgId = payload.runId || uuid()
      cacheInboundMessage(_sessionKey, { id: aiMsgId, role: 'assistant', content: _currentAiText })
    }
    resetStreamState()
    processMessageQueue()
    return
  }

  if (state === 'aborted') {
    showTyping(false)
    if (_currentAiBubble && _currentAiText) {
      renderFinalMessageContent({
        id: _currentRunId || `assistant-${Date.now()}`,
        role: 'assistant',
        text: _currentAiText,
        thinking: _currentAiThinking,
        timestamp: Date.now(),
        images: _currentAiImages,
        videos: _currentAiVideos,
        audios: _currentAiAudios,
        files: _currentAiFiles,
      })
    }
    appendSystemMessage(t('pages.chat.generation_stopped'))
    resetStreamState()
    processMessageQueue()
    return
  }

  if (state === 'error') {
    const errMsg = payload.errorMessage || payload.error?.message || t('common.unknown')

    // 连接级错误（origin/pairing/auth）拦截，不作为聊天消息显示
    if (/origin not allowed|NOT_PAIRED|PAIRING_REQUIRED|auth.*fail/i.test(errMsg)) {
      console.warn('[chat] 拦截连接级错误，不显示为聊天消息:', errMsg)
      const overlay = document.getElementById('chat-connect-overlay')
      if (overlay) {
        overlay.style.display = 'flex'
        const desc = document.getElementById('chat-connect-desc')
        if (desc) desc.textContent = t('pages.chat.connect_rejected')
      }
      return
    }

    // 防抖：如果是相同错误且在 2 秒内，忽略（避免重复显示）
    const now = Date.now()
    if (_lastErrorMsg === errMsg && _errorTimer && (now - _errorTimer < 2000)) {
      console.warn('[chat] 忽略重复错误:', errMsg)
      return
    }
    _lastErrorMsg = errMsg
    _errorTimer = now

    // 如果正在流式输出，说明消息已经部分成功，不显示错误
    if (_isStreaming || _currentAiBubble) {
      console.warn('[chat] 流式中收到错误，但消息已部分成功，忽略错误提示:', errMsg)
      return
    }

    showTyping(false)
    appendSystemMessage(t('common.error') + ': ' + errMsg)
    resetStreamState()
    processMessageQueue()
    return
  }
}

function formatTime(date) {
  const now = new Date()
  const h = date.getHours().toString().padStart(2, '0')
  const m = date.getMinutes().toString().padStart(2, '0')
  const isToday = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()
  if (isToday) return `${h}:${m}`
  const mon = (date.getMonth() + 1).toString().padStart(2, '0')
  const day = date.getDate().toString().padStart(2, '0')
  return `${mon}-${day} ${h}:${m}`
}

function formatFileSize(bytes) {
  if (!bytes || bytes <= 0) return ''
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function buildRuntimeMeta(payload, usage) {
  let duration = ''
  if (payload?.durationMs) duration = (payload.durationMs / 1000).toFixed(1) + 's'
  else if (_streamStartTime) duration = ((Date.now() - _streamStartTime) / 1000).toFixed(1) + 's'

  let tokens = ''
  if (usage) {
    const inp = usage.input_tokens || usage.prompt_tokens || 0
    const out = usage.output_tokens || usage.completion_tokens || 0
    const total = usage.total_tokens || (inp + out)
    if (total > 0) tokens = inp && out ? `↑${inp} ↓${out}` : `${total} tokens`
  }

  const model = payload?.model || payload?.message?.model || payload?.message?.modelId || payload?.modelId || ''

  return { duration, tokens, model }
}

function renderFinalMessageContent(message, wrap = _currentAiWrap, bubble = _currentAiBubble) {
  if (!wrap || !bubble) return
  wrap.classList.add('msg-no-anim')
  const vm = normalizeChatMessage({ ...message, streamState: 'final' })
  applyMessageDataset(wrap, vm)
  renderMessageBody(bubble, vm)
  updateMessageMeta(wrap, vm)
  scrollToBottom({ force: true })
}

/** 创建流式 AI 气泡 */
function createStreamBubble() {
  showTyping(false)
  const rendered = renderChatMessage({
    id: _currentRunId || `stream-${Date.now()}`,
    role: 'assistant',
    text: '',
    timestamp: Date.now(),
    streamState: 'streaming',
  })
  _currentAiWrap = rendered.wrap
  _currentAiStreamTextNode = null
  return rendered.bubble
}

function ensurePlainStreamingTextRenderer() {
  if (!_currentAiBubble) return
  if (_currentAiStreamTextNode) return

  _currentAiBubble.innerHTML = ''
  const body = document.createElement('div')
  body.className = 'chat-stream-body'

  const textEl = document.createElement('div')
  textEl.className = 'chat-stream-text'
  const textNode = document.createTextNode('')
  textEl.appendChild(textNode)

  const cursor = document.createElement('span')
  cursor.className = 'stream-cursor'

  body.appendChild(textEl)
  body.appendChild(cursor)
  _currentAiBubble.appendChild(body)
  _currentAiStreamTextNode = textNode
}

function renderStreamingBubbleText(text) {
  if (!_currentAiBubble) return
  ensurePlainStreamingTextRenderer()
  if (!_currentAiStreamTextNode) return
  if (_currentAiStreamTextNode.data !== text) {
    _currentAiStreamTextNode.data = text
  }
}

function doRender() {
  if (!_currentAiBubble) return

  // 检测文本中未闭合的 <think> 标签（流式过程中思考内容还在输出）
  let displayText = _currentAiText
  const hasOpenThink = /<\s*think(?:ing)?\s*>/i.test(displayText) && !/<\s*\/\s*think(?:ing)?\s*>/i.test(displayText)
  if (hasOpenThink) {
    // 文本中有未闭合的 thinking 标签，截取 <think> 之前的内容作为显示文本
    displayText = displayText.replace(/<\s*think(?:ing)?\s*>[\s\S]*$/i, '').trim()
  }

  // 有思考内容但还没有正文时，显示 "正在思考…" 指示
  if ((_currentAiThinking || hasOpenThink) && !displayText) {
    if (!_currentAiBubble.querySelector('.msg-thinking-indicator')) {
      _currentAiBubble.innerHTML = `<div class="msg-thinking-indicator">${t('pages.chat.thinking')}</div>`
      _currentAiStreamTextNode = null
    }
    if (_currentAiWrap) {
      _currentAiWrap.dataset.renderMode = 'plain'
      _currentAiWrap.dataset.streamState = 'streaming'
    }
    scrollToBottom()
    return
  }
  if (displayText) {
    renderStreamingBubbleText(displayText)
    if (_currentAiWrap) {
      _currentAiWrap.dataset.renderMode = 'plain'
      _currentAiWrap.dataset.streamState = 'streaming'
    }
    scrollToBottom()
  }
}

// ensureAiBubble 已被 createStreamBubble 替代

function resetStreamState() {
  clearTimeout(_streamSafetyTimer)
  clearInterval(_typingElapsedInterval)
  _typingElapsedInterval = null
  if (_currentAiBubble && (_currentAiText || _currentAiImages.length || _currentAiVideos.length || _currentAiAudios.length || _currentAiFiles.length)) {
    renderFinalMessageContent({
      id: _currentRunId || `assistant-${Date.now()}`,
      role: 'assistant',
      text: _currentAiText,
      thinking: _currentAiThinking,
      timestamp: Date.now(),
      images: _currentAiImages,
      videos: _currentAiVideos,
      audios: _currentAiAudios,
      files: _currentAiFiles,
    })
  }
  _streamRenderController?.reset()
  _currentAiBubble = null
  _currentAiWrap = null
  _currentAiText = ''
  _currentAiThinking = ''
  _currentAiStreamTextNode = null
  _currentAiImages = []
  _currentAiVideos = []
  _currentAiAudios = []
  _currentAiFiles = []
  _currentRunId = null
  _isStreaming = false
  _streamStartTime = 0
  _lastErrorMsg = null
  _errorTimer = null
  _sendTimestamp = 0
  showTyping(false)
  updateSendState()
}

// ── 响应看门狗：防止页面卡在等待状态 ──
const WATCHDOG_INTERVAL = 15000  // 15s 轮询间隔
const ULTIMATE_TIMEOUT = 180000  // 3 分钟终极超时

function _startResponseWatchdog() {
  // 只清除轮询定时器，不清除终极超时（终极超时应持续到收到响应）
  clearTimeout(_responseWatchdog)
  _responseWatchdog = null
  _sendTimestamp = _sendTimestamp || Date.now()

  // 启动终极超时（3分钟内如果没有收到任何 chat 事件则放弃）
  if (!_ultimateTimer) {
    _ultimateTimer = setTimeout(() => {
      _ultimateTimer = null
      if (!_isStreaming && _sessionKey && _pageActive) {
        console.warn('[chat] 终极超时: 3分钟无 chat 回复')
        showTyping(false)
        appendSystemMessage(t('pages.chat.response_timeout', { seconds: Math.round(ULTIMATE_TIMEOUT / 1000) }))
        _cancelResponseWatchdog()
        resetStreamState()
        processMessageQueue()
      }
    }, ULTIMATE_TIMEOUT)
  }

  _responseWatchdog = setTimeout(async () => {
    _responseWatchdog = null
    // 如果还在等待（未开始流式），强制刷新历史
    if (!_isStreaming && _sessionKey && _messagesEl && _pageActive) {
      const elapsed = Math.round((Date.now() - _sendTimestamp) / 1000)
      console.log(`[chat] 响应看门狗触发：${elapsed}s 无 delta，刷新历史`)
      const oldHash = _lastHistoryHash
      _lastHistoryHash = ''
      await loadHistory()
      // 如果历史有更新，关闭 typing 指示器
      if (_lastHistoryHash && _lastHistoryHash !== oldHash) {
        showTyping(false)
        _cancelUltimateTimer()
      } else {
        // 历史没更新，更新 typing 提示显示已等待时间
        if (elapsed >= 30) {
          showTyping(true, `${t('pages.chat.still_waiting')} (${t('pages.chat.elapsed_time', { seconds: elapsed })})`)
        }
        // 继续等待，再设一轮看门狗
        _startResponseWatchdog()
      }
    }
  }, WATCHDOG_INTERVAL)
}

function _resetWatchdogOnActivity() {
  // agent 事件说明 OpenClaw 在活跃处理，重置轮询看门狗（但不重置终极超时）
  if (_responseWatchdog) {
    clearTimeout(_responseWatchdog)
    _responseWatchdog = setTimeout(async () => {
      _responseWatchdog = null
      if (!_isStreaming && _sessionKey && _messagesEl && _pageActive) {
        const elapsed = _sendTimestamp ? Math.round((Date.now() - _sendTimestamp) / 1000) : 0
        console.log(`[chat] agent 活跃后看门狗触发：${elapsed}s`)
        const oldHash = _lastHistoryHash
        _lastHistoryHash = ''
        await loadHistory()
        if (_lastHistoryHash && _lastHistoryHash !== oldHash) {
          showTyping(false)
          _cancelUltimateTimer()
        } else {
          _startResponseWatchdog()
        }
      }
    }, WATCHDOG_INTERVAL)
  }
}

function _cancelResponseWatchdog() {
  clearTimeout(_responseWatchdog)
  _responseWatchdog = null
  _cancelUltimateTimer()
}

function _cancelUltimateTimer() {
  clearTimeout(_ultimateTimer)
  _ultimateTimer = null
}

// ── 历史消息加载 ──

async function loadHistory() {
  if (!_sessionKey) return
  let hasExisting = Boolean(_messagesEl?.querySelector('.msg'))
  if (!hasExisting) {
    const local = await getCachedMessages(_sessionKey, 200)
    if (local.length) {
      clearMessages()
      const localMessages = local.map(msg => normalizeChatMessage({
        id: msg.id,
        role: msg.role,
        text: msg.content || '',
        timestamp: msg.timestamp || Date.now(),
      }))
      const localGroups = buildChatMessageGroups(localMessages)
      localGroups.forEach(group => {
        const hasRenderable = group.messages.some(message => message.text || message.attachments?.length)
        if (!hasRenderable) return
        renderChatGroup(group, { autoScroll: false })
      })
      _lastHistoryHash = buildHistoryHash(localMessages)
      hasExisting = true
      scrollToBottom({ force: true })
    }
  }
  if (!wsClient.gatewayReady) return
  try {
    const result = await wsClient.chatHistory(_sessionKey, 200)
    const visibleMessages = filterVisibleHistory(dedupeHistory(result?.messages || []), _sessionKey)
    const visibleGroups = buildChatMessageGroups(visibleMessages)
    if (!visibleMessages.length) {
      if (!_messagesEl.querySelector('.msg')) appendSystemMessage(t('pages.chat.no_messages'))
      if (!_isBootstrappingCommand) setFastModeForCurrentSession(true, { auto: true })
      return
    }
    hasExisting = Boolean(_messagesEl?.querySelector('.msg'))
    const hash = buildHistoryHash(visibleMessages)
    if (hash === _lastHistoryHash && hasExisting) return
    _lastHistoryHash = hash

    // 正在发送/流式输出时不全量重绘，避免覆盖本地乐观渲染
    if (hasExisting && (_isSending || _isStreaming || _messageQueue.length > 0 || _isBootstrappingCommand)) {
      saveMessages(visibleMessages.map(m => {
        return { id: uuid(), sessionKey: _sessionKey, role: m.role, content: m.text || '', timestamp: m.timestamp || Date.now() }
      }))
      return
    }

    clearMessages()
    let hasOmittedImages = false
    visibleMessages.forEach(msg => {
      if (msg.role === 'user' && msg.images?.length) {
        const userAtts = msg.images.map(i => ({
          mimeType: i.mediaType || i.media_type || 'image/png',
          content: i.data || i.source?.data || '',
          category: 'image',
        })).filter(a => a.content)
        if (!userAtts.length) hasOmittedImages = true
      }
    })
    visibleGroups.forEach(group => {
      const hasRenderable = group.messages.some(message =>
        message.text || message.images?.length || message.videos?.length || message.audios?.length || message.files?.length || message.attachments?.length
      )
      if (!hasRenderable) return
      renderChatGroup(group, { autoScroll: false })
    })
    if (hasOmittedImages) {
      appendSystemMessage(t('pages.chat.images_unavailable'))
    }
    saveMessages(visibleMessages.map(m => {
      return { id: uuid(), sessionKey: _sessionKey, role: m.role, content: m.text || '', timestamp: m.timestamp || Date.now() }
    }))
    scrollToBottom({ force: true })
  } catch (e) {
    console.error('[chat] loadHistory error:', e)
    if (!_messagesEl.querySelector('.msg')) appendSystemMessage(t('pages.chat.history_failed', { error: e.message }))
  }
}

function dedupeHistory(messages) {
  const normalized = []
  messages.forEach((msg, index) => {
    const rawRole = msg.role || msg.message?.role
    const role = normalizeHistoryRole(rawRole)
    if (!role) return
    const c = extractContent(msg)
    normalized.push(normalizeChatMessage({
      id: msg.runId || msg.id || `${role}-${msg.timestamp || 'na'}-${index}`,
      role,
      kind: rawRole === 'toolResult' || rawRole === 'tool_result' ? 'tool' : 'message',
      text: c.text,
      thinking: c.thinking,
      timestamp: msg.timestamp || Date.now(),
      images: c.images,
      videos: c.videos,
      audios: c.audios,
      files: c.files,
    }))
  })
  return dedupeHistoryMessages(normalized)
}

function extractContent(msg) {
  return extractGatewayChatContent(msg)
}

function normalizeHistoryRole(role) {
  if (role === 'user') return 'user'
  if (role === 'assistant' || role === 'toolResult' || role === 'tool_result') return 'assistant'
  return ''
}

function hashTextFingerprint(text = '') {
  let hash = 5381
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(i)
  }
  return (hash >>> 0).toString(16)
}

function buildHistoryHash(messages = []) {
  return messages.map(message => {
    const attachments = Array.isArray(message.attachments) ? message.attachments : []
    const images = Array.isArray(message.images) ? message.images : []
    const videos = Array.isArray(message.videos) ? message.videos : []
    const audios = Array.isArray(message.audios) ? message.audios : []
    const files = Array.isArray(message.files) ? message.files : []
    const attachmentCount = attachments.length + images.length + videos.length + audios.length + files.length
    return [
      message.role || '',
      message.kind || 'message',
      String(message.timestamp || ''),
      String((message.text || '').length),
      hashTextFingerprint(message.text || ''),
      String(attachmentCount),
    ].join(':')
  }).join('|')
}

// ── DOM 操作 ──

function buildMessageMetaParts(message) {
  const sender = message.role === 'user'
    ? t('pages.chat.sender_you')
    : (message.kind === 'tool' ? t('pages.chat.sender_tool') : 'Assistant')
  const parts = [
    `<span class="chat-sender-name">${escapeHtml(sender)}</span>`,
    `<span class="msg-time">${formatTime(new Date(message.timestamp || Date.now()))}</span>`,
  ]
  const duration = message.meta?.duration
  const tokens = message.meta?.tokens
  const model = message.meta?.model
  const detail = []

  if (model) detail.push(`<span class="msg-model">${escapeHtml(model)}</span>`)
  if (duration) detail.push(`<span class="msg-duration">${escapeHtml(duration)}</span>`)
  if (tokens) detail.push(`<span class="msg-tokens">${escapeHtml(tokens)}</span>`)
  if (detail.length) {
    parts.push(`<span class="msg-meta-detail">${detail.join('<span class="meta-sep">·</span>')}</span>`)
  }
  parts.push(`<button class="msg-copy-btn" title="${t('common.copy')}">${svgIcon('copy', 12)}</button>`)

  return parts.join('')
}

function updateMessageMeta(wrap, message) {
  const meta = wrap.querySelector('.msg-meta')
  if (!meta) return
  meta.classList.toggle('has-detail', Boolean(message.meta?.duration || message.meta?.tokens || message.meta?.model))
  meta.innerHTML = buildMessageMetaParts(message)
}

function applyMessageDataset(wrap, message) {
  wrap.dataset.chatRole = message.role
  wrap.dataset.chatKind = message.kind || 'message'
  wrap.dataset.timestamp = String(message.timestamp || Date.now())
  wrap.dataset.renderMode = message.renderMode || 'plain'
  wrap.dataset.streamState = message.streamState || 'final'
  wrap.dataset.groupPosition = message.groupPosition || 'single'
}

function updateGroupingAroundNode(node) {
  return node
}

function createMessageMeta(message) {
  const meta = document.createElement('div')
  meta.className = 'msg-meta chat-group-footer'
  updateMessageMeta({ querySelector: () => meta }, message)
  return meta
}

function renderUserText(text) {
  return escapeHtml(text).replace(/\n/g, '<br>')
}

function renderAssistantText(message) {
  if (message.renderMode === 'rich') return renderMarkdown(message.text, { mode: 'chat-rich' })
  return renderMarkdown(message.text, { mode: 'plain' })
}

function appendMessageAttachments(el, message) {
  const attachments = Array.isArray(message.attachments) ? message.attachments : []
  appendImagesToEl(el, attachments.filter(item => (item.category || item.type) === 'image'))
  appendVideosToEl(el, attachments.filter(item => (item.category || item.type) === 'video'))
  appendAudiosToEl(el, attachments.filter(item => (item.category || item.type) === 'audio'))
  appendFilesToEl(el, attachments.filter(item => (item.category || item.type) === 'file'))
}

function renderThinkingBlock(thinking) {
  if (!thinking) return ''
  const preview = thinking.length > 40 ? thinking.slice(0, 40) + '…' : thinking
  const safePreview = escapeHtml(preview).replace(/\n/g, ' ')
  const safeContent = escapeHtml(thinking)
  return `<details class="msg-thinking-block"><summary class="msg-thinking-summary">${t('pages.chat.thinking_process')} <span class="msg-thinking-preview">${safePreview}</span></summary><div class="msg-thinking-content">${safeContent}</div></details>`
}

function renderToolOutputBlock(message) {
  if (message.kind !== 'tool' || !message.text) return ''
  return `
    <details class="chat-tool-block">
      <summary class="chat-tool-summary">${t('pages.chat.sender_tool')}</summary>
      <div class="chat-tool-content"><pre class="chat-tool-text">${escapeHtml(message.text)}</pre></div>
    </details>
  `
}

function renderMessageBody(bubble, message) {
  bubble.innerHTML = ''

  if (message.role === 'assistant') {
    const parts = []
    if (message.thinking) parts.push(renderThinkingBlock(message.thinking))
    if (message.kind === 'tool') {
      parts.push(renderToolOutputBlock(message))
    } else if (message.text) {
      parts.push(`<div class="chat-message-body">${renderAssistantText(message)}</div>`)
    }
    bubble.innerHTML = parts.join('')
    appendMessageAttachments(bubble, message)
    bubble.querySelectorAll('img').forEach(img => { if (!img.onclick) img.onclick = () => showLightbox(img.src) })
    return
  }

  if (message.attachments?.length) appendMessageAttachments(bubble, message)
  if (message.text) {
    const textNode = document.createElement('div')
    textNode.className = 'msg-user-text chat-message-body'
    textNode.innerHTML = renderUserText(message.text)
    bubble.appendChild(textNode)
  }
}

function renderChatGroup(group, { autoScroll = true } = {}) {
  const messages = Array.isArray(group?.messages) && group.messages.length
    ? group.messages.map(message => normalizeChatMessage(message))
    : [normalizeChatMessage(group)]
  const lastMessage = messages[messages.length - 1]
  const wrap = document.createElement('div')
  wrap.className = `msg chat-group chat-group-${lastMessage.role}`
  wrap.dataset.messageId = lastMessage.id || group?.id || ''
  applyMessageDataset(wrap, lastMessage)

  const body = document.createElement('div')
  body.className = 'chat-group-messages'

  let lastBubble = null
  messages.forEach(message => {
    const shell = document.createElement('div')
    shell.className = `chat-bubble-shell chat-bubble-shell-${message.role}${message.kind === 'tool' ? ' is-tool' : ''}`
    shell.dataset.kind = message.kind || 'message'

    const bubble = document.createElement('div')
    bubble.className = `chat-bubble ${message.role === 'user' ? 'chat-bubble-user' : 'chat-bubble-assistant'}`
    if (message.streamState === 'streaming') bubble.classList.add('is-streaming')
    renderMessageBody(bubble, message)

    shell.appendChild(bubble)
    body.appendChild(shell)
    lastBubble = bubble
  })

  const meta = createMessageMeta(lastMessage)

  wrap.appendChild(body)
  wrap.appendChild(meta)
  _messagesEl.insertBefore(wrap, _typingEl)
  if (autoScroll === 'force') scrollToBottom({ force: true })
  else if (autoScroll) scrollToBottom()
  return { wrap, bubble: lastBubble, meta }
}

function renderChatMessage(message, { autoScroll = true } = {}) {
  const [group] = buildChatMessageGroups([message])
  return renderChatGroup(group, { autoScroll })
}

function appendUserMessage(text, attachments = [], msgTime) {
  renderChatMessage({
    id: `user-${msgTime?.getTime?.() || Date.now()}`,
    role: 'user',
    text,
    timestamp: msgTime?.getTime?.() || Date.now(),
    attachments: attachments.map(att => ({
      ...att,
      category: att.category || att.type || 'image',
    })),
  }, { autoScroll: 'force' })
}

function appendAiMessage(text, msgTime, images, videos, audios, files) {
  renderChatMessage({
    id: `assistant-${msgTime?.getTime?.() || Date.now()}`,
    role: 'assistant',
    text,
    timestamp: msgTime?.getTime?.() || Date.now(),
    images,
    videos,
    audios,
    files,
  })
}

/** 渲染图片到消息气泡（支持 Anthropic/OpenAI/直接格式） */
function appendImagesToEl(el, images) {
  if (!images?.length) return
  const container = document.createElement('div')
  container.className = 'msg-media-grid'
  images.forEach(img => {
    const imgEl = document.createElement('img')
    // Anthropic 格式: { type: 'image', source: { data, media_type } }
    if (img.source?.data) {
      imgEl.src = `data:${img.source.media_type || 'image/png'};base64,${img.source.data}`
    // 直接格式: { data, mediaType }
    } else if (img.data) {
      imgEl.src = `data:${img.mediaType || img.media_type || 'image/png'};base64,${img.data}`
    // OpenAI 格式: { type: 'image_url', image_url: { url } }
    } else if (img.image_url?.url) {
      imgEl.src = img.image_url.url
    // URL 格式
    } else if (img.url) {
      imgEl.src = img.url
    } else {
      return
    }
    imgEl.className = 'msg-img'
    imgEl.onclick = () => showLightbox(imgEl.src)
    container.appendChild(imgEl)
  })
  if (container.children.length) el.appendChild(container)
}

/** 渲染视频到消息气泡 */
function appendVideosToEl(el, videos) {
  if (!videos?.length) return
  videos.forEach(vid => {
    const videoEl = document.createElement('video')
    videoEl.className = 'msg-video'
    videoEl.controls = true
    videoEl.preload = 'metadata'
    videoEl.playsInline = true
    if (vid.data) videoEl.src = `data:${vid.mediaType};base64,${vid.data}`
    else if (vid.url) videoEl.src = vid.url
    el.appendChild(videoEl)
  })
}

/** 渲染音频到消息气泡 */
function appendAudiosToEl(el, audios) {
  if (!audios?.length) return
  audios.forEach(aud => {
    const audioEl = document.createElement('audio')
    audioEl.className = 'msg-audio'
    audioEl.controls = true
    audioEl.preload = 'metadata'
    if (aud.data) audioEl.src = `data:${aud.mediaType};base64,${aud.data}`
    else if (aud.url) audioEl.src = aud.url
    el.appendChild(audioEl)
  })
}

/** 渲染文件卡片到消息气泡 */
function appendFilesToEl(el, files) {
  if (!files?.length) return
  files.forEach(f => {
    const card = document.createElement('div')
    card.className = 'msg-file-card'
    const fileName = f.name || f.fileName || t('pages.chat.file')
    const ext = fileName.split('.').pop().toLowerCase()
    const fileIconMap = { pdf: 'file', doc: 'file-text', docx: 'file-text', txt: 'file-plain', md: 'file-plain', json: 'clipboard', csv: 'bar-chart', zip: 'package', rar: 'package' }
    const fileIcon = svgIcon(fileIconMap[ext] || 'paperclip', 16)
    const size = f.size ? formatFileSize(f.size) : ''
    card.innerHTML = `<span class="msg-file-icon">${fileIcon}</span><div class="msg-file-info"><span class="msg-file-name">${fileName}</span>${size ? `<span class="msg-file-size">${size}</span>` : ''}</div>`
    if (f.url) {
      card.style.cursor = 'pointer'
      card.onclick = () => window.open(f.url, '_blank')
    } else if (f.data) {
      card.style.cursor = 'pointer'
      card.onclick = () => {
        const a = document.createElement('a')
        a.href = `data:${f.mimeType || 'application/octet-stream'};base64,${f.data}`
        a.download = f.name || t('pages.chat.file')
        a.click()
      }
    }
    el.appendChild(card)
  })
}

/** 图片灯箱查看 */
function showLightbox(src) {
  const existing = document.querySelector('.chat-lightbox')
  if (existing) existing.remove()
  const lb = document.createElement('div')
  lb.className = 'chat-lightbox'
  lb.innerHTML = `<img src="${src}" class="chat-lightbox-img" />`
  lb.onclick = (e) => { if (e.target === lb || e.target.tagName !== 'IMG') lb.remove() }
  document.body.appendChild(lb)
  // ESC 关闭
  const onKey = (e) => { if (e.key === 'Escape') { lb.remove(); document.removeEventListener('keydown', onKey) } }
  document.addEventListener('keydown', onKey)
}

function appendSystemMessage(text) {
  const wrap = document.createElement('div')
  wrap.className = 'msg msg-system'
  wrap.textContent = text
  _messagesEl.insertBefore(wrap, _typingEl)
  updateGroupingAroundNode(wrap.previousElementSibling)
  scrollToBottom({ force: true })
}

function clearMessages() {
  _messagesEl.querySelectorAll('.msg').forEach(m => m.remove())
  _currentAiBubble = null
  _currentAiWrap = null
  _currentAiText = ''
  _currentAiThinking = ''
  _currentAiStreamTextNode = null
  _shouldAutoFollow = true
  if (_scrollBtn) _scrollBtn.style.display = 'none'
}

let _typingElapsedInterval = null
function showTyping(show, hint) {
  if (_typingEl) {
    _typingEl.style.display = show ? 'flex' : 'none'
    // 更新提示文字（如工具调用状态）
    const hintEl = _typingEl.querySelector('.typing-hint')
    if (hintEl) hintEl.textContent = hint || ''

    // 管理已用时间显示
    let elapsedEl = _typingEl.querySelector('.typing-elapsed')
    if (show && _sendTimestamp) {
      if (!elapsedEl) {
        elapsedEl = document.createElement('span')
        elapsedEl.className = 'typing-elapsed'
        _typingEl.appendChild(elapsedEl)
      }
      const updateElapsed = () => {
        if (!_sendTimestamp || !_typingEl) return
        const sec = Math.round((Date.now() - _sendTimestamp) / 1000)
        if (sec >= 5 && elapsedEl) elapsedEl.textContent = t('pages.chat.elapsed_time', { seconds: sec })
      }
      updateElapsed()
      clearInterval(_typingElapsedInterval)
      _typingElapsedInterval = setInterval(updateElapsed, 5000)
    } else {
      clearInterval(_typingElapsedInterval)
      _typingElapsedInterval = null
      if (elapsedEl) elapsedEl.textContent = ''
    }
  }
  if (show) scrollToBottom()
}

function showCompactionHint(show) {
  let hint = _page?.querySelector('#compaction-hint')
  if (show && !hint && _messagesEl) {
    hint = document.createElement('div')
    hint.id = 'compaction-hint'
    hint.className = 'msg msg-system compaction-hint'
    hint.innerHTML = t('pages.chat.hint_compaction')
    _messagesEl.insertBefore(hint, _typingEl)
    updateGroupingAroundNode(hint.previousElementSibling)
    scrollToBottom()
  } else if (!show && hint) {
    const prev = hint.previousElementSibling
    const next = hint.nextElementSibling
    hint.remove()
    updateGroupingAroundNode(prev)
    updateGroupingAroundNode(next)
  }
}

function scrollToBottom({ force = false } = {}) {
  if (!_messagesEl) return
  if (!force && !_shouldAutoFollow) return
  const apply = () => {
    if (_messagesEl) {
      _messagesEl.scrollTop = _messagesEl.scrollHeight
      _shouldAutoFollow = true
      if (_scrollBtn) _scrollBtn.style.display = 'none'
    }
  }
  if (typeof requestAnimationFrame === 'function' && !(typeof document !== 'undefined' && document.hidden)) {
    requestAnimationFrame(apply)
  } else {
    setTimeout(apply, 0)
  }
}

function updateSendState() {
  if (!_sendBtn || !_textarea) return
  if (_isStreaming) {
    _sendBtn.disabled = false
    _sendBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>'
    _sendBtn.title = t('pages.chat.stop_generation')
  } else {
    _sendBtn.disabled = !_textarea.value.trim() && !_attachments.length
    _sendBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>'
    _sendBtn.title = t('pages.chat.send')
  }
}

function updateStatusDot(status) {
  if (!_statusDot) return
  _statusDot.className = 'status-dot'
  if (status === 'ready' || status === 'connected') _statusDot.classList.add('online')
  else if (status === 'connecting' || status === 'reconnecting') _statusDot.classList.add('connecting')
  else _statusDot.classList.add('offline')
}

// ── 页面离开清理 ──

export function cleanup() {
  _pageActive = false
  if (_unsubEvent) { _unsubEvent(); _unsubEvent = null }
  if (_unsubReady) { _unsubReady(); _unsubReady = null }
  if (_unsubStatus) { _unsubStatus(); _unsubStatus = null }
  if (_onDocumentVisibilityChange) {
    document.removeEventListener('visibilitychange', _onDocumentVisibilityChange)
    _onDocumentVisibilityChange = null
  }
  if (_onWindowFocus) {
    window.removeEventListener('focus', _onWindowFocus)
    _onWindowFocus = null
  }
  if (_textareaCompositionCleanup) {
    _textareaCompositionCleanup()
    _textareaCompositionCleanup = null
  }
  _textareaComposition.reset()
  clearTimeout(_streamSafetyTimer)
  clearInterval(_typingElapsedInterval)
  _typingElapsedInterval = null
  _cancelResponseWatchdog()
  _sendTimestamp = 0
  clearHiddenCommandTimeout()
  // 不断开 wsClient —— 它是全局单例，保持连接供下次进入复用
  _sessionKey = null
  _page = null
  _messagesEl = null
  _textarea = null
  _sendBtn = null
  _statusDot = null
  _typingEl = null
  _scrollBtn = null
  _sessionListEl = null
  _cmdPanelEl = null
  _fastModeBtn = null
  _currentAiBubble = null
  _currentAiWrap = null
  _currentAiText = ''
  _currentAiStreamTextNode = null
  _currentAiImages = []
  _currentAiVideos = []
  _currentAiAudios = []
  _currentAiFiles = []
  _currentRunId = null
  _isStreaming = false
  _isSending = false
  _isBootstrappingCommand = false
  _messageQueue = []
  _hiddenSessionCommand = null
  _streamRenderController?.reset()
  _streamRenderController = null
  _lastHistoryHash = ''
  _shouldAutoFollow = true
}
