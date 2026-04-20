import { api, classifyBackendError } from './tauri-api.js'

const POLL_INTERVAL_MS = 15000

export const EVOSCIENTIST_PROVIDERS = [
  {
    value: 'anthropic',
    label: 'Anthropic',
    fields: ['anthropic_api_key', 'anthropic_base_url'],
    requiredFields: ['anthropic_api_key'],
  },
  {
    value: 'openai',
    label: 'OpenAI',
    fields: ['openai_api_key'],
    requiredFields: ['openai_api_key'],
  },
  {
    value: 'google-genai',
    label: 'Google GenAI',
    fields: ['google_api_key'],
    requiredFields: ['google_api_key'],
  },
  {
    value: 'minimax',
    label: 'MiniMax',
    fields: ['minimax_api_key'],
    requiredFields: ['minimax_api_key'],
  },
  {
    value: 'nvidia',
    label: 'NVIDIA',
    fields: ['nvidia_api_key'],
    requiredFields: ['nvidia_api_key'],
  },
  {
    value: 'custom-openai',
    label: 'Custom OpenAI',
    fields: ['custom_openai_api_key', 'custom_openai_base_url'],
    requiredFields: ['custom_openai_api_key', 'custom_openai_base_url'],
  },
  {
    value: 'custom-anthropic',
    label: 'Custom Anthropic',
    fields: ['custom_anthropic_api_key', 'custom_anthropic_base_url'],
    requiredFields: ['custom_anthropic_api_key', 'custom_anthropic_base_url'],
  },
  {
    value: 'ollama',
    label: 'Ollama',
    fields: ['ollama_base_url'],
    requiredFields: ['ollama_base_url'],
  },
]

export const EVOSCIENTIST_FIELD_LABELS = {
  anthropic_api_key: 'Anthropic API Key',
  anthropic_base_url: 'Anthropic Base URL',
  openai_api_key: 'OpenAI API Key',
  google_api_key: 'Google API Key',
  minimax_api_key: 'MiniMax API Key',
  nvidia_api_key: 'NVIDIA API Key',
  custom_openai_api_key: 'Custom OpenAI API Key',
  custom_openai_base_url: 'Custom OpenAI Base URL',
  custom_anthropic_api_key: 'Custom Anthropic API Key',
  custom_anthropic_base_url: 'Custom Anthropic Base URL',
  ollama_base_url: 'Ollama Base URL',
  tavily_api_key: 'Tavily API Key',
  default_workdir: '默认工作目录',
  model: '模型 ID',
  provider: 'Provider',
}

const BASE_CONFIG = Object.freeze({
  provider: 'anthropic',
  model: '',
  tavily_api_key: '',
  default_workdir: '',
  auto_approve: false,
  enable_ask_user: true,
  anthropic_api_key: '',
  anthropic_base_url: '',
  openai_api_key: '',
  google_api_key: '',
  minimax_api_key: '',
  nvidia_api_key: '',
  custom_openai_api_key: '',
  custom_openai_base_url: '',
  custom_anthropic_api_key: '',
  custom_anthropic_base_url: '',
  ollama_base_url: '',
})

let _snapshot = null
let _listeners = []
let _pollTimer = null
let _inflight = null

function providerMeta(provider) {
  return EVOSCIENTIST_PROVIDERS.find(item => item.value === provider) || EVOSCIENTIST_PROVIDERS[0]
}

function nonEmpty(value) {
  return typeof value === 'string' ? value.trim().length > 0 : !!value
}

function snapshotChanged(left, right) {
  if (!left || !right) return left !== right
  return JSON.stringify({
    state: left.state,
    badgeLabel: left.badgeLabel,
    badgeTone: left.badgeTone,
    message: left.message,
    missingFields: left.missingFields,
    currentThreadId: left.status?.currentThreadId,
    bridgeReady: left.status?.bridgeReady,
    bridgeRunning: left.status?.bridgeRunning,
    installed: left.status?.installed,
    lastError: left.status?.lastError,
    installProbeError: left.status?.installProbeError,
  }) !== JSON.stringify({
    state: right.state,
    badgeLabel: right.badgeLabel,
    badgeTone: right.badgeTone,
    message: right.message,
    missingFields: right.missingFields,
    currentThreadId: right.status?.currentThreadId,
    bridgeReady: right.status?.bridgeReady,
    bridgeRunning: right.status?.bridgeRunning,
    installed: right.status?.installed,
    lastError: right.status?.lastError,
    installProbeError: right.status?.installProbeError,
  })
}

function emitIfChanged(previous, next) {
  if (!snapshotChanged(previous, next)) return
  _listeners.forEach(listener => {
    try {
      listener(next)
    } catch {
      // ignore listener failures
    }
  })
}

function stateMeta(state) {
  return {
    unsupported: { badgeLabel: '不可用', badgeTone: 'danger' },
    not_installed: { badgeLabel: '需要安装', badgeTone: 'warn' },
    needs_config: { badgeLabel: '需要配置', badgeTone: 'warn' },
    stopped: { badgeLabel: '未启动', badgeTone: '' },
    starting: { badgeLabel: '启动中', badgeTone: 'warn' },
    ready: { badgeLabel: '就绪', badgeTone: 'ok' },
    error: { badgeLabel: '出错', badgeTone: 'danger' },
  }[state] || { badgeLabel: '未知', badgeTone: '' }
}

