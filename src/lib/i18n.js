/**
 * 轻量 i18n 模块 — 零依赖，支持嵌套 key、插值、复数和 RTL
 *
 * 用法:
 *   import { t, tc, setLocale, getLocale, onLocaleChange } from '../lib/i18n.js'
 *   t('sidebar.dashboard')                    // 简单翻译
 *   t('toast.synced', { name: 'Agent-1' })    // 带插值
 *   tc('common.items', 3)                     // 复数
 */

// ── 支持的语言列表 ──────────────────────────────────────
export const SUPPORTED_LOCALES = [
  { code: 'zh-CN', label: '简体中文', nativeLabel: '简体中文' },
  { code: 'en',    label: 'English',  nativeLabel: 'English' },
  { code: 'zh-TW', label: '繁體中文', nativeLabel: '繁體中文' },
  { code: 'ja',    label: '日本語',   nativeLabel: '日本語' },
  { code: 'ko',    label: '한국어',   nativeLabel: '한국어' },
  { code: 'es',    label: 'Español',  nativeLabel: 'Español' },
  { code: 'fr',    label: 'Français', nativeLabel: 'Français' },
  { code: 'de',    label: 'Deutsch',  nativeLabel: 'Deutsch' },
  { code: 'pt-BR', label: 'Português (Brasil)', nativeLabel: 'Português (Brasil)' },
  { code: 'ar',    label: 'العربية',  nativeLabel: 'العربية' },
  { code: 'ru',    label: 'Русский',  nativeLabel: 'Русский' },
  { code: 'id',    label: 'Bahasa Indonesia', nativeLabel: 'Bahasa Indonesia' },
  { code: 'th',    label: 'ไทย',       nativeLabel: 'ไทย' },
  { code: 'vi',    label: 'Tiếng Việt', nativeLabel: 'Tiếng Việt' },
  { code: 'ms',    label: 'Bahasa Melayu', nativeLabel: 'Bahasa Melayu' },
]

const RTL_LOCALES = new Set(['ar'])
const STORAGE_KEY = 'privix-community-locale'
const DEFAULT_LOCALE = 'zh-CN'

// ── 内部状态 ──────────────────────────────────────
let _locale = DEFAULT_LOCALE
let _messages = {}        // 当前语言的翻译
let _fallback = {}        // zh-CN 基准（fallback）
const _listeners = new Set()

// ── 翻译 JSON 懒加载映射 ──────────────────────────────────────
// zh-CN 静态导入（零延迟），其他语言动态 import
const _loaders = {
  'zh-CN': () => import('../i18n/zh-CN.json'),
  'en':    () => import('../i18n/en.json'),
  'zh-TW': () => import('../i18n/zh-TW.json'),
  'ja':    () => import('../i18n/ja.json'),
  'ko':    () => import('../i18n/ko.json'),
  'es':    () => import('../i18n/es.json'),
  'fr':    () => import('../i18n/fr.json'),
  'de':    () => import('../i18n/de.json'),
  'pt-BR': () => import('../i18n/pt-BR.json'),
  'ar':    () => import('../i18n/ar.json'),
  'ru':    () => import('../i18n/ru.json'),
  'id':    () => import('../i18n/id.json'),
  'th':    () => import('../i18n/th.json'),
  'vi':    () => import('../i18n/vi.json'),
  'ms':    () => import('../i18n/ms.json'),
}

// ── 初始化 ──────────────────────────────────────

/**
 * 初始化 i18n，加载用户偏好的语言
 * 应在 app 启动时调用一次（main.js）
 */
export async function initI18n() {
  // 加载 fallback（zh-CN 始终可用）
  try {
    const mod = await _loaders[DEFAULT_LOCALE]()
    _fallback = mod.default || mod
  } catch { _fallback = {} }

  // 读取用户偏好
  const saved = localStorage.getItem(STORAGE_KEY)
  const preferred = saved && _loaders[saved] ? saved : detectBrowserLocale()
  await _applyLocale(preferred, false) // 首次加载不触发 listener
}

