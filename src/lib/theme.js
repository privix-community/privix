/**
 * 主题管理 — Apple 风格双模式（light / dark）
 */
import { t, onLocaleChange } from './i18n.js'

const THEME_PRESET_KEY = 'privix-community-theme-preset'
const LEGACY_THEME_KEY = 'privix-community-theme'
const OLD_THEME_KEY = 'clawpanel-theme'
export const THEME_CHANGE_EVENT = 'privix-community:themechange'

const DEFAULT_THEME_PRESET = 'light'

/* 旧版主题 → 新双模式映射 */
const LEGACY_THEME_PRESET_MAP = {
  light: 'light',
  dark: 'dark',
  classic: 'light',
  midnight: 'dark',
  paper: 'light',
}

const THEME_OPTIONS = Object.freeze([
  {
    id: 'light',
    labelKey: 'theme.light_label',
    descriptionKey: 'theme.light_description',
    tone: 'light',
    swatches: ['#f5f5f7', '#5A72EE', '#1d1d1f'],
  },
  {
    id: 'dark',
    labelKey: 'theme.dark_label',
    descriptionKey: 'theme.dark_description',
    tone: 'dark',
    swatches: ['#000000', '#5A72EE', '#C7D9FF'],
  },
])

const THEME_IDS = new Set(THEME_OPTIONS.map(option => option.id))

// 解析后的选项按 locale 缓存(复用 sidebar/settings 高频读取),locale 切换时失效
let _resolvedByPreset = null

function resolvedByPreset() {
  if (!_resolvedByPreset) {
    _resolvedByPreset = new Map(
      THEME_OPTIONS.map(option => [
        option.id,
        { ...option, label: t(option.labelKey), description: t(option.descriptionKey) },
      ]),
    )
  }
  return _resolvedByPreset
}

onLocaleChange(() => { _resolvedByPreset = null })

export function getThemeOptions() {
  return [...resolvedByPreset().values()]
}

export function getThemeOption(themePreset = DEFAULT_THEME_PRESET) {
  const map = resolvedByPreset()
  return map.get(normalizeThemePreset(themePreset)) || map.get(DEFAULT_THEME_PRESET)
}

export function getActiveThemeOption() {
  return getThemeOption(getThemePreset())
}

export function initTheme() {
  const preset = readStoredThemePreset() || DEFAULT_THEME_PRESET
  applyThemePreset(preset, { persist: true, dispatch: false })
}

export function setThemePreset(themePreset) {
  return applyThemePreset(themePreset, { persist: true, dispatch: true })
}

export function getThemePreset() {
  const doc = getDocument()
  const active = normalizeThemePreset(doc?.documentElement?.dataset?.theme)
  if (active) return active
  return readStoredThemePreset() || DEFAULT_THEME_PRESET
}

export function getTheme() {
  const doc = getDocument()
  return doc?.documentElement?.dataset?.theme || getThemeOption(getThemePreset()).tone
}

export function toggleTheme() {
  const current = getThemePreset()
  const next = current === 'light' ? 'dark' : 'light'
  setThemePreset(next)
  return next
}

export function onThemeChange(listener) {
  const win = getWindow()
  if (!win || typeof win.addEventListener !== 'function') return () => {}
  const wrapped = (event) => listener?.(event?.detail || getActiveThemeOption())
  win.addEventListener(THEME_CHANGE_EVENT, wrapped)
  return () => win.removeEventListener(THEME_CHANGE_EVENT, wrapped)
}

function readStoredThemePreset() {
  const storage = getStorage()
  if (!storage) return null

  /* 尝试当前格式，若失败则走旧版迁移（同一 key 可能存有 classic/midnight/paper） */
  const raw = storage.getItem(THEME_PRESET_KEY)
  const savedPreset = normalizeThemePreset(raw) || normalizeLegacyTheme(raw)
  if (savedPreset) return savedPreset

  const legacyTheme = normalizeLegacyTheme(storage.getItem(LEGACY_THEME_KEY))
    || normalizeLegacyTheme(storage.getItem(OLD_THEME_KEY))
  if (!legacyTheme) return null

  storage.setItem(THEME_PRESET_KEY, legacyTheme)
  storage.removeItem(LEGACY_THEME_KEY)
  storage.removeItem(OLD_THEME_KEY)
  return legacyTheme
}

