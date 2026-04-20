import '../style/evoscientist.css'
import { exportAndNotify } from '../lib/doc-export.js'
import { t } from '../lib/i18n.js'
import { api, invalidate } from '../lib/tauri-api.js'
import { fetchOpenclawPrimaryModel, openclawProviderToApiType, apiTypeToProvider } from '../lib/model-presets.js'
import { toast } from '../components/toast.js'
import { showContentModal } from '../components/modal.js'
import { renderMarkdown } from '../lib/markdown.js'
import { icon } from '../lib/icons.js'
import { getCurrentRouteState, navigate } from '../router.js'
import { wsClient } from '../lib/ws-client.js'
import {
  attachView,
  createSession,
  detachView,
  setSessionHandlers,
  updateSessionSnapshot,
} from '../lib/assistant-runtime.js'
import {
  applyEvoscientistStatus,
  EVOSCIENTIST_FIELD_LABELS as FIELD_LABELS,
  EVOSCIENTIST_PROVIDERS as PROVIDERS,
  getEvoscientistConfigIssues,
  getEvoscientistProviderFields as providerFields,
  getEvoscientistReadinessSnapshot,
  normalizeEvoscientistConfig as normalizeConfig,
  onEvoscientistReadinessChange,
  refreshEvoscientistReadiness,
} from '../lib/evoscientist-readiness.js'
import {
  buildEvoscientistPersonaOverlay,
  buildEvoscientistPersonaPackage,
  createDefaultEvoscientistPersona,
  createPersonaFromAgentSnapshot,
  createPersonaFromAssistantSnapshot,
  loadEvoscientistPersona,
  normalizeEvoscientistPersona,
  readAgentFleetOptions,
  readAgentPersonaSnapshot,
  readLocalAssistantPersonaSnapshot,
  saveEvoscientistPersona,
} from '../lib/evoscientist-persona.js'
import { getEvoscientistRuntimePaths, resolveSelectedThreadId } from '../lib/evoscientist-state.js'
import {
  EVOSCIENTIST_TABS,
  getEvoscientistTabMeta,
  getEvoscientistNextStep,
  summarizeEvoscientistTimelineEntry,
} from '../lib/evoscientist-ui.js'
const IS_TAURI = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__
const IS_MAC = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform || '')
const LISTEN_READY = IS_TAURI
  ? import('@tauri-apps/api/event').then(mod => mod.listen).catch(() => null)
  : Promise.resolve(null)

let _openFolderDialog = null
let _desktopDirFn = null
const _dialogReady = IS_TAURI
  ? import('@tauri-apps/plugin-dialog').then(m => { _openFolderDialog = m.open; return m.open }).catch(() => null)
  : Promise.resolve(null)
const _pathReady = IS_TAURI
  ? import('@tauri-apps/api/path').then(m => { _desktopDirFn = m.desktopDir; return m.desktopDir }).catch(() => null)
  : Promise.resolve(null)

let _sendTimeoutId = null
let _exportPathInitStarted = false
let _page = null
let _statusEl = null
let _chatLayoutEl = null
let _sessionsEl = null
let _chatEl = null
let _settingsEl = null
let _debugEl = null
let _timelineScrollEl = null
let _personaImportEl = null
let _viewId = null
let _runtimeSessionId = null
let _unlistenEvent = null
let _unlistenInstallLog = null
let _unlistenInstallProgress = null
let _unlistenReadiness = null

let _state = {
  bootstrapped: false,
  loadingStatus: false,
  loadingSessions: false,
  installing: false,
  savingConfig: false,
  startingBridge: false,
  stoppingBridge: false,
  sending: false,
  status: null,
  sessions: [],
  timeline: [],
  installLogs: [],
  installProgress: 0,
  configDraft: normalizeConfig(),
  configDirty: false,
  composerText: '',
  selectedThreadId: '',
  threadSelectionLocked: false,
  selectedWorkspaceDir: (() => { try { return localStorage.getItem('prospectclaw-evo-workspace-dir') || '' } catch { return '' } })(),
  pendingInterrupt: null,
  pendingAskUser: null,
  askUserAnswers: {},
  activeAssistantEntryId: null,
  activeThinkingEntryId: null,
  runtimeSnapshot: null,
  chatNotice: '',
  personaLoaded: false,
  personaDraft: createDefaultEvoscientistPersona(),
  assistantPersonaSnapshot: null,
  agentFleetOptions: [],
  agentFleetStatus: 'idle', // 'idle' | 'loading' | 'loaded'
  selectedAgentId: '',
  agentPersonaPreview: null,
  taskCompleted: false,
  taskOutput: '',
  taskOutputThreadId: '',
  taskRunStartIndex: 0,
  exportBusy: false,
  exportSavePath: '',
  timelineExpanded: false,
}