export function createDefaultEvoscientistConfig() {
  return { ...BASE_CONFIG }
}

export function normalizeEvoscientistConfig(config = {}) {
  return {
    ...createDefaultEvoscientistConfig(),
    ...Object.fromEntries(
      Object.entries(config || {}).filter(([key]) => key in BASE_CONFIG)
    ),
  }
}

export function getEvoscientistProviderFields(provider) {
  return providerMeta(provider)?.fields || []
}

export function getRequiredEvoscientistProviderFields(provider) {
  return providerMeta(provider)?.requiredFields || []
}

export function getEvoscientistConfigIssues(config = {}) {
  const normalized = normalizeEvoscientistConfig(config)
  const missingFields = []

  if (!nonEmpty(normalized.provider)) missingFields.push('provider')
  if (!nonEmpty(normalized.model)) missingFields.push('model')

  for (const field of getRequiredEvoscientistProviderFields(normalized.provider)) {
    if (!nonEmpty(normalized[field])) missingFields.push(field)
  }

  return {
    config: normalized,
    missingFields,
    missingLabels: missingFields.map(field => EVOSCIENTIST_FIELD_LABELS[field] || field),
    complete: missingFields.length === 0,
  }
}

export function deriveEvoscientistReadiness(status = null) {
  const safeStatus = status || {}
  const { config, missingFields, missingLabels, complete } = getEvoscientistConfigIssues(safeStatus.config || {})
  const supported = safeStatus.supported !== false
  const installed = !!safeStatus.installed
  const running = !!safeStatus.bridgeRunning
  const ready = !!safeStatus.bridgeReady
  const lastError = String(safeStatus.lastError || '').trim()
  const installProbeError = String(safeStatus.installProbeError || '').trim()
  const errorText = lastError || installProbeError

  let state = 'stopped'
  if (!supported) {
    state = 'unsupported'
  } else if (!installed) {
    state = 'not_installed'
  } else if (!complete) {
    state = 'needs_config'
  } else if (ready) {
    state = 'ready'
  } else if (running) {
    state = 'starting'
  } else if (errorText) {
    state = 'error'
  } else {
    state = 'stopped'
  }

  const meta = stateMeta(state)
  let message = 'Prospect-Research 已停止，等待启动。'

  if (state === 'unsupported') {
    message = errorText || 'Prospect-Research 当前只支持 macOS。'
  } else if (state === 'not_installed') {
    message = installProbeError || '还没有检测到完整的 Prospect-Research 安装。'
  } else if (state === 'needs_config') {
    message = missingLabels.length
      ? `缺少必要配置：${missingLabels.join('、')}`
      : '需要先完成模型与 Provider 配置。'
  } else if (state === 'starting') {
    message = errorText || 'Bridge 正在启动，请稍候。'
  } else if (state === 'ready') {
    message = 'Bridge 已就绪，可以继续对话。'
  } else if (state === 'error') {
    message = errorText || 'Bridge 未就绪，请检查最近日志。'
  }

  return {
    state,
    badgeLabel: meta.badgeLabel,
    badgeTone: meta.badgeTone,
    message,
    missingFields,
    missingLabels,
    config,
    status: {
      ...safeStatus,
      config,
    },
    lastCheckedAt: new Date().toISOString(),
  }
}

export function applyEvoscientistStatus(status = null) {
  const next = deriveEvoscientistReadiness(status)
  const previous = _snapshot
  _snapshot = next
  emitIfChanged(previous, next)
  return next
}

export function getEvoscientistReadinessSnapshot() {
  return _snapshot
}

export function invalidateEvoscientistReadiness() {
  _snapshot = null
  _inflight = null
}

export function onEvoscientistReadinessChange(listener) {
  _listeners.push(listener)
  return () => {
    _listeners = _listeners.filter(item => item !== listener)
  }
}

export async function refreshEvoscientistReadiness({ force = false, quiet = true } = {}) {
  if (!force && _inflight) return _inflight
  const request = api.getEvoscientistStatus()
    .then(status => applyEvoscientistStatus(status))
    .catch(error => {
      const classified = classifyBackendError(error)
      if (!quiet) throw error
      return applyEvoscientistStatus({
        supported: true,
        installed: false,
        bridgeRunning: false,
        bridgeReady: false,
        lastError: classified.debugReason || String(error),
      })
    })
    .finally(() => {
      if (_inflight === request) _inflight = null
    })
  _inflight = request
  return request
}

export function startEvoscientistReadinessPoll() {
  if (_pollTimer) return
  _pollTimer = window.setInterval(() => {
    void refreshEvoscientistReadiness({ force: true, quiet: true })
  }, POLL_INTERVAL_MS)
}

export function stopEvoscientistReadinessPoll() {
  if (!_pollTimer) return
  window.clearInterval(_pollTimer)
  _pollTimer = null
}
