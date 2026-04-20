/**
 * 社区版 Profile 系统
 * 单一 profile: privix-community. 无模块解锁/授权码概念,所有路由默认可用。
 */

const UNIFIED_ID = 'privix-community'

export const PRODUCT_PROFILE_IDS = Object.freeze({
  COMMUNITY: UNIFIED_ID,
})

export const MODULE_IDS = Object.freeze({
  BASE: 'base',
})

const MODULE_ROUTES = {
  [MODULE_IDS.BASE]: [
    '/about',
    '/overview',
    '/agents',
    '/assistant',
    '/channels',
    '/chat',
    '/chat-debug',
    '/communication',
    '/cron',
    '/dashboard',
    '/diagnose',
    '/dreaming',
    '/gateway',
    '/logs',
    '/mcp',
    '/memory',
    '/models',
    '/plugin-hub',
    '/route-map',
    '/security',
    '/services',
    '/settings',
    '/setup',
    '/quick-setup',
    '/research',
    '/skills',
    '/usage',
    '/h/setup',
    '/h/dashboard',
    '/h/chat',
    '/h/services',
    '/h/config',
    '/h/channels',
    '/h/cron',
    '/h/skills',
  ],
}

export const MODULE_META = Object.freeze({
  [MODULE_IDS.BASE]: { label: '基础功能', description: '始终可用', alwaysEnabled: true },
})

const ALL_ROUTES = Object.values(MODULE_ROUTES).flat()

// ─── 模块启用状态(社区版 BASE 永远启用) ───
let _enabledModules = ['base']
const _listeners = []

export function setEnabledModules(modules) {
  const list = Array.isArray(modules) ? [...modules] : ['base']
  if (!list.includes('base')) list.unshift('base')
  if (list.length === _enabledModules.length && list.every((m, i) => m === _enabledModules[i])) return
  _enabledModules = list
  _listeners.forEach(fn => fn(list))
}

export function getEnabledModules() {
  return [..._enabledModules]
}

export function onEnabledModulesChange(fn) {
  _listeners.push(fn)
  return () => {
    const idx = _listeners.indexOf(fn)
    if (idx >= 0) _listeners.splice(idx, 1)
  }
}

export function isModuleEnabled(moduleId) {
  if (moduleId === MODULE_IDS.BASE) return true
  return _enabledModules.includes(moduleId)
}

export function getRouteModules(route) {
  const r = String(route || '').trim() || '/'
  const modules = []
  for (const [moduleId, routes] of Object.entries(MODULE_ROUTES)) {
    if (routes.includes(r)) modules.push(moduleId)
  }
  return modules
}

export function getRouteModule(route) {
  const modules = getRouteModules(route)
  return modules.length > 0 ? modules[0] : null
}

export function isRouteModuleEnabled(route) {
  const modules = getRouteModules(route)
  if (modules.length === 0) return false
  return modules.some(m => isModuleEnabled(m))
}

// ─── 社区版 Profile 定义 ───
const UNIFIED_PROFILE = {
  id: UNIFIED_ID,
  productName: 'Privix Community',
  releaseLabel: 'Privix Community',
  homeRoute: '/overview',
  assistantPreset: 'default',
  allowedRoutes: ALL_ROUTES,
  requiresOpenclawSetup: true,
  allowedCapabilities: [
    'assistant', 'settings', 'security', 'about',
    'platform_dashboard', 'chat', 'services', 'logs', 'models', 'agents',
    'gateway', 'channels', 'communication', 'memory', 'cron', 'usage', 'skills',
    'system_diagnostics',
  ],
  runtimeToggleWhitelist: [],
  brand: {
    ownerName: 'Privix Community',
    ownerNameEn: 'Privix Community',
    logoMode: 'neutral',
    logoSrc: '/images/privix-mark.svg',
    logoAlt: 'Privix Community',
    title: 'Privix Community',
    subtitle: 'Open-source AI Agent Workbench',
    shellLabel: 'Privix Community',
    aboutSubtitleHtml: 'Privix Community · Apache-2.0 开源版',
    setupTagline: 'Privix Community',
    showCompanyProfile: false,
    companyWebsite: '',
    companyEmail: '',
    companyPhone: '',
    companyAddress: '',
    companyTagline: '本地运行的 AI Agent 工作台 · 数据本地存储 · 直连模型 Provider',
    companyIntro: [],
    neutralDescription: '本地运行的 AI Agent 桌面工作台。集成 Claw Doctor、OpenClaw、Hermes 等能力。会话与配置保存在本机，模型调用从本地直连用户配置的 Provider。',
    assistantIdentity: 'Privix Community 内置的智能助手',
    injectPevcKnowledgeBase: false,
  },
  legal: {
    author: 'Privix Community Contributors',
    copyrightOwner: 'Privix Community Contributors',
    aboutNotice: 'Privix Community 采用 Apache-2.0 协议开源;源自上游 ClawPanel 的对应代码保留原 MIT 许可声明。',
    commercialNotice: '',
    mitNotice: '保留上游 ClawPanel MIT License 信息。',
  },
  bundle: {
    identifier: 'io.privix.community',
    author: 'Privix Community Contributors',
    cargoAuthors: ['Privix Community Contributors'],
    windowTitle: 'Privix Community',
  },
}

export const PRODUCT_PROFILES = Object.freeze({
  [PRODUCT_PROFILE_IDS.COMMUNITY]: UNIFIED_PROFILE,
})

export function normalizeProductProfileId(_value) {
  return UNIFIED_ID
}

export const ACTIVE_PRODUCT_PROFILE_ID = UNIFIED_ID
export const ACTIVE_PRODUCT_PROFILE = UNIFIED_PROFILE

export function getDefaultProductProfileId() {
  return UNIFIED_ID
}

export function getProductProfile(_profileId) {
  return UNIFIED_PROFILE
}

export function getActiveProductProfileId() {
  return ACTIVE_PRODUCT_PROFILE_ID
}

export function getActiveProductProfile() {
  return ACTIVE_PRODUCT_PROFILE
}

export function getAllowedRoutes(_profileId) {
  return [...ALL_ROUTES]
}

export function isRouteAllowed(route, _profileId) {
  return ALL_ROUTES.includes(String(route || '').trim() || '/')
}

export function getProfileHomeRoute(_profileId) {
  return UNIFIED_PROFILE.homeRoute
}

export function getProfileScopedRuntimeDir(_profileId) {
  return '~/.openclaw/privix-community'
}

export function getProfileScopedPanelConfigPath(_profileId) {
  return `${getProfileScopedRuntimeDir()}/clawpanel.json`
}

export function getProfileScopedProfileConfig(_profileId) {
  return {
    baseProfileId: UNIFIED_ID,
    profileVersion: 2,
    enabledCapabilities: [...UNIFIED_PROFILE.allowedCapabilities],
  }
}

export function isInvestWorkbenchProfile(_profileId) {
  return false
}

export function requiresOpenclawSetup(_profileId) {
  return true
}

export function supportsPevcKnowledgeBase(_profileId) {
  return false
}

export function getProductProfileBundleMeta(_profileId) {
  return { ...UNIFIED_PROFILE.bundle }
}