// 人格等级字段 — 使用 getter 以确保 t() 在函数内调用
function getPersonaLevelFields() {
  return [
    {
      key: 'rigor',
      label: t('pages.evoscientist.persona_level_rigor'),
      copy: t('pages.evoscientist.persona_level_rigor_copy'),
      options: ['探索优先', '轻度求证', '平衡求证', '强依据导向', '极度严谨'],
    },
    {
      key: 'initiative',
      label: t('pages.evoscientist.persona_level_initiative'),
      copy: t('pages.evoscientist.persona_level_initiative_copy'),
      options: ['等待指令', '按需推进', '适度主动', '主动拆解', '强 ownership'],
    },
    {
      key: 'restraint',
      label: t('pages.evoscientist.persona_level_restraint'),
      copy: t('pages.evoscientist.persona_level_restraint_copy'),
      options: ['表达大胆', '略偏直接', '平衡克制', '审慎克制', '高度审慎'],
    },
    {
      key: 'architecture',
      label: t('pages.evoscientist.persona_level_architecture'),
      copy: t('pages.evoscientist.persona_level_architecture_copy'),
      options: ['单点处理', '局部串联', '兼顾结构', '明显分层', '强系统视角'],
    },
  ]
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatTime(value) {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

function formatRelativeTime(value) {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const diff = Date.now() - date.getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return t('pages.evoscientist.format_just_now')
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return t('pages.evoscientist.format_minutes_ago', { n: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('pages.evoscientist.format_hours_ago', { n: hours })
  const days = Math.floor(hours / 24)
  if (days < 30) return t('pages.evoscientist.format_days_ago', { n: days })
  return formatTime(value)
}

function shortId(value, keep = 8) {
  if (!value) return '--'
  const text = String(value)
  return text.length <= keep ? text : text.slice(0, keep)
}

function stringifyPretty(value) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function getQuickConfigFieldPlaceholder(field) {
  if (field === 'ollama_base_url') return 'http://127.0.0.1:11434'
  if (field.includes('base_url')) return 'https://...'
  return ''
}

function renderQuickConfigFields(config = {}) {
  const fields = providerFields(config.provider)
  return fields.map(field => `
    <div class="form-group" style="margin-bottom:10px">
      <label class="form-label">${escapeHtml(FIELD_LABELS[field] || field)}</label>
      <input
        class="form-input"
        ${field.includes('key') ? 'type="password"' : ''}
        data-quick-config-field="${escapeHtml(field)}"
        value="${escapeHtml(config[field] || '')}"
        placeholder="${escapeHtml(getQuickConfigFieldPlaceholder(field))}"
      />
    </div>
  `).join('')
}

function getThreadDisplayName(threadId) {
  const newThreadLabel = t('pages.evoscientist.new_thread')
  if (!threadId || threadId === newThreadLabel) return newThreadLabel
  const session = (_state.sessions || []).find(
    item => (item.thread_id || item.threadId) === threadId
  )
  if (session) {
    const preview = session.preview || session.summary || ''
    if (preview) return summarizeText(preview, 28)
  }
  return shortId(threadId, 18)
}

function currentReadiness() {
  if (_state.status) {
    return getEvoscientistReadinessSnapshot() || applyEvoscientistStatus(_state.status)
  }
  return getEvoscientistReadinessSnapshot()
}

function getCurrentTab() {
  const routeState = getCurrentRouteState()
  const tab = String(routeState?.query?.tab || 'chat').trim()
  return EVOSCIENTIST_TABS.some(item => item.key === tab) ? tab : 'chat'
}

function switchTab(tab) {
  const safeTab = EVOSCIENTIST_TABS.some(item => item.key === tab) ? tab : 'chat'
  navigate({ path: '/evoscientist', query: { tab: safeTab } })
}

function summarizeText(value, limit = 96) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (!text) return ''
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`
}

function renderActionButtons(actions = [], size = 'btn-sm') {
  return actions.map(item => {
    const className = item.tone === 'primary' ? `btn btn-primary ${size}` : `btn btn-secondary ${size}`
    const attrs = item.tab
      ? `data-action="switch-tab" data-tab="${escapeHtml(item.tab)}"`
      : `data-action="${escapeHtml(item.action || '')}"`
    return `<button class="${className}" ${attrs} ${item.disabled ? 'disabled' : ''}>${escapeHtml(item.label)}</button>`
  }).join('')
}

function hydrateActionState(actions = []) {
  return actions.map(item => {
    if (item.action === 'install-evoscientist') {
      return { ...item, disabled: _state.installing }
    }
    if (item.action === 'start-bridge') {
      return { ...item, disabled: _state.startingBridge || !_state.status?.installed }
    }
    if (item.action === 'refresh-status') {
      return { ...item, disabled: _state.loadingStatus }
    }
    return item
  })
}

function renderAdvancedDetails({
  title,
  copy = '',
  content = '',
  open = false,
  className = '',
}) {
  return `
    <details class="evosci-advanced-details${className ? ` ${className}` : ''}" ${open ? 'open' : ''}>
      <summary>
        <span>${escapeHtml(title)}</span>
        ${copy ? `<span class="evosci-muted">${escapeHtml(copy)}</span>` : ''}
      </summary>
      <div class="evosci-advanced-body">${content}</div>
    </details>
  `
}

function hasBlockingInteraction() {
  return !!(_state.pendingInterrupt || _state.pendingAskUser)
}

function clearTaskOutputState() {
  _state.taskCompleted = false
  _state.taskOutput = ''
  _state.taskOutputThreadId = ''
}

function beginTaskRun() {
  clearTaskOutputState()
  _state.taskRunStartIndex = _state.timeline.length
}

let _observedCache = { len: -1, result: [] }
function collectObservedScientists() {
  if (_state.timeline.length === _observedCache.len) return _observedCache.result
  const seen = new Map()

  for (const entry of _state.timeline) {
    if (!String(entry.kind || '').startsWith('subagent_')) continue
    const payload = entry.payload || {}
    const name = String(payload.subagent || payload.name || entry.label || 'Scientist').trim() || 'Scientist'
    const role = String(entry.kind || '').replace('subagent_', '') || 'event'
    const current = seen.get(name) || {
      name,
      count: 0,
      roles: new Set(),
      lastSeen: entry.timestamp,
      preview: '',
    }
    current.count += 1
    current.roles.add(role)
    current.lastSeen = entry.timestamp || current.lastSeen
    if (!current.preview) {
      current.preview = summarizeText(entry.content || payload.content || payload.message || '')
    }
    seen.set(name, current)
  }

  const result = Array.from(seen.values())
    .map(item => ({
      ...item,
      roles: Array.from(item.roles),
    }))
    .sort((left, right) => right.count - left.count || String(right.lastSeen || '').localeCompare(String(left.lastSeen || '')))
  _observedCache = { len: _state.timeline.length, result }
  return result
}

function collectArchitectureStats() {
  return _state.timeline.reduce((summary, entry) => {
    if (entry.kind === 'tool_call') summary.toolCalls += 1
    if (entry.kind === 'interrupt') summary.interrupts += 1
    if (entry.kind === 'ask_user') summary.askUser += 1
    if (String(entry.kind || '').startsWith('subagent_')) summary.subagentEvents += 1
    return summary
  }, {
    toolCalls: 0,
    interrupts: 0,
    askUser: 0,
    subagentEvents: 0,
  })
}

function ensurePersonaState() {
  if (_state.personaLoaded) return
  _state.personaDraft = loadEvoscientistPersona()
  _state.assistantPersonaSnapshot = readLocalAssistantPersonaSnapshot()
  _state.personaLoaded = true
}

function refreshAssistantPersonaSnapshot() {
  _state.assistantPersonaSnapshot = readLocalAssistantPersonaSnapshot()
  return _state.assistantPersonaSnapshot
}

function savePersonaDraft() {
  _state.personaDraft = normalizeEvoscientistPersona(_state.personaDraft)
  saveEvoscientistPersona(_state.personaDraft)
}

function personaSourceLabel(source = _state.personaDraft?.source) {
  if (source === 'agent-fleet') return t('pages.evoscientist.persona_source_agent_fleet')
  if (source === 'assistant') return t('pages.evoscientist.persona_source_assistant')
  if (source === 'openclaw') return t('pages.evoscientist.persona_source_openclaw')
  if (source === 'imported') return t('pages.evoscientist.persona_source_imported')
  return t('pages.evoscientist.persona_source_manual')
}

function assistantSoulLabel(snapshot = _state.assistantPersonaSnapshot) {
  if (String(snapshot?.soulSource || '').startsWith('openclaw:')) return t('pages.evoscientist.assistant_soul_openclaw')
  return t('pages.evoscientist.assistant_soul_default')
}

function getPersonaFieldMeta(key) {
  const fields = getPersonaLevelFields()
  return fields.find(item => item.key === key) || fields[0]
}

function personaLevelLabel(key, level) {
  const field = getPersonaFieldMeta(key)
  const options = Array.isArray(field.options) ? field.options : []
  return options[Math.max(0, Math.min(options.length - 1, Number(level || 1) - 1))] || ''
}

function personaLevelPercent(level) {
  const safeLevel = Math.max(1, Math.min(5, Number(level || 1)))
  return safeLevel * 20
}

function renderPersonaMeters(persona = _state.personaDraft) {
  const profile = normalizeEvoscientistPersona(persona)
  return `
    <div class="evosci-persona-meter-list">
      ${getPersonaLevelFields().map(field => {
        const level = profile.levels[field.key]
        return `
          <div class="evosci-persona-meter">
            <div class="evosci-persona-meter-head">
              <span>${escapeHtml(field.label)}</span>
              <span>${escapeHtml(`${level}/5 · ${personaLevelLabel(field.key, level)}`)}</span>
            </div>
            <div class="evosci-persona-meter-track">
              <div class="evosci-persona-meter-fill" style="width:${personaLevelPercent(level)}%"></div>
            </div>
          </div>
        `
      }).join('')}
    </div>
  `
}

// 智能体原型 — 使用 getter 以确保 t() 在函数内调用
function getAgentArchetypes() {
  return [
  {
    id: 'review',
    pattern: /(review|critic|audit|verify|check|judge|qa|复核|校验|审计|验证)/,
    label: t('pages.evoscientist.archetype_review'), tone: t('pages.evoscientist.archetype_review_tone'), pillTone: 'warn',
    codeName: '审慎\u00b7校验', emoji: '\ud83d\udd0d', badgeColor: '#f59e0b',
    // 8x8 pixel avatar: magnifying glass face
    pixelArt: [
      '..1111..',
      '.1....1.',
      '1..11..1',
      '1..11..1',
      '1......1',
      '.1.11.1.',
      '..1111..',
      '....11..',
    ],
  },
  {
    id: 'research',
    pattern: /(research|search|gather|survey|analysis|researcher|研究|检索|调研|搜索)/,
    label: t('pages.evoscientist.archetype_research'), tone: t('pages.evoscientist.archetype_research_tone'), pillTone: 'ok',
    codeName: '探索\u00b7检索', emoji: '\ud83e\uddea', badgeColor: '#5A72EE',
    pixelArt: [
      '..1111..',
      '.1....1.',
      '1..11..1',
      '1......1',
      '1.1111.1',
      '.1....1.',
      '..1111..',
      '.11..11.',
    ],
  },
  {
    id: 'synthesis',
    pattern: /(summary|synth|report|write|draft|汇总|总结|报告|成文)/,
    label: t('pages.evoscientist.archetype_synthesis'), tone: t('pages.evoscientist.archetype_synthesis_tone'), pillTone: '',
    codeName: '收束\u00b7成文', emoji: '\ud83d\udccb', badgeColor: '#8b5cf6',
    pixelArt: [
      '..1111..',
      '.1....1.',
      '1..11..1',
      '1..11..1',
      '1......1',
      '.1....1.',
      '..1111..',
      '.11..11.',
    ],
  },
  {
    id: 'execution',
    pattern: /(code|implement|patch|build|fix|execute|执行|修复|实现)/,
    label: t('pages.evoscientist.archetype_execution'), tone: t('pages.evoscientist.archetype_execution_tone'), pillTone: 'ok',
    codeName: '落地\u00b7操作', emoji: '\u26a1', badgeColor: '#10b981',
    pixelArt: [
      '..1111..',
      '.1....1.',
      '1..11..1',
      '1......1',
      '1..11..1',
      '.1....1.',
      '..1111..',
      '.11..11.',
    ],
  },
  {
    id: 'topic',
    pattern: null,
    label: t('pages.evoscientist.archetype_topic'), tone: t('pages.evoscientist.archetype_topic_tone'), pillTone: '',
    codeName: '焦点\u00b7协作', emoji: '\ud83c\udfaf', badgeColor: '#64748b',
    pixelArt: [
      '..1111..',
      '.1....1.',
      '1.1..1.1',
      '1......1',
      '1..11..1',
      '.1....1.',
      '..1111..',
      '.11..11.',
    ],
  },
  ]
}

function inferScientistArchetype(item = {}) {
  const haystack = `${item.name || ''} ${item.preview || ''}`.toLowerCase()
  const archetypes = getAgentArchetypes()
  for (const arch of archetypes) {
    if (arch.pattern && arch.pattern.test(haystack)) return arch
  }
  return archetypes[archetypes.length - 1]
}

function buildPixelAvatarShadow(pixelArt, color) {
  const px = 3
  const shadows = []
  for (let row = 0; row < pixelArt.length; row++) {
    for (let col = 0; col < pixelArt[row].length; col++) {
      if (pixelArt[row][col] === '1') {
        shadows.push(`${col * px}px ${row * px}px 0 ${color}`)
      }
    }
  }
  return shadows.join(',')
}

function renderAgentAvatar(archetype, size = 24) {
  const px = Math.round(size / 8)
  const shadow = buildPixelAvatarShadow(archetype.pixelArt, archetype.badgeColor)
  return `<span class="evosci-agent-avatar" style="width:${size}px;height:${size}px" title="${escapeHtml(archetype.codeName)}"><span class="evosci-pixel-sprite" style="box-shadow:${shadow};width:${px}px;height:${px}px"></span></span>`
}

function renderAgentBadge(item, archetype) {
  return `
    <div class="evosci-agent-badge" style="--badge-color:${archetype.badgeColor}">
      ${renderAgentAvatar(archetype, 28)}
      <div class="evosci-agent-badge-info">
        <div class="evosci-agent-badge-name">${escapeHtml(item.name || archetype.codeName)}</div>
        <div class="evosci-agent-badge-role">${escapeHtml(archetype.codeName)} &middot; ${escapeHtml(archetype.label)}</div>
      </div>
    </div>
  `
}

function renderSwarmPanel(scientists, { id = '' } = {}) {
  if (!scientists.length) return ''
  const radius = Math.max(80, 60 + scientists.length * 12)
  const arenaSize = radius * 2 + 120
  const cx = arenaSize / 2
  const cy = arenaSize / 2

  const particles = Array.from({ length: 8 }, (_, i) => {
    const x = Math.round(Math.random() * arenaSize)
    const y = Math.round(Math.random() * arenaSize)
    const dur = (4 + Math.random() * 4).toFixed(1)
    const delay = (Math.random() * 3).toFixed(1)
    const dx = Math.round((Math.random() - 0.5) * 40)
    const dy = Math.round((Math.random() - 0.5) * 40)
    const dx2 = Math.round((Math.random() - 0.5) * 30)
    const dy2 = Math.round((Math.random() - 0.5) * 30)
    const dx3 = Math.round((Math.random() - 0.5) * 35)
    const dy3 = Math.round((Math.random() - 0.5) * 35)
    return `<span class="evosci-swarm-particle" style="left:${x}px;top:${y}px;--dur:${dur}s;--delay:${delay}s;--dx:${dx}px;--dy:${dy}px;--dx2:${dx2}px;--dy2:${dy2}px;--dx3:${dx3}px;--dy3:${dy3}px"></span>`
  }).join('')

  const nodes = scientists.slice(0, 8).map((item, idx) => {
    const archetype = inferScientistArchetype(item)
    const angle = (2 * Math.PI * idx) / Math.min(scientists.length, 8) - Math.PI / 2
    const nx = cx + radius * Math.cos(angle) - 26
    const ny = cy + radius * Math.sin(angle) - 36
    const connLen = radius - 36
    const connAngleDeg = (angle * 180 / Math.PI).toFixed(1)
    return `
      <div class="evosci-swarm-connector" style="width:${connLen}px;transform:rotate(${connAngleDeg}deg);--badge-color:${archetype.badgeColor}"></div>
      <div class="evosci-swarm-node" style="left:${nx.toFixed(0)}px;top:${ny.toFixed(0)}px;--enter-delay:${(idx * 0.1).toFixed(1)}s;--breathe-delay:${(idx * 0.4).toFixed(1)}s;--badge-color:${archetype.badgeColor}">
        <div class="evosci-swarm-node-bubble">
          ${renderAgentAvatar(archetype, 28)}
        </div>
        <div class="evosci-swarm-node-label" title="${escapeHtml(item.name)}">${escapeHtml(item.name || archetype.codeName)}</div>
        <div class="evosci-swarm-node-count">${escapeHtml(archetype.codeName)} &middot; ${item.count}</div>
      </div>
    `
  }).join('')

  return `
    <div class="evosci-swarm-panel"${id ? ` id="${id}"` : ''}>
      ${particles}
      <div class="evosci-swarm-header">
        <span class="evosci-swarm-title">${escapeHtml(t('pages.evoscientist.swarm_title', { count: scientists.length }))}</span>
        <span class="evosci-pill">${escapeHtml(t('pages.evoscientist.swarm_tool_calls', { count: collectArchitectureStats().toolCalls }))}</span>
      </div>
      <div class="evosci-swarm-arena" style="height:${arenaSize}px">
        <div class="evosci-swarm-ring" style="width:${arenaSize}px;height:${arenaSize}px">
          ${nodes}
        </div>
        <div class="evosci-swarm-center">
          ${icon('box', 20)}
          <span class="evosci-swarm-center-label">Coordinator</span>
        </div>
      </div>
    </div>
  `
}

function collectTaskOutput(startIndex = _state.taskRunStartIndex || 0) {
  const sliced = _state.timeline.slice(Math.max(0, Number(startIndex) || 0))
  // 优先取 assistant 回复
  const assistantOutput = sliced
    .filter(e => e.kind === 'assistant' && e.content)
    .map(e => e.content)
    .join('\n\n')
  if (assistantOutput.trim()) return assistantOutput
  // 如果没有 assistant 输出，降级取 subagent synthesis/research 等条目
  return sliced
    .filter(e => String(e.kind || '').startsWith('subagent_') && e.content)
    .map(e => e.content)
    .join('\n\n')
}

function renderExportPanel() {
  if (!_state.taskCompleted || !_state.taskOutput) return ''
  const selectedThreadId = String(_state.selectedThreadId || '').trim()
  const taskThreadId = String(_state.taskOutputThreadId || '').trim()
  if (taskThreadId && selectedThreadId && taskThreadId !== selectedThreadId) return ''
  return `
    <div class="evosci-export-panel">
      <div class="evosci-export-title">${icon('file-text', 16)} ${escapeHtml(t('pages.evoscientist.export_title'))}</div>
      <div class="evosci-export-copy">${escapeHtml(t('pages.evoscientist.export_copy'))}</div>
      <div class="evosci-export-path-row">
        <span class="evosci-muted" style="font-size:12px">${icon('folder', 12)} ${escapeHtml(t('pages.evoscientist.export_save_to'))}</span>
        <span class="evosci-export-path-label" title="${escapeHtml(_state.exportSavePath)}">${escapeHtml(_state.exportSavePath || t('pages.evoscientist.export_default_location'))}</span>
        <button class="btn btn-secondary btn-xs" data-action="pick-export-path" ${!IS_TAURI ? 'disabled' : ''}>${escapeHtml(t('pages.evoscientist.export_pick_folder'))}</button>
      </div>
      <div class="evosci-export-actions">
        <button class="btn btn-primary btn-sm" data-action="export-local" data-format="docx" ${_state.exportBusy ? 'disabled' : ''} style="display:inline-flex;align-items:center;gap:4px">${icon('file-text', 14)} DOCX</button>
        <button class="btn btn-primary btn-sm" data-action="export-local" data-format="pptx" ${_state.exportBusy ? 'disabled' : ''} style="display:inline-flex;align-items:center;gap:4px">${icon('bar-chart', 14)} PPTX</button>
        <button class="btn btn-primary btn-sm" data-action="export-local" data-format="html" ${_state.exportBusy ? 'disabled' : ''} style="display:inline-flex;align-items:center;gap:4px">${icon('globe', 14)} HTML</button>
        ${_state.exportBusy ? `<span class="evosci-muted" style="font-size:12px">${escapeHtml(t('pages.evoscientist.export_sending'))}</span>` : ''}
      </div>
    </div>
  `
}

async function pickExportSavePath() {
  await _dialogReady
  if (!_openFolderDialog) {
    toast(t('pages.evoscientist.toast_folder_picker_unavailable'), 'warning')
    return
  }
  try {
    const selected = await _openFolderDialog({
      directory: true,
      title: t('pages.evoscientist.toast_folder_select_title'),
      defaultPath: _state.exportSavePath || undefined,
    })
    if (!selected) return
    const pathStr = typeof selected === 'string' ? selected : selected?.path
    if (pathStr) {
      _state.exportSavePath = pathStr
      renderAll()
    }
  } catch (e) {
    toast(t('pages.evoscientist.toast_folder_select_failed', { error: String(e?.message || e) }), 'error')
  }
}

async function exportLocalDocument(format) {
  const markdown = _state.taskOutput || ''
  if (!markdown.trim()) { toast(t('pages.evoscientist.toast_no_export_content'), 'warning'); return }
  _state.exportBusy = true
  renderAll()
  try {
    await exportAndNotify(toast, markdown, format, {
      title: 'Prospect Research 报告',
      author: 'Privix',
      headerText: 'Prospect Research',
      savePath: _state.exportSavePath || null,
    })
  } finally {
    _state.exportBusy = false
    renderAll()
  }
}

function buildPersonaOverlayPreview(persona = _state.personaDraft) {
  return buildEvoscientistPersonaOverlay(normalizeEvoscientistPersona(persona), {
    observedScientists: collectObservedScientists(),
  })
}

function buildOutboundMessage(message) {
  const overlay = buildPersonaOverlayPreview()
  if (!overlay) {
    return {
      overlay: '',
      message: message,
    }
  }
  return {
    overlay,
    message: `${overlay}\n\n${t('pages.evoscientist.prompt_user_task')}\n${message}`,
  }
}

function triggerDownload(filename, content, mime = 'application/json;charset=utf-8') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function exportPersonaPack() {
  ensurePersonaState()
  const observedScientists = collectObservedScientists()
  const content = JSON.stringify(buildEvoscientistPersonaPackage(_state.personaDraft, {
    assistantSnapshot: refreshAssistantPersonaSnapshot(),
    observedScientists,
    threadId: _state.selectedThreadId || _state.status?.currentThreadId || '',
    workspaceDir: _state.selectedWorkspaceDir || _state.status?.currentWorkspaceDir || '',
  }), null, 2)
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  triggerDownload(`evoscientist-persona-${stamp}.json`, content)
  toast(t('pages.evoscientist.toast_persona_exported'), 'success')
}

async function copyPersonaOverlay() {
  const content = buildPersonaOverlayPreview()
  if (!content) {
    toast(t('pages.evoscientist.toast_overlay_not_enabled'), 'warning')
    return
  }
  try {
    await navigator.clipboard.writeText(content)
    toast(t('pages.evoscientist.toast_overlay_copied'), 'success')
  } catch (error) {
    toast(t('pages.evoscientist.toast_copy_failed', { error: String(error) }), 'error')
  }
}

function syncPersonaFromAssistant() {
  const snapshot = refreshAssistantPersonaSnapshot()
  _state.personaDraft = createPersonaFromAssistantSnapshot(snapshot)
  savePersonaDraft()
  renderAll()
  toast(t('pages.evoscientist.toast_persona_synced_assistant'), 'success')
}

async function loadAgentFleetOptions() {
  _state.agentFleetStatus = 'loading'
  renderSettingsSection()
  try {
    _state.agentFleetOptions = await readAgentFleetOptions(api.listAgents)
  } catch {
    _state.agentFleetOptions = []
  }
  _state.agentFleetStatus = 'loaded'
  renderSettingsSection()
}

async function selectAgentForPreview(agentId) {
  _state.selectedAgentId = agentId
  _state.agentPersonaPreview = null
  const agent = agentId ? _state.agentFleetOptions.find(a => a.id === agentId) : null
  if (agentId && !agent?.workspace) {
    renderSettingsSection()
    toast(t('pages.evoscientist.toast_agent_no_workspace'), 'warn')
    return
  }
  if (!agent) { renderSettingsSection(); return }
  try {
    const snapshot = await readAgentPersonaSnapshot(agentId, agent.workspace, api.assistantReadFile)
    _state.agentPersonaPreview = { ...snapshot, name: agent.name, emoji: agent.emoji }
  } catch {
    _state.agentPersonaPreview = null
  }
  renderSettingsSection()
}

function syncPersonaFromAgentFleet() {
  if (!_state.agentPersonaPreview) {
    toast(t('pages.evoscientist.toast_select_agent_first'), 'warn')
    return
  }
  _state.personaDraft = createPersonaFromAgentSnapshot(_state.agentPersonaPreview)
  savePersonaDraft()
  renderAll()
  toast(t('pages.evoscientist.toast_persona_synced_agent', { name: _state.agentPersonaPreview.name }), 'success')
}

function resetPersonaDraft() {
  _state.personaDraft = createDefaultEvoscientistPersona()
  savePersonaDraft()
  renderAll()
  toast(t('pages.evoscientist.toast_persona_reset'), 'success')
}

function importPersonaPack(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const payload = JSON.parse(String(reader.result || '{}'))
        const candidate = payload?.persona && typeof payload.persona === 'object'
          ? { ...payload.persona, source: payload.persona.source || 'imported' }
          : { ...payload, source: payload?.source || 'imported' }
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
          throw new Error(t('pages.evoscientist.toast_persona_format_error'))
        }
        _state.personaDraft = normalizeEvoscientistPersona(candidate)
        savePersonaDraft()
        renderAll()
        toast(t('pages.evoscientist.toast_persona_imported'), 'success')
        resolve(_state.personaDraft)
      } catch (error) {
        reject(error)
      }
    }
    reader.onerror = () => reject(new Error(t('pages.evoscientist.toast_persona_read_failed')))
    reader.readAsText(file)
  })
}

function showArchitectureModal() {
  const observedScientists = collectObservedScientists()
  const stats = collectArchitectureStats()
  const content = `
    <div class="evosci-modal-shell">
      <div class="evosci-surface-title" style="font-size:18px;margin-bottom:8px">${escapeHtml(t('pages.evoscientist.collab_mode'))}</div>
      <div class="evosci-surface-copy">${escapeHtml(t('pages.evoscientist.collab_mode_copy'))}</div>
      <div class="evosci-config-meta" style="margin-bottom:16px">
        <div class="evosci-config-meta-item"><strong>${escapeHtml(t('pages.evoscientist.sub_agents'))}</strong><span>${escapeHtml(t('pages.evoscientist.collab_observed', { count: observedScientists.length }))}</span></div>
        <div class="evosci-config-meta-item"><strong>${escapeHtml(t('pages.evoscientist.tool_calls'))}</strong><span>${escapeHtml(t('pages.evoscientist.collab_tool_calls', { count: stats.toolCalls }))}</span></div>
        <div class="evosci-config-meta-item"><strong>${escapeHtml(t('pages.evoscientist.human_confirm'))}</strong><span>${escapeHtml(t('pages.evoscientist.collab_human_confirms', { count: stats.interrupts + stats.askUser }))}</span></div>
      </div>
      <div style="font-size:13px;line-height:1.8;color:var(--text-secondary)">
        <p><strong>${escapeHtml(t('pages.evoscientist.collab_step1'))}</strong> — ${escapeHtml(t('pages.evoscientist.collab_step1_copy'))}</p>
        <p><strong>${escapeHtml(t('pages.evoscientist.collab_step2'))}</strong> — ${escapeHtml(t('pages.evoscientist.collab_step2_copy'))}</p>
        <p><strong>${escapeHtml(t('pages.evoscientist.collab_step3'))}</strong> — ${escapeHtml(t('pages.evoscientist.collab_step3_copy'))}</p>
        <p><strong>${escapeHtml(t('pages.evoscientist.collab_step4'))}</strong> — ${escapeHtml(t('pages.evoscientist.collab_step4_copy'))}</p>
        <p><strong>${escapeHtml(t('pages.evoscientist.collab_step5'))}</strong> — ${escapeHtml(t('pages.evoscientist.collab_step5_copy'))}</p>
      </div>
      ${observedScientists.length ? `
        <div class="evosci-surface-title" style="margin-top:16px">${escapeHtml(t('pages.evoscientist.recently_active_sub_agents'))}</div>
        <div class="evosci-observed-list">
          ${observedScientists.slice(0, 5).map(item => {
            const archetype = inferScientistArchetype(item)
            return `<div class="evosci-observed-card">
              <div class="evosci-observed-head" style="gap:10px">
                ${renderAgentAvatar(archetype, 24)}
                <div style="min-width:0;flex:1">
                  <div class="evosci-observed-title">${escapeHtml(item.name)}</div>
                  <div style="font-size:11px;color:var(--text-tertiary)">${escapeHtml(archetype.codeName)}</div>
                </div>
                <span class="evosci-pill ${archetype.pillTone}">${escapeHtml(archetype.label)}</span>
              </div>
              <div class="evosci-observed-copy">${escapeHtml(item.preview || t('pages.evoscientist.collab_no_summary'))}</div>
            </div>`
          }).join('')}
        </div>
      ` : ''}
    </div>
  `
  showContentModal({ title: t('pages.evoscientist.collab_modal_title'), body: content, size: 'lg' })
}

function addTimelineEntry(entry) {
  _state.timeline.push({
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    ...entry,
  })
}

function ensureStreamEntry(kind) {
  const key = kind === 'assistant' ? 'activeAssistantEntryId' : 'activeThinkingEntryId'
  const activeId = _state[key]
  const existing = activeId
    ? _state.timeline.find(item => item.id === activeId)
    : null
  if (existing) return existing
  const entry = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    content: '',
    streaming: true,
    timestamp: new Date().toISOString(),
  }
  _state.timeline.push(entry)
  _state[key] = entry.id
  return entry
}

function finishStreamEntries() {
  for (const key of ['activeAssistantEntryId', 'activeThinkingEntryId']) {
    const id = _state[key]
    if (!id) continue
    const entry = _state.timeline.find(item => item.id === id)
    if (entry) entry.streaming = false
    _state[key] = null
  }
}

function setSelectedWorkspaceFromStatus(status = _state.status) {
  if (_state.selectedWorkspaceDir) return
  _state.selectedWorkspaceDir =
    status?.currentWorkspaceDir
    || status?.config?.default_workdir
    || status?.defaultWorkspaceDir
    || ''
}

function syncRuntimeSnapshot() {
  if (!_runtimeSessionId) return
  const readiness = currentReadiness()
  updateSessionSnapshot(_runtimeSessionId, {
    surface: 'evoscientist',
    streaming: _state.sending,
    status: _state.installing
      ? 'installing'
      : _state.sending
        ? 'streaming'
        : readiness?.state || 'idle',
    threadId: _state.selectedThreadId || _state.status?.currentThreadId || '',
  })
}

function interruptRejectSupported(interrupt) {
  const reviewConfigs = Array.isArray(interrupt?.review_configs) ? interrupt.review_configs : []
  if (!reviewConfigs.length) return true
  return reviewConfigs.every(config => {
    const allowed = Array.isArray(config?.allowed_decisions) ? config.allowed_decisions : null
    return !allowed || allowed.includes('reject')
  })
}



function getConfigModal() {
  return document.querySelector('.modal-overlay[data-evosci-config="1"]')
}

function closeConfigModal() {
  const modal = getConfigModal()
  if (modal?.close) modal.close()
}

function getRunbarPrimaryActions(readiness) {
  const state = readiness?.state || 'unsupported'
  const actions = []
  if (state === 'not_installed') {
    actions.push({
      action: 'install-evoscientist',
      label: _state.installing ? t('pages.evoscientist.installing_text') : t('pages.evoscientist.install_pr'),
      tone: 'primary',
      disabled: _state.installing,
    })
  }
  if (state === 'needs_config') {
    actions.push({
      action: 'open-config',
      label: t('pages.evoscientist.open_config'),
      tone: 'primary',
      disabled: false,
    })
  }
  if (state === 'stopped' || state === 'error') {
    actions.push({
      action: 'start-bridge',
      label: _state.startingBridge ? t('pages.evoscientist.starting_bridge') : t('pages.evoscientist.start_bridge'),
      tone: 'primary',
      disabled: _state.startingBridge || !_state.status?.installed,
    })
  }
  if (state === 'starting' || state === 'ready') {
    actions.push({
      action: 'stop-bridge',
      label: _state.stoppingBridge ? t('pages.evoscientist.stopping_bridge') : t('pages.evoscientist.stop_bridge'),
      tone: 'secondary',
      disabled: _state.stoppingBridge,
    })
  }
  if (state === 'ready') {
    actions.push({
      tab: 'chat',
      label: t('pages.evoscientist.enter_chat'),
      tone: 'secondary',
      disabled: false,
    })
  }
  return actions
}

function renderExplanationCard() {
  return `
    <details class="evosci-explanation-card">
      <summary class="evosci-explanation-summary"><span class="evosci-chevron">${icon('chevron-right', 10)}</span> ${icon('info', 14)} ${escapeHtml(t('pages.evoscientist.explanation_title'))}</summary>
      <div class="evosci-explanation-body">
        <div class="evosci-explanation-section">
          <div class="evosci-explanation-heading">${icon('target', 12)} ${escapeHtml(t('pages.evoscientist.explanation_reflect_heading'))}</div>
          <div class="evosci-explanation-text">${escapeHtml(t('pages.evoscientist.explanation_reflect_text'))}</div>
        </div>
        <div class="evosci-explanation-section">
          <div class="evosci-explanation-heading">${icon('trending-up', 12)} ${escapeHtml(t('pages.evoscientist.explanation_evolve_heading'))}</div>
          <div class="evosci-explanation-text">${escapeHtml(t('pages.evoscientist.explanation_evolve_text'))}</div>
        </div>
        <div class="evosci-explanation-section">
          <div class="evosci-explanation-heading">${icon('layers', 12)} ${escapeHtml(t('pages.evoscientist.explanation_diff_heading'))}</div>
          <div class="evosci-explanation-text">${t('pages.evoscientist.explanation_diff_text')}</div>
        </div>
      </div>
    </details>
  `
}

function renderStatusSection() {
  if (!_statusEl) return
  ensurePersonaState()
  if (!_state.status && _state.loadingStatus) {
    _statusEl.innerHTML = '<div class="stat-card loading-placeholder" style="height:140px"></div>'
    return
  }

  const status = _state.status || {}
  const readiness = currentReadiness() || applyEvoscientistStatus(status)
  const badgeTone = readiness?.badgeTone ? ` ${readiness.badgeTone}` : ''
  const actions = getRunbarPrimaryActions(readiness)
  const defaultWorkspace = status.defaultWorkspaceDir || status.config?.default_workdir || '--'
  const currentWorkspace = _state.selectedWorkspaceDir || status.currentWorkspaceDir || defaultWorkspace
  const threadId = _state.selectedThreadId || status.currentThreadId || ''
  const missingLabels = Array.isArray(readiness?.missingLabels) ? readiness.missingLabels : []

  const stateClass = readiness?.state ? ` state-${readiness.state}` : ''
  _statusEl.innerHTML = `
    <div class="evosci-status-strip${stateClass}">
      <div class="evosci-status-strip-left">
        <span class="evosci-inline-status${badgeTone}">${escapeHtml(readiness?.badgeLabel || t('pages.evoscientist.status_not_detected'))}</span>
        <span class="evosci-status-strip-info">${escapeHtml(readiness?.message || t('pages.evoscientist.status_detecting'))}</span>
        ${missingLabels.length ? `<span class="evosci-status-strip-info warn">${escapeHtml(t('pages.evoscientist.status_missing_fields', { fields: missingLabels.join('、') }))}</span>` : ''}
      </div>
      <div class="evosci-status-strip-right">
        ${renderActionButtons(actions, 'btn-xs')}
        <button class="evosci-icon-btn" data-action="refresh-status" title="${escapeHtml(t('pages.evoscientist.status_refresh_title'))}" ${_state.loadingStatus ? 'disabled' : ''}>${icon('refresh-cw', 14)}</button>
        <button class="evosci-icon-btn ${readiness?.state === 'needs_config' ? 'attention' : ''}" data-action="open-config" title="${escapeHtml(t('pages.evoscientist.status_config_title'))}">${icon('gear', 14)}</button>
      </div>
    </div>
    ${renderExplanationCard()}
  `
}


function renderSettingsSection() {
  if (!_settingsEl) return
  ensurePersonaState()
  const status = _state.status || {}
  const runtimePaths = getEvoscientistRuntimePaths(status)
  const config = normalizeConfig(status.config || _state.configDraft || {})
  const issues = getEvoscientistConfigIssues(config)
  const activeProvider = PROVIDERS.find(item => item.value === config.provider) || PROVIDERS[0]
  const fields = providerFields(config.provider)
  const persona = normalizeEvoscientistPersona(_state.personaDraft)
  const overlayPreview = buildPersonaOverlayPreview(persona)

  const observedScientists = collectObservedScientists()

  _settingsEl.innerHTML = `
    <div class="evosci-settings-grid">
      <!-- 卡片 1: 快速配置 -->
      <div class="evosci-surface evosci-surface-hero">
        <div class="evosci-surface-title" style="display:flex;align-items:center;gap:8px"><span style="display:inline-flex;color:var(--accent-blue)">${icon('zap', 18)}</span> ${escapeHtml(t('pages.evoscientist.quick_config'))}</div>
        <div class="evosci-surface-copy">${escapeHtml(t('pages.evoscientist.quick_config_copy'))}</div>
        <div class="evosci-config-meta">
          <div class="evosci-config-meta-item">
            <strong>${escapeHtml(FIELD_LABELS.provider)}</strong>
            <span>${escapeHtml(activeProvider.label || config.provider || '--')}</span>
          </div>
          <div class="evosci-config-meta-item">
            <strong>${escapeHtml(FIELD_LABELS.model)}</strong>
            <span>${escapeHtml(config.model || '--')}</span>
          </div>
          <div class="evosci-config-meta-item" style="grid-column:1 / -1">
            <strong>${escapeHtml(FIELD_LABELS.default_workdir)}</strong>
            <span>${escapeHtml(config.default_workdir || status.defaultWorkspaceDir || '--')}</span>
          </div>
          <div class="evosci-config-meta-item" style="grid-column:1 / -1">
            <strong>${escapeHtml(t('pages.evoscientist.interaction_strategy'))}</strong>
            <span>${config.auto_approve ? escapeHtml(t('pages.evoscientist.auto_approve_on')) : escapeHtml(t('pages.evoscientist.auto_approve_off'))} · ${config.enable_ask_user ? escapeHtml(t('pages.evoscientist.allow_ask_user')) : escapeHtml(t('pages.evoscientist.disallow_ask_user'))}</span>
          </div>
        </div>
        <div class="evosci-pill-row" style="margin-top:12px">
          ${fields.length
            ? fields.map(field => `<span class="evosci-pill ${issues.missingFields.includes(field) ? 'warn' : 'ok'}">${escapeHtml(FIELD_LABELS[field] || field)}</span>`).join('')
            : ''
          }
          <span class="evosci-pill ${issues.missingFields.includes('model') ? 'warn' : 'ok'}">${escapeHtml(FIELD_LABELS.model)}</span>
        </div>
        ${issues.missingLabels.length
          ? `<div class="evosci-muted" style="margin-top:8px">${escapeHtml(t('pages.evoscientist.still_missing', { fields: issues.missingLabels.join('、') }))}</div>`
          : ''
        }
        <div class="evosci-actions" style="margin-top:14px">
          <button class="btn btn-primary btn-sm" data-action="open-config">${escapeHtml(t('pages.evoscientist.open_config'))}</button>
          <button class="btn btn-secondary btn-sm" data-action="refresh-status">${escapeHtml(t('pages.evoscientist.status_refresh_title'))}</button>
        </div>
      </div>

      <!-- 卡片 2: Coordinator 人格（概览 + 可展开详细编辑） -->
      <div class="evosci-surface">
        <div class="evosci-surface-title" style="display:flex;align-items:center;gap:8px"><span style="display:inline-flex;color:var(--accent-blue)">${icon('users', 18)}</span> ${escapeHtml(t('pages.evoscientist.coordinator_persona'))}</div>
        <div class="evosci-pill-row" style="margin-bottom:10px">
          <span class="evosci-pill ${persona.overlayEnabled ? 'ok' : 'warn'}">${persona.overlayEnabled ? escapeHtml(t('pages.evoscientist.persona_overlay_on')) : escapeHtml(t('pages.evoscientist.persona_overlay_off'))}</span>
          <span class="evosci-pill">${escapeHtml(persona.roleLabel)}</span>
          <span class="evosci-pill">${escapeHtml(personaSourceLabel(persona.source))}</span>
        </div>
        ${renderPersonaMeters(persona)}
        ${renderAdvancedDetails({
          title: t('pages.evoscientist.edit_persona_params'),
          copy: t('pages.evoscientist.edit_persona_copy'),
          content: `
            <div class="evosci-form-grid">
              <div class="form-group">
                <label class="form-label">${escapeHtml(t('pages.evoscientist.persona_name'))}</label>
                <input class="form-input" data-persona-field="name" value="${escapeHtml(persona.name)}" placeholder="${escapeHtml(t('pages.evoscientist.persona_name_placeholder'))}">
              </div>
              <div class="form-group">
                <label class="form-label">${escapeHtml(t('pages.evoscientist.persona_role'))}</label>
                <input class="form-input" data-persona-field="roleLabel" value="${escapeHtml(persona.roleLabel)}" placeholder="${escapeHtml(t('pages.evoscientist.persona_role_placeholder'))}">
              </div>
              ${getPersonaLevelFields().map(field => `
                <div class="form-group">
                  <label class="form-label">${escapeHtml(field.label)}</label>
                  <select class="form-input" data-persona-level="${field.key}">
                    ${field.options.map((label, index) => `
                      <option value="${index + 1}" ${persona.levels[field.key] === index + 1 ? 'selected' : ''}>
                        ${escapeHtml(`${index + 1} · ${label}`)}
                      </option>
                    `).join('')}
                  </select>
                  <div class="form-hint">${escapeHtml(field.copy)}</div>
                </div>
              `).join('')}
              <div class="form-group" style="display:flex;align-items:flex-end">
                <label class="evosci-check" style="margin-bottom:8px">
                  <input type="checkbox" data-persona-checkbox="overlayEnabled" ${persona.overlayEnabled ? 'checked' : ''}>
                  <span>${escapeHtml(t('pages.evoscientist.attach_persona_overlay'))}</span>
                </label>
              </div>
              <div class="form-group" style="grid-column:1 / -1">
                <label class="form-label">${escapeHtml(t('pages.evoscientist.persona_summary'))}</label>
                <textarea class="form-input" rows="2" data-persona-field="summary" style="resize:vertical">${escapeHtml(persona.summary)}</textarea>
              </div>
              <div class="form-group" style="grid-column:1 / -1">
                <label class="form-label">${escapeHtml(t('pages.evoscientist.execution_preference'))}</label>
                <textarea class="form-input" rows="2" data-persona-field="directive" style="resize:vertical">${escapeHtml(persona.directive)}</textarea>
              </div>
              <div class="form-group" style="grid-column:1 / -1">
                <label class="form-label">${escapeHtml(t('pages.evoscientist.behavior_boundary'))}</label>
                <textarea class="form-input" rows="2" data-persona-field="boundaries" style="resize:vertical">${escapeHtml(persona.boundaries)}</textarea>
              </div>
            </div>
          `,
        })}
        <div class="evosci-actions" style="margin-top:14px">
          <button class="btn btn-primary btn-sm" data-action="export-persona">${escapeHtml(t('pages.evoscientist.export_persona_pack'))}</button>
          <button class="btn btn-secondary btn-sm" data-action="import-persona">${escapeHtml(t('pages.evoscientist.import_persona_pack'))}</button>
          <button class="btn btn-secondary btn-sm" data-action="copy-persona-overlay">${escapeHtml(t('pages.evoscientist.copy_overlay'))}</button>
          <button class="btn btn-secondary btn-sm" data-action="reset-persona">${escapeHtml(t('pages.evoscientist.reset_default'))}</button>
        </div>
      </div>

      <!-- 卡片 3: Agent 舰队导入 -->
      <div class="evosci-surface">
        <div class="evosci-surface-title" style="display:flex;align-items:center;gap:8px"><span style="display:inline-flex;color:var(--accent-blue)">${icon('rocket', 18)}</span> ${escapeHtml(t('pages.evoscientist.agent_fleet_import'))}</div>
        <div class="evosci-surface-copy">${escapeHtml(t('pages.evoscientist.agent_fleet_import_copy'))}</div>
        <div class="evosci-config-meta">
          <div class="evosci-config-meta-item" style="grid-column:1 / -1">
            <strong>${escapeHtml(t('pages.evoscientist.select_agent'))}</strong>
            <span>
              <select class="form-input" data-action-select="pick-agent-fleet" style="width:100%">
                <option value="">${escapeHtml(t('pages.evoscientist.select_agent_placeholder'))}</option>
                ${_state.agentFleetOptions.map(a => `<option value="${escapeHtml(a.id)}" ${_state.selectedAgentId === a.id ? 'selected' : ''}>${escapeHtml(a.emoji)} ${escapeHtml(a.name)}</option>`).join('')}
              </select>
              ${_state.agentFleetStatus === 'loading' ? `<span class="evosci-muted" style="margin-left:8px">${escapeHtml(t('pages.evoscientist.loading_text'))}</span>` : ''}
            </span>
          </div>
          ${_state.agentPersonaPreview ? `
            <div class="evosci-config-meta-item">
              <strong>${escapeHtml(t('pages.evoscientist.agent_name'))}</strong>
              <span>${escapeHtml(_state.agentPersonaPreview.emoji)} ${escapeHtml(_state.agentPersonaPreview.name)}</span>
            </div>
            <div class="evosci-config-meta-item">
              <strong>${escapeHtml(t('pages.evoscientist.soul_summary'))}</strong>
              <span>${escapeHtml(summarizeText(_state.agentPersonaPreview.soulContent || t('pages.evoscientist.soul_not_found'), 120))}</span>
            </div>
            <div class="evosci-config-meta-item" style="grid-column:1 / -1">
              <strong>${escapeHtml(t('pages.evoscientist.identity_summary'))}</strong>
              <span>${escapeHtml(summarizeText(_state.agentPersonaPreview.identityContent || t('pages.evoscientist.identity_not_found'), 160))}</span>
            </div>
          ` : `
            <div class="evosci-muted" style="grid-column:1 / -1;padding:8px 0">${escapeHtml(t('pages.evoscientist.agent_preview_hint'))}</div>
          `}
        </div>
        <div class="evosci-actions" style="margin-top:14px">
          <button class="btn btn-primary btn-sm" data-action="sync-persona-from-agent-fleet" ${!_state.agentPersonaPreview ? 'disabled' : ''}>${escapeHtml(t('pages.evoscientist.sync_to_coordinator'))}</button>
          <button class="btn btn-secondary btn-sm" data-action="refresh-agent-fleet">${escapeHtml(t('pages.evoscientist.refresh_list'))}</button>
        </div>
      </div>

      <!-- 卡片 4: 子智能体观测 -->
      <div class="evosci-surface">
        <div class="evosci-surface-title" style="display:flex;align-items:center;gap:8px"><span style="display:inline-flex;color:var(--accent-blue)">${icon('git-branch', 18)}</span> ${escapeHtml(t('pages.evoscientist.sub_agent_observe'))}</div>
        <div class="evosci-surface-copy">${escapeHtml(t('pages.evoscientist.sub_agent_observe_copy'))}</div>
        ${observedScientists.length
          ? `<div class="evosci-observed-list" style="margin-top:8px">
              ${observedScientists.map(s => `
                <div class="evosci-observed-card" style="padding:10px 12px">
                  <div class="evosci-observed-head" style="margin-bottom:4px">
                    <span class="evosci-observed-title" style="font-size:13px">${escapeHtml(s.name)}</span>
                    <span class="evosci-muted">${escapeHtml(t('pages.evoscientist.tool_calls_count', { count: s.count }))} · ${Array.isArray(s.roles) ? s.roles.join(', ') : ''}</span>
                  </div>
                  ${s.preview ? `<div class="evosci-muted" style="line-height:1.5">${escapeHtml(summarizeText(s.preview, 100))}</div>` : ''}
                </div>
              `).join('')}
            </div>`
          : `<div class="evosci-muted" style="margin-top:8px;padding:12px 0">${escapeHtml(t('pages.evoscientist.no_scientist_activity'))}</div>`
        }
      </div>

      <!-- 卡片 5: 导出与数据 -->
      <div class="evosci-surface" style="grid-column:1 / -1">
        <div class="evosci-surface-title" style="display:flex;align-items:center;gap:8px"><span style="display:inline-flex;color:var(--accent-blue)">${icon('download', 18)}</span> ${escapeHtml(t('pages.evoscientist.export_and_data'))}</div>
        <div class="evosci-surface-copy">${escapeHtml(t('pages.evoscientist.export_and_data_copy'))}</div>
        ${renderAdvancedDetails({
          title: t('pages.evoscientist.persona_overlay_preview'),
          copy: t('pages.evoscientist.persona_overlay_preview_copy'),
          content: `<div class="evosci-persona-preview">${escapeHtml(overlayPreview || t('pages.evoscientist.persona_overlay_not_enabled'))}</div>`,
        })}
        ${renderAdvancedDetails({
          title: t('pages.evoscientist.dirs_and_persistence'),
          copy: t('pages.evoscientist.dirs_and_persistence_copy'),
          content: `
            <div class="evosci-config-meta">
              <div class="evosci-config-meta-item">
                <strong>${escapeHtml(t('pages.evoscientist.config_file'))}</strong>
                <span>${escapeHtml(status.configPath || status.configRoot || '--')}</span>
              </div>
              <div class="evosci-config-meta-item">
                <strong>Threads DB</strong>
                <span>${escapeHtml(status.sessionsDbPath || '--')}</span>
              </div>
              <div class="evosci-config-meta-item">
                <strong>${escapeHtml(t('pages.evoscientist.runs_dir'))}</strong>
                <span>${escapeHtml(runtimePaths.runsDir || '--')}</span>
              </div>
              <div class="evosci-config-meta-item">
                <strong>${escapeHtml(t('pages.evoscientist.skills_dir'))}</strong>
                <span>${escapeHtml(runtimePaths.skillsDir || '--')}</span>
              </div>
            </div>
          `,
        })}
      </div>
    </div>
  `
}


function renderSessionsSection() {
  if (!_sessionsEl) return
  const status = _state.status || {}
  const blockedByInteraction = hasBlockingInteraction()
  if (!status.installed) {
    _sessionsEl.innerHTML = `
      <div class="evosci-surface">
        <div class="evosci-surface-title">${escapeHtml(t('pages.evoscientist.history_threads'))}</div>
        <div class="evosci-surface-copy">${escapeHtml(t('pages.evoscientist.history_threads_not_installed'))}</div>
        <div class="evosci-actions">
          <button class="btn btn-primary btn-sm" data-action="install-evoscientist" ${_state.installing ? 'disabled' : ''}>${_state.installing ? escapeHtml(t('pages.evoscientist.installing_text')) : escapeHtml(t('pages.evoscientist.install_pr'))}</button>
        </div>
      </div>
    `
    return
  }

  const sessions = _state.sessions || []
  _sessionsEl.innerHTML = `
    <div class="evosci-surface">
      <div class="evosci-surface-title">${escapeHtml(t('pages.evoscientist.history_threads'))}</div>
      <div class="evosci-surface-copy">${escapeHtml(t('pages.evoscientist.history_threads_copy'))}</div>
      <div class="evosci-actions" style="margin-bottom:12px">
        <button class="btn btn-secondary btn-sm" data-action="refresh-sessions" ${_state.loadingSessions ? 'disabled' : ''}>${_state.loadingSessions ? escapeHtml(t('pages.evoscientist.refreshing')) : escapeHtml(t('pages.evoscientist.refresh_threads'))}</button>
        <button class="btn btn-secondary btn-sm" data-action="new-thread" ${blockedByInteraction ? 'disabled' : ''}>${escapeHtml(t('pages.evoscientist.new_thread'))}</button>
      </div>
      <div class="evosci-session-list">
        ${sessions.length
          ? sessions.map(item => {
            const threadId = item.thread_id || item.threadId || ''
            const preview = item.preview || item.summary || t('pages.evoscientist.no_preview')
            const updatedAt = item.updated_at || item.updatedAt || item.created_at || item.createdAt || ''
            const count = item.message_count ?? item.messageCount ?? 0
            return `
              <button class="evosci-session-card ${threadId && threadId === _state.selectedThreadId ? 'active' : ''}" data-action="select-session" data-thread-id="${escapeHtml(threadId)}" ${blockedByInteraction ? 'disabled' : ''}>
                <div class="evosci-session-title">
                  <strong title="${escapeHtml(threadId)}">${escapeHtml(summarizeText(preview, 36) || shortId(threadId, 18))}</strong>
                  ${count ? `<span class="evosci-session-badge">${escapeHtml(String(count))}</span>` : ''}
                </div>
                <div class="evosci-muted" style="margin-top:6px">${escapeHtml(formatRelativeTime(updatedAt))}</div>
              </button>
            `
          }).join('')
          : `<div class="evosci-muted">${escapeHtml(t('pages.evoscientist.no_resumable_thread'))}</div>`
        }
      </div>
    </div>
  `
}

/** 可折叠的次要条目类型 */
const COLLAPSIBLE_KINDS = new Set(['thinking', 'tool_call', 'tool_result', 'system', 'usage'])
const TIMELINE_COLLAPSE_THRESHOLD = 20
const TIMELINE_VISIBLE_TAIL = 10

/** 将连续的 tool_call/tool_result 折叠为可展开的分组，避免刷屏 */
function renderTimelineEntries(entries) {
  const parts = []

  // 当条目超过阈值且用户未展开时，折叠旧的次要条目
  let visibleEntries = entries
  let collapsedCount = 0
  if (!_state.timelineExpanded && entries.length > TIMELINE_COLLAPSE_THRESHOLD) {
    const cutoff = entries.length - TIMELINE_VISIBLE_TAIL
    const headEntries = entries.slice(0, cutoff)
    const tailEntries = entries.slice(cutoff)
    // 只折叠次要条目；保留 user / assistant / error / interrupt / ask-user
    const keptHead = headEntries.filter(e => !COLLAPSIBLE_KINDS.has(e.kind))
    collapsedCount = headEntries.length - keptHead.length
    visibleEntries = collapsedCount > 0 ? [...keptHead, ...tailEntries] : entries
  }

  let i = 0
  // 如果有折叠，在最前面插入折叠提示
  if (collapsedCount > 0) {
    parts.push(`<div class="evosci-timeline-collapsed" data-action="expand-timeline">${escapeHtml(t('pages.evoscientist.collapsed_records', { count: collapsedCount }))}</div>`)
  }
  while (i < visibleEntries.length) {
    const entry = visibleEntries[i]
    if (entry.kind === 'tool_call' || entry.kind === 'tool_result') {
      // 收集连续 tool 条目
      const group = [entry]
      let j = i + 1
      while (j < visibleEntries.length && (visibleEntries[j].kind === 'tool_call' || visibleEntries[j].kind === 'tool_result')) {
        group.push(visibleEntries[j])
        j++
      }
      if (group.length >= 2) {
        parts.push(renderToolGroup(group))
      } else {
        parts.push(renderTimelineEntry(entry))
      }
      i = j
    } else {
      parts.push(renderTimelineEntry(entry))
      i++
    }
  }
  return parts.join('')
}

function renderToolGroup(entries) {
  const firstTime = escapeHtml(formatTime(entries[0].timestamp))
  const lastTime = escapeHtml(formatTime(entries[entries.length - 1].timestamp))
  const timeRange = firstTime === lastTime ? firstTime : `${firstTime} — ${lastTime}`
  // 统计工具调用数和结果数
  const callCount = entries.filter(e => e.kind === 'tool_call').length
  const resultCount = entries.filter(e => e.kind === 'tool_result').length
  const labelParts = []
  if (callCount) labelParts.push(t('pages.evoscientist.tool_group_calls', { count: callCount }))
  if (resultCount) labelParts.push(t('pages.evoscientist.tool_group_results', { count: resultCount }))
  const label = labelParts.join(' · ') || t('pages.evoscientist.tool_group_ops', { count: entries.length })
  // 提取工具名称预览
  const toolNames = [...new Set(entries.filter(e => e.kind === 'tool_call').map(e => e.name || e.tool_name || (e.payload && e.payload.name) || '').filter(Boolean))]
  const toolPreview = toolNames.length <= 2 ? toolNames.join(', ') : `${toolNames.slice(0, 2).join(', ')} +${toolNames.length - 2}`
  const inner = entries.map(renderTimelineEntry).join('')
  return `
    <div class="evosci-tool-group">
      <div class="evosci-tool-group-header" data-action="toggle-tool-group">
        <span class="evosci-tool-group-icon">${icon('wrench', 13)}</span>
        <span class="evosci-tool-group-label">${label}${toolPreview ? `<span class="evosci-tool-group-names">${escapeHtml(toolPreview)}</span>` : ''}</span>
        <span class="evosci-entry-time">${timeRange}</span>
        <span class="evosci-chevron">${icon('chevron-right', 12)}</span>
      </div>
      <div class="evosci-tool-group-body">${inner}</div>
    </div>
  `
}

function renderTimelineEntry(entry) {
  const time = escapeHtml(formatTime(entry.timestamp))
  if (entry.kind === 'user') {
    return `
      <div class="evosci-entry user" data-entry-id="${entry.id}">
        <div class="evosci-entry-head">
          <span class="evosci-entry-kind">${escapeHtml(t('pages.evoscientist.entry_you'))}</span>
          <span class="evosci-entry-time">${time}</span>
        </div>
        <div class="evosci-entry-body">${escapeHtml(entry.content)}</div>
      </div>
    `
  }

  if (entry.kind === 'assistant') {
    return `
      <div class="evosci-entry assistant" data-entry-id="${entry.id}">
        <div class="evosci-entry-head">
          <span class="evosci-entry-kind">Prospect-Research</span>
          <span class="evosci-entry-time">${time}</span>
        </div>
        <div class="evosci-entry-body ${entry.streaming ? 'evosci-streaming' : ''}">${renderMarkdown(entry.content || '')}</div>
      </div>
    `
  }

  if (entry.kind === 'thinking') {
    return `
      <div class="evosci-entry thinking" data-entry-id="${entry.id}">
        <div class="evosci-entry-head">
          <span class="evosci-entry-kind">${escapeHtml(t('pages.evoscientist.entry_thinking'))}</span>
          <span class="evosci-entry-time">${time}</span>
        </div>
        <div class="evosci-entry-body ${entry.streaming ? 'evosci-streaming' : ''}">${escapeHtml(entry.content || '')}</div>
      </div>
    `
  }

  if (entry.kind === 'tool_call' || entry.kind === 'tool_result') {
    const meta = summarizeEvoscientistTimelineEntry(entry)
    return `
      <div class="evosci-entry tool" data-entry-id="${entry.id}">
        <div class="evosci-entry-head">
          <span class="evosci-entry-kind">${escapeHtml(meta.title)}</span>
          <span class="evosci-entry-time">${time}</span>
        </div>
        <div class="evosci-entry-body">
          <div class="evosci-entry-summary">${escapeHtml(meta.summary)}</div>
          <details class="evosci-inline-details">
            <summary>${escapeHtml(t('pages.evoscientist.view_details'))}</summary>
            <pre>${escapeHtml(entry.kind === 'tool_call' ? stringifyPretty(entry.args || {}) : stringifyPretty(entry.content || ''))}</pre>
          </details>
        </div>
      </div>
    `
  }

  if (entry.kind.startsWith('subagent_')) {
    const subagentItem = { name: entry.payload?.subagent || entry.payload?.name || entry.label || '', preview: entry.content || '' }
    const archetype = inferScientistArchetype(subagentItem)
    const body = entry.kind === 'subagent_text'
      ? renderMarkdown(entry.content || '')
      : `<pre>${escapeHtml(stringifyPretty(entry.payload || entry.content || {}))}</pre>`
    return `
      <div class="evosci-entry subagent" data-entry-id="${entry.id}" style="--badge-color:${archetype.badgeColor}">
        <div class="evosci-entry-head">
          ${renderAgentAvatar(archetype, 20)}
          <span class="evosci-entry-kind">${escapeHtml(archetype.codeName)} &middot; ${escapeHtml(entry.label || entry.kind)}</span>
          <span class="evosci-entry-time">${time}</span>
        </div>
        <div class="evosci-entry-body">${body}</div>
      </div>
    `
  }

  if (entry.kind === 'usage') {
    const meta = summarizeEvoscientistTimelineEntry(entry)
    return `
      <div class="evosci-entry usage" data-entry-id="${entry.id}">
        <div class="evosci-entry-head">
          <span class="evosci-entry-kind">${escapeHtml(meta.title)}</span>
          <span class="evosci-entry-time">${time}</span>
        </div>
        <div class="evosci-entry-body">${escapeHtml(meta.summary)}</div>
      </div>
    `
  }

  if (entry.kind === 'interrupt') {
    const meta = summarizeEvoscientistTimelineEntry(entry)
    return `
      <div class="evosci-entry interrupt" data-entry-id="${entry.id}">
        <div class="evosci-entry-head">
          <span class="evosci-entry-kind">${escapeHtml(meta.title)}</span>
          <span class="evosci-entry-time">${time}</span>
        </div>
        <div class="evosci-entry-body">
          <div class="evosci-entry-summary">${escapeHtml(meta.summary)}</div>
          <details class="evosci-inline-details">
            <summary>${escapeHtml(t('pages.evoscientist.view_details'))}</summary>
            <pre>${escapeHtml(stringifyPretty(entry.payload || {}))}</pre>
          </details>
        </div>
      </div>
    `
  }

  if (entry.kind === 'ask_user') {
    const meta = summarizeEvoscientistTimelineEntry(entry)
    return `
      <div class="evosci-entry ask-user" data-entry-id="${entry.id}">
        <div class="evosci-entry-head">
          <span class="evosci-entry-kind">${escapeHtml(meta.title)}</span>
          <span class="evosci-entry-time">${time}</span>
        </div>
        <div class="evosci-entry-body">
          <div class="evosci-entry-summary">${escapeHtml(meta.summary)}</div>
          <details class="evosci-inline-details">
            <summary>${escapeHtml(t('pages.evoscientist.view_details'))}</summary>
            <pre>${escapeHtml(stringifyPretty(entry.payload || {}))}</pre>
          </details>
        </div>
      </div>
    `
  }

  if (entry.kind === 'system') {
    const meta = summarizeEvoscientistTimelineEntry(entry)
    return `
      <div class="evosci-note-row" data-entry-id="${entry.id}">
        ${icon('info', 14)}
        <span>${escapeHtml(meta.summary || entry.content || '')}</span>
        <span class="evosci-entry-time">${time}</span>
      </div>
    `
  }

  return `
    <div class="evosci-entry ${entry.kind === 'error' ? 'error' : 'system'}" data-entry-id="${entry.id}">
      <div class="evosci-entry-head">
        <span class="evosci-entry-kind">${escapeHtml(entry.kind === 'error' ? t('pages.evoscientist.entry_error') : t('pages.evoscientist.entry_system'))}</span>
        <span class="evosci-entry-time">${time}</span>
      </div>
      <div class="evosci-entry-body">${entry.kind === 'error' ? `<pre>${escapeHtml(entry.content || '')}</pre>` : escapeHtml(entry.content || '')}</div>
    </div>
  `
}

function renderAskUserPanel() {
  const interrupt = _state.pendingAskUser
  if (!interrupt) return ''
  const questions = interrupt.questions || []
  return `
    <div class="evosci-entry ask-user" style="margin:0 16px 16px">
      <div class="evosci-entry-head">
        <span class="evosci-entry-kind">${escapeHtml(t('pages.evoscientist.ask_user_waiting'))}</span>
        <span class="evosci-entry-time">${escapeHtml(formatTime(new Date().toISOString()))}</span>
      </div>
      <div class="evosci-entry-body">${escapeHtml(t('pages.evoscientist.ask_user_body'))}</div>
      <div class="evosci-ask-form">
        ${questions.map((question, index) => {
          const current = _state.askUserAnswers[String(index)] ?? ''
          if (question.type === 'multiple_choice') {
            const choices = Array.isArray(question.choices) ? question.choices : []
            return `
              <div class="evosci-ask-question">
                <div style="font-weight:600;margin-bottom:8px">${escapeHtml(question.question || t('pages.evoscientist.ask_user_question_n', { n: index + 1 }))}</div>
                <select class="form-input" data-ask-user-index="${index}">
                  <option value="">${escapeHtml(t('pages.evoscientist.ask_user_select_placeholder'))}</option>
                  ${choices.map(choice => {
                    const value = typeof choice === 'object' ? (choice.value ?? choice.label ?? '') : String(choice)
                    const label = typeof choice === 'object' ? (choice.label ?? choice.value ?? '') : String(choice)
                    return `<option value="${escapeHtml(value)}" ${value === current ? 'selected' : ''}>${escapeHtml(label)}</option>`
                  }).join('')}
                </select>
              </div>
            `
          }
          return `
            <div class="evosci-ask-question">
              <div style="font-weight:600;margin-bottom:8px">${escapeHtml(question.question || t('pages.evoscientist.ask_user_question_n', { n: index + 1 }))}</div>
              <textarea class="form-input" rows="3" data-ask-user-index="${index}" placeholder="${question.required === false ? escapeHtml(t('pages.evoscientist.ask_user_optional')) : escapeHtml(t('pages.evoscientist.ask_user_input_placeholder'))}">${escapeHtml(current)}</textarea>
            </div>
          `
        }).join('')}
        <div class="evosci-actions">
          <button class="btn btn-primary btn-sm" data-action="submit-ask-user" ${_state.sending ? 'disabled' : ''}>${escapeHtml(t('pages.evoscientist.submit_answer'))}</button>
          <button class="btn btn-secondary btn-sm" data-action="cancel-ask-user" ${_state.sending ? 'disabled' : ''}>${escapeHtml(t('pages.evoscientist.cancel_question'))}</button>
        </div>
      </div>
    </div>
  `
}

function renderInterruptPanel() {
  const interrupt = _state.pendingInterrupt
  if (!interrupt) return ''
  const count = Array.isArray(interrupt.action_requests) ? interrupt.action_requests.length : 0
  const canReject = interruptRejectSupported(interrupt)
  return `
    <div class="evosci-entry interrupt" style="margin:0 16px 16px">
      <div class="evosci-entry-head">
        <span class="evosci-entry-kind">${escapeHtml(t('pages.evoscientist.interrupt_waiting'))}</span>
        <span class="evosci-entry-time">${escapeHtml(formatTime(new Date().toISOString()))}</span>
      </div>
      <div class="evosci-entry-body">${escapeHtml(t('pages.evoscientist.interrupt_body', { count: count || 1 }))}</div>
      <div class="evosci-actions" style="margin-top:12px">
        <button class="btn btn-primary btn-sm" data-action="approve-interrupt" ${_state.sending ? 'disabled' : ''}>${escapeHtml(t('pages.evoscientist.approve_all'))}</button>
        <button class="btn btn-secondary btn-sm" data-action="reject-interrupt" ${(_state.sending || !canReject) ? 'disabled' : ''}>${escapeHtml(t('pages.evoscientist.reject_all'))}</button>
      </div>
      ${canReject ? '' : `<div class="evosci-muted" style="margin-top:10px">${escapeHtml(t('pages.evoscientist.reject_disabled_hint'))}</div>`}
    </div>
  `
}

function getChatBlockingCard(readiness) {
  const state = readiness?.state
  const missingLabels = Array.isArray(readiness?.missingLabels) ? readiness.missingLabels : []
  if (state === 'ready') return ''

  let title = t('pages.evoscientist.blocking_not_ready')
  let copy = readiness?.message || t('pages.evoscientist.blocking_default_copy')
  let actions = ''

  let extra = ''

  if (_state.installing) {
    title = t('pages.evoscientist.blocking_installing')
    copy = t('pages.evoscientist.blocking_installing_copy')
    actions = `<button class="btn btn-secondary btn-sm" data-action="refresh-status" ${_state.loadingStatus ? 'disabled' : ''}>${_state.loadingStatus ? escapeHtml(t('pages.evoscientist.refreshing')) : escapeHtml(t('pages.evoscientist.status_refresh_title'))}</button>`
    extra = `
      <div style="margin-top:14px">
        <div class="evosci-muted" style="margin-bottom:8px">${escapeHtml(t('pages.evoscientist.install_progress', { progress: _state.installProgress }))}</div>
        <div class="upgrade-progress-wrap" style="margin-bottom:12px">
          <div class="upgrade-progress-bar">
            <div class="upgrade-progress-fill ${_state.installProgress >= 100 ? 'done' : ''}" style="width:${Math.min(100, Math.max(0, _state.installProgress))}%"></div>
          </div>
        </div>
        ${_state.installLogs.length ? `<div class="evosci-debug-box" style="max-height:160px">${escapeHtml(_state.installLogs.slice(-30).join('\n') || t('pages.evoscientist.waiting_install_logs'))}</div>` : ''}
      </div>
    `
  } else if (state === 'not_installed') {
    title = t('pages.evoscientist.blocking_not_installed')
    copy = t('pages.evoscientist.blocking_not_installed_copy')
    actions = `<button class="btn btn-primary btn-sm" data-action="install-evoscientist" ${_state.installing ? 'disabled' : ''}>${_state.installing ? escapeHtml(t('pages.evoscientist.installing_text')) : escapeHtml(t('pages.evoscientist.install_pr'))}</button>`
  } else if (state === 'needs_config') {
    title = t('pages.evoscientist.blocking_needs_config')
    copy = t('pages.evoscientist.blocking_needs_config_copy')
    const config = normalizeConfig(_state.configDraft || _state.status?.config || {})
    extra = `
      <div class="evosci-quick-config" style="margin-top:14px">
        <div class="form-group" style="margin-bottom:10px">
          <label class="form-label">Provider</label>
          <select class="form-input" data-quick-config="provider">
            ${PROVIDERS.map(p => `<option value="${escapeHtml(p.value)}" ${config.provider === p.value ? 'selected' : ''}>${escapeHtml(p.label)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="margin-bottom:10px">
          <label class="form-label">${escapeHtml(t('pages.evoscientist.field_label_model'))}</label>
          <input class="form-input" data-quick-config="model" value="${escapeHtml(config.model || '')}" placeholder="${escapeHtml(t('pages.evoscientist.model_id_placeholder'))}" />
        </div>
        ${renderQuickConfigFields(config)}
      </div>
    `
    actions = `
      <button class="btn btn-primary btn-sm" data-action="save-quick-config">${escapeHtml(t('pages.evoscientist.save_and_start'))}</button>
      <button class="btn btn-secondary btn-sm" data-action="load-from-openclaw">${escapeHtml(t('pages.evoscientist.btn_load_from_openclaw'))}</button>
      <button class="btn btn-secondary btn-sm" data-action="open-config">${escapeHtml(t('pages.evoscientist.advanced_config'))}</button>
    `
  } else if (state === 'stopped') {
    title = t('pages.evoscientist.blocking_stopped')
    copy = t('pages.evoscientist.blocking_stopped_copy')
    actions = `<button class="btn btn-primary btn-sm" data-action="start-bridge" ${_state.startingBridge ? 'disabled' : ''}>${_state.startingBridge ? escapeHtml(t('pages.evoscientist.starting_bridge')) : escapeHtml(t('pages.evoscientist.start_bridge'))}</button>`
  } else if (state === 'starting') {
    title = t('pages.evoscientist.blocking_starting')
    copy = readiness?.message || t('pages.evoscientist.blocking_starting_copy')
    actions = `<button class="btn btn-secondary btn-sm" data-action="refresh-status" ${_state.loadingStatus ? 'disabled' : ''}>${_state.loadingStatus ? escapeHtml(t('pages.evoscientist.refreshing')) : escapeHtml(t('pages.evoscientist.status_refresh_title'))}</button>`
  } else if (state === 'error') {
    title = t('pages.evoscientist.blocking_error')
    copy = readiness?.message || t('pages.evoscientist.blocking_error_copy')
    actions = `
      <button class="btn btn-primary btn-sm" data-action="start-bridge" ${_state.startingBridge ? 'disabled' : ''}>${_state.startingBridge ? escapeHtml(t('pages.evoscientist.starting_bridge')) : escapeHtml(t('pages.evoscientist.restart_bridge'))}</button>
      <button class="btn btn-secondary btn-sm" data-action="refresh-status" ${_state.loadingStatus ? 'disabled' : ''}>${_state.loadingStatus ? escapeHtml(t('pages.evoscientist.refreshing')) : escapeHtml(t('pages.evoscientist.status_refresh_title'))}</button>
    `
  } else if (state === 'unsupported') {
    title = t('pages.evoscientist.blocking_unsupported')
    copy = readiness?.message || t('pages.evoscientist.blocking_unsupported_copy')
  }

  return `
    <div class="evosci-empty-state">
      <div class="evosci-empty-title">${escapeHtml(title)}</div>
      <div class="evosci-empty-copy">${escapeHtml(copy)}</div>
      ${extra}
      ${actions ? `<div class="evosci-actions">${actions}</div>` : ''}
    </div>
  `
}

function composerPlaceholder(readiness) {
  const state = readiness?.state
  if (state === 'ready') return t('pages.evoscientist.composer_ready')
  if (_state.installing) return t('pages.evoscientist.composer_installing')
  if (state === 'not_installed') return t('pages.evoscientist.composer_not_installed')
  if (state === 'needs_config') return t('pages.evoscientist.composer_needs_config')
  if (state === 'starting') return t('pages.evoscientist.composer_starting')
  return t('pages.evoscientist.composer_default')
}

// ─── 空状态(简化版,CE 移除行业案例画廊) ──────────────────

function buildEvosciEmptyGallery() {
  return `<div class="evosci-empty-state" style="text-align:center">
    <div class="evosci-empty-hero-icon" style="color:var(--accent-blue);display:inline-flex;align-items:center;justify-content:center">${icon('git-branch', 64)}</div>
    <div class="evosci-empty-title">${escapeHtml(t('pages.evoscientist.gallery_ready_title'))}</div>
    <div class="evosci-empty-copy">${escapeHtml(t('pages.evoscientist.gallery_ready_copy'))}</div>
    <div class="evosci-prompt-chips" style="margin-top:16px">
      <button class="evosci-prompt-chip stagger-item" style="--stagger-i:0" data-action="fill-prompt" data-prompt="${escapeHtml(t('pages.evoscientist.gallery_chip_research_prompt'))}">${escapeHtml(t('pages.evoscientist.gallery_chip_research'))}</button>
      <button class="evosci-prompt-chip stagger-item" style="--stagger-i:1" data-action="fill-prompt" data-prompt="${escapeHtml(t('pages.evoscientist.gallery_chip_audit_prompt'))}">${escapeHtml(t('pages.evoscientist.gallery_chip_audit'))}</button>
      <button class="evosci-prompt-chip stagger-item" style="--stagger-i:2" data-action="fill-prompt" data-prompt="${escapeHtml(t('pages.evoscientist.gallery_chip_guide_prompt'))}">${escapeHtml(t('pages.evoscientist.gallery_chip_guide'))}</button>
    </div>
  </div>`
}

// ── 增量渲染基础设施 ──────────────────────────────────────

let _renderScheduled = false
let _renderMode = 'full' // 'full' | 'timeline'
let _userScrolledUp = false

/** 批处理渲染：同一帧内多个事件只触发一次 */
function scheduleRender(mode = 'full') {
  if (mode === 'full') _renderMode = 'full'
  else if (_renderMode !== 'full') _renderMode = 'timeline'
  if (_renderScheduled) return
  _renderScheduled = true
  requestAnimationFrame(() => {
    _renderScheduled = false
    const m = _renderMode
    _renderMode = 'timeline'
    if (m === 'full') renderAll()
    else renderTimelineOnly()
  })
}

/** 只更新 timeline 区域，不重建 toolbar/composer/sessions */
function renderTimelineOnly() {
  updateTimeline()
  syncRuntimeSnapshot()
}

/** 提取条目 body 内容（用于流式增量更新） */
function renderEntryBodyContent(entry) {
  if (entry.kind === 'assistant') return renderMarkdown(entry.content || '')
  if (entry.kind === 'thinking') return escapeHtml(entry.content || '')
  return escapeHtml(entry.content || '')
}

/** 增量更新 timeline DOM：只追加新条目，只更新流式条目内容 */
function updateTimeline() {
  const timelineEl = document.getElementById('evosci-timeline')
  if (!timelineEl) { renderChatSection(); return }

  const entries = _state.timeline

  for (const entry of entries) {
    const existingEl = timelineEl.querySelector(`[data-entry-id="${entry.id}"]`)
    if (!existingEl) {
      // 新条目：追加到 timeline 末尾
      const wrapper = document.createElement('div')
      wrapper.innerHTML = renderTimelineEntry(entry)
      const newEl = wrapper.firstElementChild
      if (newEl) {
        newEl.classList.add('evosci-new')
        timelineEl.appendChild(newEl)
        newEl.addEventListener('animationend', () => newEl.classList.remove('evosci-new'), { once: true })
      }
    } else if (entry.streaming) {
      // 流式更新：只更新 body 内容，不重建整个条目
      const bodyEl = existingEl.querySelector('.evosci-entry-body')
      if (bodyEl) {
        const newContent = renderEntryBodyContent(entry)
        if (bodyEl.innerHTML !== newContent) bodyEl.innerHTML = newContent
        if (!bodyEl.classList.contains('evosci-streaming')) bodyEl.classList.add('evosci-streaming')
      }
    } else if (existingEl.querySelector('.evosci-streaming')) {
      // 流式结束：移除 streaming class，最终渲染
      const bodyEl = existingEl.querySelector('.evosci-entry-body')
      if (bodyEl) {
        bodyEl.classList.remove('evosci-streaming')
        bodyEl.innerHTML = renderEntryBodyContent(entry)
      }
    }
  }

  smartScroll(timelineEl)
}

/** 智能滚动：用户上滚时不强制拉回底部 */
function initScrollTracking(el) {
  el.addEventListener('scroll', () => {
    const { scrollTop, scrollHeight, clientHeight } = el
    _userScrolledUp = scrollHeight - scrollTop - clientHeight > 80
  }, { passive: true })
}

function smartScroll(el) {
  if (_userScrolledUp) return
  requestAnimationFrame(() => {
    el.scrollTop = el.scrollHeight
  })
}

function renderChatSection() {
  if (!_chatEl) return
  ensurePersonaState()
  const status = _state.status || {}
  const readiness = currentReadiness() || applyEvoscientistStatus(status)
  const ready = readiness?.state === 'ready'
  const blockedByInteraction = hasBlockingInteraction()
  const threadLabel = _state.selectedThreadId || status.currentThreadId || t('pages.evoscientist.new_thread')
  const persona = normalizeEvoscientistPersona(_state.personaDraft)
  const timeline = _state.timeline.length
    ? renderTimelineEntries(_state.timeline)
    : (ready ? buildEvosciEmptyGallery() : '')
  const blockingCard = getChatBlockingCard(readiness)
  const showBlockingCard = readiness?.state !== 'ready'

  const observedScientists = collectObservedScientists()
  const sessions = _state.sessions || []
  const threadPickerOptions = [
    `<option value="">${escapeHtml(t('pages.evoscientist.new_thread'))}</option>`,
    ...sessions.map(s => {
      const tid = s.thread_id || s.threadId || ''
      const label = summarizeText(s.preview || s.summary || '', 32) || shortId(tid, 16)
      return `<option value="${escapeHtml(tid)}" ${tid === _state.selectedThreadId ? 'selected' : ''}>${escapeHtml(label)}</option>`
    }),
  ].join('')

  // Composer 上下文 chip
  const workspaceDirLabel = _state.selectedWorkspaceDir
    ? summarizeText(_state.selectedWorkspaceDir.split('/').pop() || _state.selectedWorkspaceDir, 24)
    : (status.defaultWorkspaceDir ? summarizeText(status.defaultWorkspaceDir.split('/').pop() || status.defaultWorkspaceDir, 24) : t('pages.evoscientist.workspace_not_set'))
  const threadChipLabel = getThreadDisplayName(threadLabel)

  _chatEl.innerHTML = `
    <div class="evosci-chat-shell${_state.sending ? ' running' : ''}">
      <div class="evosci-chat-toolbar">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-width:0">
          <select class="form-input" data-chat-field="thread-picker" style="max-width:220px;font-size:12px;padding:4px 8px" ${blockedByInteraction ? 'disabled' : ''}>${threadPickerOptions}</select>
          ${persona.overlayEnabled ? `<span class="evosci-pill ok" style="font-size:11px" title="${escapeHtml(t('pages.evoscientist.persona_overlay_on'))}">${icon('target', 12)}</span>` : ''}
        </div>
        <div class="evosci-actions">
          ${observedScientists.length ? `<button class="evosci-icon-btn" data-action="toggle-collab-panel" title="${escapeHtml(t('pages.evoscientist.collab_path'))}">${icon('target', 14)}</button>` : ''}
          <button class="evosci-icon-btn" data-action="show-architecture-modal" title="${escapeHtml(t('pages.evoscientist.understand_collab'))}">${icon('info', 14)}</button>
          <button class="btn btn-secondary btn-sm" data-action="clear-timeline">${escapeHtml(t('pages.evoscientist.clear_timeline'))}</button>
        </div>
      </div>

      ${_state.chatNotice
        ? `<div class="evosci-note-strip">${icon('info', 14)} <span>${escapeHtml(_state.chatNotice)}</span></div>`
        : ''
      }

      ${showBlockingCard && !_state.timeline.length ? blockingCard : ''}

      <div class="evosci-timeline" id="evosci-timeline">
        ${showBlockingCard && _state.timeline.length ? blockingCard : ''}
        ${timeline}
      </div>

      ${renderInterruptPanel()}
      ${renderAskUserPanel()}

      ${renderSwarmPanel(observedScientists, { id: 'evosci-chat-swarm-panel' })}

      ${renderExportPanel()}

      <div class="evosci-composer">
        <div style="flex:1;min-width:0">
          <div class="evosci-composer-context">
            <button class="evosci-workspace-chip" data-action="pick-workspace" title="${escapeHtml(_state.selectedWorkspaceDir || status.defaultWorkspaceDir || '')}">${icon('folder', 11)} ${escapeHtml(workspaceDirLabel)}</button>
            <span class="evosci-thread-chip">${icon('git-branch', 11)} ${escapeHtml(threadChipLabel)}</span>
          </div>
          <textarea class="form-input" id="evosci-composer" rows="3" ${ready ? '' : 'disabled'} placeholder="${escapeHtml(composerPlaceholder(readiness))}">${escapeHtml(_state.composerText)}</textarea>
        </div>
        <div>
          <button class="btn btn-primary${_state.sending ? ' btn-loading' : ''}" data-action="send-message" ${(!ready || _state.installing || _state.sending) ? 'disabled' : ''}>${_state.sending ? escapeHtml(t('pages.evoscientist.sending')) : escapeHtml(t('pages.evoscientist.send'))}</button>
          <div class="evosci-send-hint">${IS_MAC ? '⌘' : 'Ctrl'}+Enter</div>
        </div>
      </div>
    </div>
  `

  _timelineScrollEl = _chatEl.querySelector('#evosci-timeline')
  if (_timelineScrollEl) {
    _userScrolledUp = false // 全量渲染后重置滚动状态
    initScrollTracking(_timelineScrollEl)
    smartScroll(_timelineScrollEl)
  }
}

function renderDebugSection() {
  if (!_debugEl) return
  const status = _state.status || {}
  const readiness = currentReadiness()
  const runtimeSnapshot = _state.runtimeSnapshot || {}
  _debugEl.innerHTML = `
    <details class="evosci-debug-details">
      <summary>
        <span>${escapeHtml(t('pages.evoscientist.debug_advanced'))}</span>
        <span class="evosci-muted">${escapeHtml(t('pages.evoscientist.debug_copy'))}</span>
      </summary>
      <div class="evosci-debug-content">
        <div>
          <div class="evosci-muted" style="margin-bottom:8px">${escapeHtml(t('pages.evoscientist.debug_snapshot'))}</div>
          <div class="evosci-debug-box">${escapeHtml(stringifyPretty({
            readinessState: readiness?.state,
            runtimeSnapshot,
            selectedThreadId: _state.selectedThreadId,
            selectedWorkspaceDir: _state.selectedWorkspaceDir,
            bridgeRunning: status.bridgeRunning,
            bridgeReady: status.bridgeReady,
            currentThreadId: status.currentThreadId,
            currentWorkspaceDir: status.currentWorkspaceDir,
            sessionsDbPath: status.sessionsDbPath,
            configPath: status.configPath,
            lastError: status.lastError,
          }))}</div>
        </div>
        <div>
          <div class="evosci-muted" style="margin-bottom:8px">${escapeHtml(t('pages.evoscientist.debug_recent_logs'))}</div>
          <div class="evosci-debug-box">${escapeHtml((status.logTail || []).slice(-80).join('\n') || t('pages.evoscientist.debug_no_logs'))}</div>
        </div>
      </div>
    </details>
  `
}

function syncTabVisibility() {
  const currentTab = getCurrentTab()
  if (_statusEl) _statusEl.hidden = false
  if (_chatLayoutEl) _chatLayoutEl.hidden = currentTab !== 'chat'
  if (_settingsEl) _settingsEl.hidden = currentTab !== 'settings'
  if (_debugEl) _debugEl.hidden = currentTab !== 'settings'
}

function renderAll() {
  ensurePersonaState()
  renderStatusSection()
  renderSessionsSection()
  renderChatSection()
  renderSettingsSection()
  renderDebugSection()
  syncTabVisibility()
  syncConfigModal()
  syncRuntimeSnapshot()
}

function maybeOpenDeferredConfigPanel() {
  if (sessionStorage.getItem('evoscientist-open-config') !== '1') return
  sessionStorage.removeItem('evoscientist-open-config')
  openConfigModal()
}

function applyStatus(status, { preserveDraft = true, syncReadiness = true } = {}) {
  _state.status = status
  if (syncReadiness) applyEvoscientistStatus(status)
  if (!preserveDraft || !_state.configDirty) {
    _state.configDraft = normalizeConfig(status?.config || {})
    _state.configDirty = false
  }
  if (Array.isArray(status?.sessions)) {
    _state.sessions = status.sessions
  }
  _state.selectedThreadId = resolveSelectedThreadId({
    selectedThreadId: _state.selectedThreadId,
    threadSelectionLocked: _state.threadSelectionLocked,
  }, status)
  setSelectedWorkspaceFromStatus(status)
  renderAll()
  maybeOpenDeferredConfigPanel()
}

async function refreshStatus({ preserveDraft = true, quiet = false } = {}) {
  _state.loadingStatus = true
  renderStatusSection()
  try {
    const readiness = await refreshEvoscientistReadiness({ force: true, quiet })
    applyStatus(readiness?.status || null, { preserveDraft, syncReadiness: false })
  } catch (error) {
    if (!quiet) toast(t('pages.evoscientist.toast_refresh_failed', { error: String(error) }), 'error')
    addTimelineEntry({ kind: 'error', content: String(error) })
    renderAll()
  } finally {
    _state.loadingStatus = false
    renderStatusSection()
  }
}

async function refreshSessions({ quiet = false } = {}) {
  if (!_state.status?.installed) {
    _state.sessions = []
    renderSessionsSection()
    return
  }
  _state.loadingSessions = true
  renderSessionsSection()
  try {
    const result = await api.listEvoscientistSessions(20)
    _state.sessions = Array.isArray(result?.sessions) ? result.sessions : []
  } catch (error) {
    if (!quiet) toast(t('pages.evoscientist.toast_sessions_failed', { error: String(error) }), 'error')
  } finally {
    _state.loadingSessions = false
    renderSessionsSection()
  }
}

async function installEvoscientist() {
  _state.installing = true
  _state.installLogs = []
  _state.installProgress = 0
  renderAll()
  try {
    const status = await api.installEvoscientist()
    invalidate('get_evoscientist_status', 'list_evoscientist_sessions')
    applyStatus(status, { preserveDraft: false, syncReadiness: true })
    await refreshSessions({ quiet: true })
    toast(t('pages.evoscientist.toast_install_complete'), 'success')
  } catch (error) {
    toast(t('pages.evoscientist.toast_install_failed', { error: String(error) }), 'error')
    addTimelineEntry({ kind: 'error', content: t('pages.evoscientist.toast_install_failed', { error: String(error) }) })
    renderAll()
  } finally {
    _state.installing = false
    renderAll()
  }
}

function buildConfigModalContent() {
  const status = _state.status || {}
  const config = _state.configDraft
  const fields = providerFields(config.provider)
  const issues = getEvoscientistConfigIssues(config)
  const fallbackWorkspace = status.defaultWorkspaceDir || status.workspaceRoot || '--'
  const alertTone = issues.complete ? 'ok' : 'warn'
  const alertMessage = issues.complete
    ? t('pages.evoscientist.config_complete_msg')
    : t('pages.evoscientist.config_missing_msg', { fields: issues.missingLabels.join('、') || t('pages.evoscientist.config_missing_default') })

  return `
    <div class="evosci-modal-shell">
      <div class="evosci-modal-head">
        <div>
          <div class="evosci-surface-title" style="margin-bottom:4px">${escapeHtml(t('pages.evoscientist.config_modal_title'))}</div>
          <div class="evosci-modal-copy">${escapeHtml(t('pages.evoscientist.config_modal_copy'))}</div>
        </div>
        <span class="evosci-inline-status${issues.complete ? ' ok' : ' warn'}">${issues.complete ? escapeHtml(t('pages.evoscientist.config_can_start')) : escapeHtml(t('pages.evoscientist.config_needs_config'))}</span>
      </div>

      <div class="evosci-modal-alert ${alertTone}">${escapeHtml(alertMessage)}</div>

      <div class="evosci-config-meta">
        <div class="evosci-config-meta-item">
          <strong>${escapeHtml(t('pages.evoscientist.config_install_status'))}</strong>
          <span>${status.installed ? escapeHtml(t('pages.evoscientist.config_installed')) : escapeHtml(t('pages.evoscientist.config_not_installed'))}</span>
        </div>
        <div class="evosci-config-meta-item">
          <strong>${escapeHtml(t('pages.evoscientist.config_default_workdir'))}</strong>
          <span>${escapeHtml(fallbackWorkspace)}</span>
        </div>
        <div class="evosci-config-meta-item">
          <strong>${escapeHtml(t('pages.evoscientist.config_file'))}</strong>
          <span>${escapeHtml(status.configPath || status.configRoot || '--')}</span>
        </div>
      </div>

      <div class="evosci-form-grid">
        <div class="form-group">
          <label class="form-label">Provider</label>
          <select class="form-input" data-config-field="provider">
            ${PROVIDERS.map(item => `<option value="${escapeHtml(item.value)}" ${item.value === config.provider ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">${escapeHtml(FIELD_LABELS.model)}</label>
          <input class="form-input" data-config-field="model" value="${escapeHtml(config.model)}" placeholder="${escapeHtml(t('pages.evoscientist.config_model_placeholder'))}">
        </div>
        <div class="form-group">
          <label class="form-label">${escapeHtml(FIELD_LABELS.tavily_api_key)}</label>
          <input class="form-input" data-config-field="tavily_api_key" type="password" value="${escapeHtml(config.tavily_api_key)}" placeholder="${escapeHtml(t('pages.evoscientist.config_tavily_placeholder'))}">
        </div>
        <div class="form-group">
          <label class="form-label">${escapeHtml(FIELD_LABELS.default_workdir)}</label>
          <input class="form-input" data-config-field="default_workdir" value="${escapeHtml(config.default_workdir)}" placeholder="${escapeHtml(fallbackWorkspace)}">
          <div class="form-hint">${escapeHtml(t('pages.evoscientist.config_workdir_hint'))}</div>
        </div>
        ${fields.map(field => `
          <div class="form-group">
            <label class="form-label">${escapeHtml(FIELD_LABELS[field] || field)}</label>
            <input
              class="form-input"
              data-config-field="${escapeHtml(field)}"
              ${field.includes('key') ? 'type="password"' : ''}
              value="${escapeHtml(config[field] || '')}"
              placeholder="${field.includes('base_url') ? 'https://...' : ''}"
            >
          </div>
        `).join('')}
      </div>

      <div class="evosci-inline-checks">
        <label class="evosci-check">
          <input type="checkbox" data-config-checkbox="auto_approve" ${config.auto_approve ? 'checked' : ''}>
          <span>${escapeHtml(t('pages.evoscientist.config_auto_approve'))}</span>
        </label>
        <label class="evosci-check">
          <input type="checkbox" data-config-checkbox="enable_ask_user" ${config.enable_ask_user ? 'checked' : ''}>
          <span>${escapeHtml(t('pages.evoscientist.config_enable_ask_user'))}</span>
        </label>
      </div>
    </div>
  `
}

function syncConfigModal() {
  const modal = getConfigModal()
  if (!modal) return
  const body = modal.querySelector('.modal-content-body')
  if (body) body.innerHTML = buildConfigModalContent()
  const saveBtn = modal.querySelector('#evosci-config-save')
  if (saveBtn) {
    saveBtn.textContent = _state.savingConfig ? t('pages.evoscientist.config_saving') : t('pages.evoscientist.config_save_btn')
    saveBtn.disabled = !_state.status?.installed || _state.savingConfig
  }
  const resetBtn = modal.querySelector('#evosci-config-reset')
  if (resetBtn) resetBtn.disabled = _state.savingConfig
}

function openConfigModal() {
  let modal = getConfigModal()
  if (!modal) {
    modal = showContentModal({
      title: t('pages.evoscientist.config_modal_title'),
      content: buildConfigModalContent(),
      buttons: [
        { label: t('pages.evoscientist.config_reset_btn'), className: 'btn btn-secondary btn-sm', id: 'evosci-config-reset' },
        { label: t('pages.evoscientist.config_save_btn'), className: 'btn btn-primary btn-sm', id: 'evosci-config-save' },
      ],
      width: 760,
    })
    modal.dataset.evosciConfig = '1'
    modal.addEventListener('input', event => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      if (target.matches('[data-config-field]')) {
        const key = target.dataset.configField
        if (key) {
          _state.configDraft[key] = target.value
          _state.configDirty = true
        }
      }
      if (target.matches('[data-config-checkbox]')) {
        const key = target.dataset.configCheckbox
        if (key) {
          _state.configDraft[key] = !!target.checked
          _state.configDirty = true
        }
      }
    })
    modal.addEventListener('change', event => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      if (target.matches('[data-config-field="provider"]')) {
        syncConfigModal()
      }
    })
    modal.querySelector('#evosci-config-save')?.addEventListener('click', async () => {
      await saveConfig()
    })
    modal.querySelector('#evosci-config-reset')?.addEventListener('click', () => {
      _state.configDraft = normalizeConfig(_state.status?.config || {})
      _state.configDirty = false
      syncConfigModal()
      renderStatusSection()
      renderChatSection()
    })
  }
  syncConfigModal()
}

/** 从 OpenClaw 配置获取主模型并回填到快速配置 */
async function handleLoadFromOpenclaw() {
  try {
    const { parsed, primary } = await fetchOpenclawPrimaryModel()
    // 映射 OpenClaw provider → evoscientist provider
    const evosciProvider = apiTypeToProvider(openclawProviderToApiType(parsed.providerKey), parsed.baseUrl)
    // 更新 configDraft
    if (!_state.configDraft) _state.configDraft = normalizeConfig(_state.status?.config || {})
    _state.configDraft.provider = evosciProvider
    _state.configDraft.model = parsed.modelId
    if (parsed.baseUrl) _state.configDraft.baseUrl = parsed.baseUrl
    // 回填到快速配置表单
    const providerSelect = _page?.querySelector('[data-quick-config="provider"]')
    const modelInput = _page?.querySelector('[data-quick-config="model"]')
    if (providerSelect) providerSelect.value = evosciProvider
    if (modelInput) modelInput.value = parsed.modelId
    toast(t('pages.evoscientist.msg_model_loaded', { primary }), 'info')
  } catch (e) {
    const msg = e.message === 'no-models' ? 'OpenClaw 尚未配置模型，请先到模型配置页面添加'
      : e.message === 'no-primary' ? '未找到有效的主模型配置'
      : '从 OpenClaw 获取模型失败: ' + (e.message || e)
    toast(msg, e.message?.startsWith('no-') ? 'warning' : 'error')
  }
}

async function saveConfig() {
  if (!_state.status?.installed) {
    toast(t('pages.evoscientist.toast_install_first'), 'error')
    return
  }
  _state.savingConfig = true
  syncConfigModal()
  renderStatusSection()
  try {
    const prevDefaultWorkdir = _state.status?.config?.default_workdir || ''
    const newDefaultWorkdir = _state.configDraft.default_workdir || ''
    const result = await api.saveEvoscientistConfig(_state.configDraft)
    _state.configDraft = normalizeConfig(result?.config || _state.configDraft)
    _state.configDirty = false
    // 仅当 default_workdir 实际发生变更时，同步到选中的工作目录
    if (newDefaultWorkdir && newDefaultWorkdir !== prevDefaultWorkdir) {
      _state.selectedWorkspaceDir = newDefaultWorkdir
      try { localStorage.setItem('prospectclaw-evo-workspace-dir', newDefaultWorkdir) } catch {}
    }
    invalidate('get_evoscientist_status')
    await refreshStatus({ preserveDraft: false, quiet: true })
    const postSaveReadiness = currentReadiness()
    if (postSaveReadiness?.state === 'stopped') {
      toast(t('pages.evoscientist.toast_config_saved_auto_start'), 'success')
      await startBridge()
    } else {
      toast(t('pages.evoscientist.toast_config_saved'), 'success')
    }
  } catch (error) {
    toast(t('pages.evoscientist.toast_config_save_failed', { error: String(error) }), 'error')
  } finally {
    _state.savingConfig = false
    syncConfigModal()
    renderAll()
  }
}

async function startBridge() {
  if (!_state.status?.installed) {
    toast(t('pages.evoscientist.toast_install_first'), 'error')
    return
  }
  const issues = getEvoscientistConfigIssues(_state.status?.config || _state.configDraft)
  if (!issues.complete) {
    openConfigModal()
    toast(t('pages.evoscientist.toast_missing_config', { fields: issues.missingLabels.join('、') }), 'warning')
    return
  }
  _state.startingBridge = true
  renderAll()
  try {
    const status = await api.startEvoscientistBridge()
    invalidate('get_evoscientist_status')
    applyStatus(status, { preserveDraft: true, syncReadiness: true })
    toast(t('pages.evoscientist.toast_bridge_started'), 'success')
  } catch (error) {
    toast(t('pages.evoscientist.toast_bridge_start_failed', { error: String(error) }), 'error')
    await refreshStatus({ preserveDraft: true, quiet: true })
  } finally {
    _state.startingBridge = false
    renderAll()
  }
}

async function stopBridge() {
  _state.stoppingBridge = true
  renderAll()
  try {
    await api.stopEvoscientistBridge()
    invalidate('get_evoscientist_status')
    _state.sending = false
    finishStreamEntries()
    await refreshStatus({ preserveDraft: true, quiet: true })
    toast(t('pages.evoscientist.toast_bridge_stopped'), 'success')
  } catch (error) {
    toast(t('pages.evoscientist.toast_bridge_stop_failed', { error: String(error) }), 'error')
  } finally {
    _state.stoppingBridge = false
    renderAll()
  }
}

async function sendMessage() {
  const message = _state.composerText.trim()
  if (!message) return
  if (hasBlockingInteraction()) {
    toast(t('pages.evoscientist.toast_interaction_skipped'), 'info')
  }
  const readiness = currentReadiness()
  if (readiness?.state !== 'ready') {
    toast(t('pages.evoscientist.toast_bridge_not_ready'), 'error')
    return
  }
  _state.sending = true
  _state.pendingInterrupt = null
  _state.pendingAskUser = null
  _state.askUserAnswers = {}
  _state.chatNotice = ''
  beginTaskRun()
  addTimelineEntry({ kind: 'user', content: message })
  const outbound = buildOutboundMessage(message)
  _state.composerText = ''
  renderAll()
  try {
    await api.sendEvoscientistMessage(
      _runtimeSessionId,
      outbound.message,
      _state.selectedThreadId || null,
      _state.selectedWorkspaceDir || null,
    )
    _sendTimeoutId = setTimeout(() => {
      if (_state.sending) {
        _state.sending = false
        finishStreamEntries()
        addTimelineEntry({ kind: 'system', content: t('pages.evoscientist.timeout_msg') })
        renderAll()
      }
      _sendTimeoutId = null
    }, 30000)
  } catch (error) {
    if (_sendTimeoutId) { clearTimeout(_sendTimeoutId); _sendTimeoutId = null }
    _state.sending = false
    finishStreamEntries()
    addTimelineEntry({ kind: 'error', content: t('pages.evoscientist.toast_send_failed', { error: String(error) }) })
    renderAll()
    toast(t('pages.evoscientist.toast_send_failed', { error: String(error) }), 'error')
  }
}

async function resumeInterrupt(decision) {
  if (!_state.pendingInterrupt) return
  const actionRequests = Array.isArray(_state.pendingInterrupt.action_requests)
    ? _state.pendingInterrupt.action_requests
    : []
  if (decision === 'reject' && !interruptRejectSupported(_state.pendingInterrupt)) {
    toast(t('pages.evoscientist.toast_reject_unsupported'), 'error')
    return
  }
  const resume = {
    decisions: Array.from({ length: Math.max(1, actionRequests.length) }, () => (
      decision === 'approve'
        ? { type: 'approve' }
        : { type: 'reject', message: 'Rejected in Privix UI.' }
    )),
  }
  _state.sending = true
  renderAll()
  try {
    await api.resumeEvoscientistInterrupt(
      _runtimeSessionId,
      _state.selectedThreadId,
      resume,
      _state.selectedWorkspaceDir || null,
    )
    _state.pendingInterrupt = null
    if (decision !== 'approve') {
      addTimelineEntry({ kind: 'system', content: t('pages.evoscientist.toast_interrupt_rejected') })
    }
    renderAll()
  } catch (error) {
    _state.sending = false
    toast(t('pages.evoscientist.toast_resume_failed', { error: String(error) }), 'error')
    renderAll()
  }
}

function collectAskUserAnswers() {
  const questions = _state.pendingAskUser?.questions || []
  const answers = []
  for (let index = 0; index < questions.length; index += 1) {
    const question = questions[index] || {}
    const value = String(_state.askUserAnswers[String(index)] ?? '').trim()
    if (question.required !== false && !value) {
      throw new Error(t('pages.evoscientist.toast_answer_required', { n: index + 1 }))
    }
    answers.push(value)
  }
  return answers
}

async function submitAskUser(status = 'answered') {
  if (!_state.pendingAskUser) return
  _state.sending = true
  renderAll()
  try {
    const resume = status === 'cancelled'
      ? { status: 'cancelled' }
      : { answers: collectAskUserAnswers(), status: 'answered' }
    await api.resumeEvoscientistInterrupt(
      _runtimeSessionId,
      _state.selectedThreadId,
      resume,
      _state.selectedWorkspaceDir || null,
    )
    _state.pendingAskUser = null
    _state.askUserAnswers = {}
    renderAll()
  } catch (error) {
    _state.sending = false
    toast(String(error), 'error')
    renderAll()
  }
}

function selectSession(threadId) {
  if (hasBlockingInteraction() && (threadId || '') !== (_state.selectedThreadId || '')) {
    toast(t('pages.evoscientist.toast_thread_blocked'), 'warning')
    renderAll()
    return
  }
  _state.selectedThreadId = threadId || ''
  _state.threadSelectionLocked = true
  clearTaskOutputState()
  finishStreamEntries()
  if (threadId) {
    _state.chatNotice = t('pages.evoscientist.switched_history_thread', { threadId })
  } else {
    _state.chatNotice = t('pages.evoscientist.switched_new_thread')
  }
  renderAll()
}

function handleEventPayload(payload) {
  if (!payload) return

  if (payload.sessionId && payload.sessionId !== _runtimeSessionId) {
    return
  }

  if (payload.threadId) {
    _state.selectedThreadId = payload.threadId
    _state.threadSelectionLocked = true
  }
  if (payload.workspaceDir) {
    _state.selectedWorkspaceDir = payload.workspaceDir
    try { localStorage.setItem('prospectclaw-evo-workspace-dir', payload.workspaceDir) } catch {}
  }

  if (payload.kind === 'bridge') {
    if (_state.status) {
      _state.status.bridgeRunning = payload.type !== 'stopping'
      _state.status.bridgeReady = payload.type === 'ready'
      applyEvoscientistStatus(_state.status)
    }
    renderAll()
    return
  }

  if (payload.kind === 'log') {
    if (_state.status) {
      _state.status.logTail = [...(_state.status.logTail || []), `[${payload.stream}] ${payload.message}`].slice(-200)
      if (payload.stream === 'stderr') {
        _state.status.lastError = payload.message
        applyEvoscientistStatus(_state.status)
      }
    }
    renderDebugSection()
    renderStatusSection()
    return
  }

  if (payload.kind === 'error') {
    _state.sending = false
    finishStreamEntries()
    addTimelineEntry({ kind: 'error', content: payload.message || t('pages.evoscientist.bridge_error_returned') })
    if (_state.status) {
      _state.status.lastError = payload.message || ''
      applyEvoscientistStatus(_state.status)
    }
    renderAll()
    return
  }

  if (payload.kind === 'result') {
    _state.sending = false
    if (!payload.paused) {
      finishStreamEntries()
      _state.pendingInterrupt = null
      _state.pendingAskUser = null
      _state.askUserAnswers = {}
    }
    renderAll()
    return
  }

  if (payload.kind !== 'event') return

  const event = payload.event || {}
  const type = event.type || ''

  if (type === 'thinking') {
    const entry = ensureStreamEntry('thinking')
    entry.content += event.content || ''
  } else if (type === 'text') {
    const entry = ensureStreamEntry('assistant')
    entry.content += event.content || ''
  } else if (type === 'tool_call') {
    addTimelineEntry({ kind: 'tool_call', name: event.name, args: event.args || {} })
  } else if (type === 'tool_result') {
    addTimelineEntry({ kind: 'tool_result', name: event.name, content: event.content || '', success: !!event.success })
  } else if (type.startsWith('subagent_')) {
    addTimelineEntry({
      kind: type,
      label: `${event.subagent || event.name || 'subagent'} · ${type.replace('subagent_', '')}`,
      content: event.content || '',
      payload: event,
    })
  } else if (type === 'interrupt') {
    finishStreamEntries()
    _state.sending = false
    _state.pendingInterrupt = event
    _state.pendingAskUser = null
    addTimelineEntry({ kind: 'interrupt', payload: event })
  } else if (type === 'ask_user') {
    finishStreamEntries()
    _state.sending = false
    _state.pendingAskUser = event
    _state.pendingInterrupt = null
    _state.askUserAnswers = {}
    addTimelineEntry({ kind: 'ask_user', payload: event })
  } else if (type === 'usage_stats') {
    addTimelineEntry({
      kind: 'usage',
      inputTokens: event.input_tokens ?? 0,
      outputTokens: event.output_tokens ?? 0,
    })
  } else if (type === 'done') {
    if (event.response && !_state.activeAssistantEntryId) {
      addTimelineEntry({ kind: 'assistant', content: event.response, streaming: false })
    }
    finishStreamEntries()
    if (_sendTimeoutId) { clearTimeout(_sendTimeoutId); _sendTimeoutId = null }
    _state.sending = false
    _state.taskCompleted = true
    const collected = collectTaskOutput(_state.taskRunStartIndex)
    // 如果 timeline 没有收集到足够内容，但 done 事件携带了 response，使用它
    _state.taskOutput = collected || (event.response ? String(event.response) : '')
    _state.taskOutputThreadId = payload.threadId || _state.selectedThreadId || ''
  } else if (type === 'error') {
    if (_sendTimeoutId) { clearTimeout(_sendTimeoutId); _sendTimeoutId = null }
    _state.sending = false
    finishStreamEntries()
    addTimelineEntry({ kind: 'error', content: event.message || t('pages.evoscientist.unknown_error') })
  } else {
    addTimelineEntry({ kind: 'system', content: stringifyPretty(event) })
  }

  // 流式事件只更新 timeline，状态变更事件走全量
  if (type === 'thinking' || type === 'text' || type === 'tool_call' || type === 'tool_result' || type.startsWith('subagent_') || type === 'usage_stats') {
    scheduleRender('timeline')
  } else {
    scheduleRender('full')
  }
}

async function ensureListeners() {
  if (!IS_TAURI || _unlistenEvent) return
  const listen = await LISTEN_READY
  if (!listen) return
  _unlistenEvent = await listen('evoscientist-event', event => handleEventPayload(event.payload))
  _unlistenInstallLog = await listen('evoscientist-install-log', event => {
    _state.installLogs.push(String(event.payload || ''))
    _state.installLogs = _state.installLogs.slice(-200)
    renderStatusSection()
  })
  _unlistenInstallProgress = await listen('evoscientist-install-progress', event => {
    _state.installProgress = Number(event.payload || 0)
    renderStatusSection()
  })
}

function bindEvents(page) {
  page.addEventListener('click', async event => {
    const actionEl = event.target.closest('[data-action]')
    if (!actionEl) return
    const action = actionEl.dataset.action
    if (action === 'switch-tab') {
      switchTab(actionEl.dataset.tab || 'chat')
      return
    }
    if (action === 'refresh-status') await refreshStatus()
    if (action === 'install-evoscientist') await installEvoscientist()
    if (action === 'start-bridge') await startBridge()
    if (action === 'stop-bridge') await stopBridge()
    if (action === 'open-config') openConfigModal()
    if (action === 'refresh-sessions') await refreshSessions()
    if (action === 'new-thread') selectSession('')
    if (action === 'select-session') selectSession(actionEl.dataset.threadId || '')
    if (action === 'send-message') await sendMessage()
    if (action === 'approve-interrupt') await resumeInterrupt('approve')
    if (action === 'reject-interrupt') await resumeInterrupt('reject')
    if (action === 'submit-ask-user') await submitAskUser('answered')
    if (action === 'cancel-ask-user') await submitAskUser('cancelled')
    if (action === 'sync-persona-from-assistant') syncPersonaFromAssistant()
    if (action === 'sync-persona-from-agent-fleet') syncPersonaFromAgentFleet()
    if (action === 'refresh-agent-fleet') loadAgentFleetOptions()
    if (action === 'export-persona') exportPersonaPack()
    if (action === 'pick-export-path') await pickExportSavePath()
    if (action === 'export-local') await exportLocalDocument(actionEl.dataset.format || 'docx')
    if (action === 'import-persona') _personaImportEl?.click()
    if (action === 'copy-persona-overlay') await copyPersonaOverlay()
    if (action === 'reset-persona') resetPersonaDraft()
    if (action === 'save-quick-config') {
      await saveConfig()
      return
    }
    if (action === 'load-from-openclaw') {
      await handleLoadFromOpenclaw()
      return
    }
    if (action === 'toggle-tool-group') {
      const group = actionEl.closest('.evosci-tool-group')
      if (group) {
        const body = group.querySelector('.evosci-tool-group-body')
        const chevron = group.querySelector('.evosci-chevron')
        if (body) body.classList.toggle('open')
        if (chevron) chevron.classList.toggle('open', body?.classList.contains('open'))
      }
      return
    }
    if (action === 'pick-workspace') {
      
      if (_openFolderDialog) {
        const selected = await _openFolderDialog({ directory: true, title: t('pages.evoscientist.toast_pick_workspace_title') })
        if (selected) {
          _state.selectedWorkspaceDir = selected
          renderChatSection()
        }
      }
      return
    }
    if (action === 'toggle-collab-panel') {
      const panel = document.getElementById('evosci-chat-swarm-panel')
      if (panel) {
        panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      } else {
        showArchitectureModal()
      }
      return
    }
    if (action === 'show-architecture-modal') {
      showArchitectureModal()
      return
    }
    if (action === 'fill-prompt') {
      _state.composerText = actionEl.dataset.prompt || ''
      const composerEl = document.getElementById('evosci-composer')
      if (composerEl) {
        composerEl.value = _state.composerText
        composerEl.focus()
      }
      return
    }
    if (action === 'clear-timeline') {
      _state.timeline = []
      _state.pendingInterrupt = null
      _state.pendingAskUser = null
      _state.askUserAnswers = {}
      _state.chatNotice = ''
      _state.timelineExpanded = false
      clearTaskOutputState()
      _state.taskRunStartIndex = 0
      finishStreamEntries()
      renderAll()
    }

    // 时间线折叠区域点击展开
    if (event.target.closest('.evosci-timeline-collapsed')) {
      _state.timelineExpanded = true
      renderChatSection()
    }
  })

  page.addEventListener('input', event => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return

    if (target.matches('#evosci-composer')) {
      _state.composerText = target.value
      return
    }

    if (target.matches('[data-chat-field="workspace"]')) {
      _state.selectedWorkspaceDir = target.value
      try { localStorage.setItem('prospectclaw-evo-workspace-dir', target.value) } catch {}
      return
    }

    if (target.matches('[data-chat-field="thread-picker"]')) {
      selectSession(target.value || '')
      return
    }

    if (target.matches('[data-quick-config="provider"]')) {
      _state.configDraft.provider = target.value
      _state.configDirty = true
      renderChatSection()
      return
    }

    if (target.matches('[data-quick-config="model"]')) {
      _state.configDraft.model = target.value
      _state.configDirty = true
      return
    }

    if (target.matches('[data-quick-config-field]')) {
      const field = target.dataset.quickConfigField
      if (field) {
        _state.configDraft[field] = target.value
        _state.configDirty = true
      }
      return
    }

    if (target.matches('[data-ask-user-index]')) {
      _state.askUserAnswers[target.dataset.askUserIndex] = target.value
      return
    }

    if (target.matches('[data-persona-field]')) {
      const key = target.dataset.personaField
      if (!key) return
      _state.personaDraft[key] = target.value
      savePersonaDraft()
      return
    }

    if (target.matches('[data-persona-level]')) {
      const key = target.dataset.personaLevel
      if (!key) return
      _state.personaDraft.levels = {
        ..._state.personaDraft.levels,
        [key]: Number(target.value || 3),
      }
      savePersonaDraft()
      return
    }

    if (target.matches('[data-persona-checkbox]')) {
      const key = target.dataset.personaCheckbox
      if (!key) return
      _state.personaDraft[key] = !!target.checked
      savePersonaDraft()
    }
  })

  page.addEventListener('change', event => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return

    if (target === _personaImportEl) {
      const [file] = Array.from(_personaImportEl?.files || [])
      if (file) {
        void importPersonaPack(file).catch(error => {
          toast(t('pages.evoscientist.toast_persona_import_failed', { error: String(error) }), 'error')
        })
      }
      if (_personaImportEl) _personaImportEl.value = ''
      return
    }

    if (target.matches('[data-action-select="pick-agent-fleet"]')) {
      selectAgentForPreview(target.value)
      return
    }

    if (
      target.matches('[data-persona-field]')
      || target.matches('[data-persona-level]')
      || target.matches('[data-persona-checkbox]')
    ) {
      renderAll()
    }
  })

  page.addEventListener('keydown', async event => {
    if (!(event.target instanceof HTMLTextAreaElement)) return
    if (event.target.id !== 'evosci-composer') return
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      await sendMessage()
    }
  })

}

async function bootstrap() {
  await ensureListeners()
  if (_state.bootstrapped) return
  _state.bootstrapped = true
  await refreshStatus({ preserveDraft: false, quiet: true })
  await refreshSessions({ quiet: true })
  if (_state.agentFleetStatus === 'idle') loadAgentFleetOptions()

  const readiness = currentReadiness()
  if (readiness?.state === 'stopped' && !_state.startingBridge) {
    await startBridge()
  }
}

export async function render() {
  ensurePersonaState()
  if (IS_TAURI && !_state.exportSavePath && !_exportPathInitStarted) {
    _exportPathInitStarted = true
    _pathReady.then(async (fn) => {
      if (fn && !_state.exportSavePath) {
        try { _state.exportSavePath = await fn() } catch {}
      }
    })
  }
  const pageDesc = getEvoscientistTabMeta(getCurrentTab()).copy

  if (!_runtimeSessionId) {
    _runtimeSessionId = createSession('evoscientist')
    setSessionHandlers(_runtimeSessionId, {
      send: payload => {
        const outbound = buildOutboundMessage(payload?.message || '')
        return api.sendEvoscientistMessage(
          _runtimeSessionId,
          outbound.message,
          _state.selectedThreadId || null,
          _state.selectedWorkspaceDir || null,
        )
      },
      abort: () => api.stopEvoscientistBridge().then(() => true).catch(() => false),
    })
  }

  const page = document.createElement('div')
  page.className = 'page'
  _page = page

  page.innerHTML = `
    <div class="page-header">
      <h1 class="page-title apple-section">Prospect-Research</h1>
      <p class="page-desc apple-body-secondary">${escapeHtml(pageDesc)}</p>
    </div>
    <div class="evosci-layout">
      <input type="file" id="evosci-persona-import" accept=".json,application/json" style="display:none" />
      <div id="evosci-status"></div>
      <div class="evosci-main-grid evosci-pane" id="evosci-chat-layout">
        <div class="evosci-stack">
          <div id="evosci-sessions"></div>
        </div>
        <div class="evosci-stack">
          <div id="evosci-chat"></div>
        </div>
      </div>
      <div id="evosci-settings" class="evosci-pane"></div>
      <div id="evosci-debug" class="evosci-pane"></div>
    </div>
  `

  _statusEl = page.querySelector('#evosci-status')
  _chatLayoutEl = page.querySelector('#evosci-chat-layout')
  _sessionsEl = page.querySelector('#evosci-sessions')
  _chatEl = page.querySelector('#evosci-chat')
  _settingsEl = page.querySelector('#evosci-settings')
  _debugEl = page.querySelector('#evosci-debug')
  _personaImportEl = page.querySelector('#evosci-persona-import')

  if (_viewId) detachView(_runtimeSessionId, _viewId)
  _viewId = attachView(_runtimeSessionId, {
    onSnapshot(snapshot) {
      _state.runtimeSnapshot = snapshot
      renderDebugSection()
    },
  })

  if (_unlistenReadiness) _unlistenReadiness()
  _unlistenReadiness = onEvoscientistReadinessChange(snapshot => {
    if (!_page || !snapshot?.status) return
    applyStatus(snapshot.status, { preserveDraft: true, syncReadiness: false })
  })

  bindEvents(page)
  renderAll()

  if (!IS_TAURI) {
    applyStatus({
      supported: false,
      installed: false,
      bridgeRunning: false,
      bridgeReady: false,
      lastError: t('pages.evoscientist.tauri_only_error'),
      logTail: [],
    }, { preserveDraft: true, syncReadiness: true })
    return page
  }

  void bootstrap()
  return page
}

export function cleanup() {
  _unlistenEvent?.()
  _unlistenEvent = null
  _unlistenInstallLog?.()
  _unlistenInstallLog = null
  _unlistenInstallProgress?.()
  _unlistenInstallProgress = null
  _unlistenReadiness?.()
  _unlistenReadiness = null
  if (_runtimeSessionId && _viewId) {
    detachView(_runtimeSessionId, _viewId)
  }
  closeConfigModal()
  _viewId = null
  _page = null
  _statusEl = null
  _chatLayoutEl = null
  _sessionsEl = null
  _chatEl = null
  _settingsEl = null
  _debugEl = null
  _personaImportEl = null
  _timelineScrollEl = null
  _state.bootstrapped = false
  _state.chatNotice = ''
  _state.personaLoaded = false
}