/**
 * 根据浏览器语言自动检测最接近的支持语言
 */
function detectBrowserLocale() {
  const langs = navigator.languages || [navigator.language || '']
  for (const lang of langs) {
    const normalized = lang.trim()
    // 精确匹配
    if (_loaders[normalized]) return normalized
    // 前缀匹配：zh-Hans → zh-CN, pt → pt-BR
    const prefix = normalized.split('-')[0]
    if (prefix === 'zh') return normalized.includes('TW') || normalized.includes('Hant') ? 'zh-TW' : 'zh-CN'
    if (prefix === 'pt') return 'pt-BR'
    const match = SUPPORTED_LOCALES.find(l => l.code.startsWith(prefix))
    if (match) return match.code
  }
  return DEFAULT_LOCALE
}

// ── 核心 API ──────────────────────────────────────

/**
 * 获取当前语言代码
 */
export function getLocale() {
  return _locale
}

/**
 * 切换语言，加载翻译文件并通知所有订阅者
 */
export async function setLocale(locale) {
  if (!_loaders[locale]) return
  await _applyLocale(locale, true)
}

/**
 * 翻译：t('pages.dashboard.title') 或 t('toast.err', { error: '...' })
 */
export function t(key, params) {
  const value = _resolve(_messages, key) ?? _resolve(_fallback, key)
  if (value == null) {
    if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
      console.warn(`[i18n] 缺失 key: "${key}"`)
    }
    return key
  }
  return _interpolate(String(value), params)
}

/**
 * 复数翻译：tc('common.items', 3) → '3 个项目' / '3 items'
 *
 * JSON 中用 _zero / _one / _two / _few / _many / _other 后缀：
 *   "items_one": "{count} item",
 *   "items_other": "{count} items"
 */
export function tc(key, count, params) {
  const rule = _pluralRules.select(count)
  // 尝试精确后缀，回退到 _other
  const resolved = t(`${key}_${rule}`, { count, ...params })
  if (resolved !== `${key}_${rule}`) return resolved
  const fallback = t(`${key}_other`, { count, ...params })
  if (fallback !== `${key}_other`) return fallback
  return t(key, { count, ...params })
}

/**
 * 订阅语言切换事件，返回取消函数
 */
export function onLocaleChange(fn) {
  _listeners.add(fn)
  return () => _listeners.delete(fn)
}

/**
 * 判断当前是否为 RTL 语言
 */
export function isRTL() {
  return RTL_LOCALES.has(_locale)
}

// ── 内部工具 ──────────────────────────────────────

let _pluralRules = new Intl.PluralRules(_locale)

async function _applyLocale(locale, notify) {
  try {
    if (locale !== DEFAULT_LOCALE) {
      const mod = await _loaders[locale]()
      _messages = mod.default || mod
    } else {
      _messages = _fallback
    }
  } catch {
    // 加载失败回退 zh-CN
    _messages = _fallback
    locale = DEFAULT_LOCALE
  }

  _locale = locale
  _pluralRules = new Intl.PluralRules(locale)

  // 持久化
  localStorage.setItem(STORAGE_KEY, locale)

  // RTL
  document.documentElement.dir = RTL_LOCALES.has(locale) ? 'rtl' : 'ltr'
  document.documentElement.lang = locale

  // 通知订阅者
  if (notify) {
    for (const fn of _listeners) {
      try { fn(locale) } catch {}
    }
  }
}

/** 用 . 分隔 key 走对象树查找 */
function _resolve(obj, key) {
  if (!obj || !key) return undefined
  const parts = key.split('.')
  let current = obj
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined
    current = current[part]
  }
  return typeof current === 'string' ? current : undefined
}

/** 替换 {name} 占位符 */
function _interpolate(str, params) {
  if (!params) return str
  return str.replace(/\{(\w+)\}/g, (_, key) => {
    const val = params[key]
    return val != null ? String(val) : `{${key}}`
  })
}