function applyThemePreset(themePreset, { persist = true, dispatch = true } = {}) {
  const option = getThemeOption(themePreset)
  const doc = getDocument()
  const root = doc?.documentElement
  if (!root) return option

  root.dataset.theme = option.id

  if (persist) {
    const storage = getStorage()
    storage?.setItem(THEME_PRESET_KEY, option.id)
    storage?.removeItem(LEGACY_THEME_KEY)
    storage?.removeItem(OLD_THEME_KEY)
  }

  if (dispatch) emitThemeChange(option)
  return option
}

function emitThemeChange(option) {
  const win = getWindow()
  if (!win || typeof win.dispatchEvent !== 'function') return
  const BaseEvent = typeof Event === 'function'
    ? Event
    : class {
      constructor(type) {
        this.type = type
      }
    }
  const EventCtor = typeof CustomEvent === 'function'
    ? CustomEvent
    : class extends BaseEvent {
      constructor(type, params = {}) {
        super(type, params)
        this.detail = params.detail
      }
    }
  win.dispatchEvent(new EventCtor(THEME_CHANGE_EVENT, { detail: { ...option, swatches: [...option.swatches] } }))
}

function normalizeThemePreset(value) {
  return THEME_IDS.has(value) ? value : null
}

function normalizeLegacyTheme(value) {
  if (!value) return null
  const key = String(value).trim().toLowerCase()
  return LEGACY_THEME_PRESET_MAP[key] || null
}

function getStorage() {
  try {
    return globalThis?.localStorage || null
  } catch {
    return null
  }
}

function getDocument() {
  return globalThis?.document || null
}

function getWindow() {
  return globalThis?.window || null
}

/* ============================================================
   用户自定义 CSS(v1.5 Agent Studio)
   读取 ~/.privix/user.css 注入到 <head>,覆盖 Apple Design 默认 token
   ============================================================ */
const USER_CSS_ENABLED_KEY = 'privix-community-user-css-enabled'
const USER_CSS_STYLE_ID = 'privix-user-css'

/** 用户自定义 CSS 默认启用(文件不存在时也没关系,不注入) */
export function isUserCssEnabled() {
  const raw = getStorage()?.getItem(USER_CSS_ENABLED_KEY)
  if (raw === null || raw === undefined) return true  // 默认启用
  return raw === '1' || raw === 'true'
}

export function setUserCssEnabled(enabled) {
  getStorage()?.setItem(USER_CSS_ENABLED_KEY, enabled ? '1' : '0')
  if (enabled) {
    reloadUserCss()
  } else {
    removeUserCssStyle()
  }
}

/** 移除已注入的 <style> */
function removeUserCssStyle() {
  const doc = getDocument()
  if (!doc) return
  const el = doc.getElementById(USER_CSS_STYLE_ID)
  if (el) el.remove()
}

/** 注入/刷新 user.css 内容到 <head> 末尾 */
function applyUserCssContent(css) {
  const doc = getDocument()
  if (!doc) return
  let el = doc.getElementById(USER_CSS_STYLE_ID)
  if (!el) {
    el = doc.createElement('style')
    el.id = USER_CSS_STYLE_ID
    el.setAttribute('data-source', 'privix-user-css')
    doc.head?.appendChild(el)
  }
  el.textContent = css || ''
}

/**
 * 从后端读取 user.css 并注入(若启用)
 * 失败时静默退出,不影响主题系统
 */
export async function reloadUserCss() {
  if (!isUserCssEnabled()) {
    removeUserCssStyle()
    return ''
  }
  try {
    // 动态 import 避免循环依赖(theme.js 在 tauri-api.js 之前加载时仍能工作)
    const { api } = await import('./tauri-api.js')
    const content = await api.readUserCss()
    applyUserCssContent(content || '')
    return content || ''
  } catch {
    // 读取失败(如 Web 模式无权限)— 不报错,仅不注入
    return ''
  }
}

/** 应用启动时调用,注入已有 user.css(如启用) */
export function initUserCss() {
  // 非阻塞:后台读取,不等待
  reloadUserCss().catch(() => {})
}

/* ── UI 缩放 ── */
const SCALE_KEY = 'privix-community-ui-scale'

export function initScale() {
  applyScale(getScale())
}

export function setScale(v) {
  const clamped = Math.min(1.25, Math.max(0.85, parseFloat(v) || 1))
  getStorage()?.setItem(SCALE_KEY, clamped)
  applyScale(clamped)
}

export function getScale() {
  return parseFloat(getStorage()?.getItem(SCALE_KEY)) || 1
}

function applyScale(v) {
  getDocument()?.documentElement?.style?.setProperty('--ui-scale', v)
}
