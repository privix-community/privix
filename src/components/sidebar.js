/**
 * 侧边导航栏
 */
import { buildRouteHash, navigate, getCurrentRouteState, reloadCurrentRoute, syncSidebarState } from '../router.js'
import { getThemeOption, getThemeOptions, getThemePreset, onThemeChange, setThemePreset } from '../lib/theme.js'
import { isOpenclawReady, getActiveInstance, switchInstance, onInstanceChange } from '../lib/app-state.js'
import { api } from '../lib/tauri-api.js'
import { toast } from './toast.js'
import { BRAND_LOGO_ALT, BRAND_LOGO_SRC, BRAND_NAME, BRAND_SUBTITLE } from '../lib/brand.js'
import { version as APP_VERSION } from '../../package.json'
import { getActiveProductProfileId, requiresOpenclawSetup, isRouteAllowed } from '../lib/product-profile.js'
import { isFeatureAvailable } from '../lib/feature-gates.js'
import { t } from '../lib/i18n.js'
import { listEngines, getActiveEngine, getActiveEngineId, getEngine, switchEngine, onEngineChange, ENGINE_IDS } from '../lib/engine-manager.js'
import { getRouteRequiredEngine } from '../lib/engine-route-policy.js'
import { renderWorkspaceSwitcher, bindWorkspaceSwitcher } from './workspace-switcher.js'

function getClawOverviewItems() {
  return [
    { route: '/dashboard', label: t('sidebar.dashboard'), icon: 'dashboard' },
    { route: '/chat', label: t('sidebar.chat'), icon: 'chat' },
    { route: '/models', label: t('sidebar.models'), icon: 'models' },
    { route: '/agents', label: t('sidebar.agents'), icon: 'agents' },
    { route: '/memory', label: t('sidebar.memory'), icon: 'memory' },
    { route: '/mcp', label: t('sidebar.mcp'), icon: 'mcp' },
    { route: '/channels', label: t('sidebar.channels'), icon: 'channels' },
  ]
}

function getSystemSettingsItems() {
  return [
    { route: '/services', label: t('sidebar.services'), icon: 'services' },
    { route: '/route-map', label: t('sidebar.route_map'), icon: 'route-map' },
    { route: '/logs', label: t('sidebar.logs'), icon: 'logs' },
    { route: '/gateway', label: t('sidebar.gateway'), icon: 'gateway' },
    { route: '/communication', label: t('sidebar.communication'), icon: 'settings' },
    { route: '/security', label: t('sidebar.security'), icon: 'security' },
    { route: '/skills', label: t('sidebar.skills'), icon: 'skills' },
    { route: '/plugin-hub', label: t('sidebar.plugin_hub'), icon: 'extensions' },
    { route: '/dreaming', label: t('sidebar.dreaming'), icon: 'dreaming', gate: 'dreaming' },
    { route: '/cron', label: t('sidebar.cron'), icon: 'clock' },
    { route: '/usage', label: t('sidebar.usage'), icon: 'bar-chart' },
    { route: '/settings', label: t('sidebar.settings'), icon: 'settings' },
    { route: '/diagnose', label: t('sidebar.diagnose'), icon: 'diagnose' },
    { route: '/chat-debug', label: t('sidebar.chat_debug'), icon: 'debug', hiddenInProduction: true },
    { route: '/about', label: t('sidebar.about'), icon: 'about' },
  ]
}

function getNavRouteSwitch(route, engineMode = getActiveEngineId()) {
  return getRouteRequiredEngine(engineMode, route)
}

const ICONS = {
  overview: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>',
  setup: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>',
  dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>',
  services: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>',
  logs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
  models: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/></svg>',
  agents: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>',
  gateway: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>',
  memory: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg>',
  mcp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2v6"/><path d="M15 2v6"/><path d="M6 8h12v5a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5V8z"/><path d="M12 18v4"/><path d="M10 22h4"/></svg>',
  extensions: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>',
  about: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  assistant: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
  security: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>',
  skills: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>',
  channels: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  'bar-chart': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>',
  debug: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/><circle cx="12" cy="12" r="3"/></svg>',
  dreaming: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 109.8 9.8z"/><path d="M17 4l.8 1.7L19.5 6.5l-1.7.8L17 9l-.8-1.7-1.7-.8 1.7-.8L17 4z"/></svg>',
  'route-map': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="18" r="2"/><path d="M7 6h10M7 18h10M5 8v8M19 8v8"/></svg>',
  diagnose: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
  // PE/VC 投资管理图标
  pipeline: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3h18v4H3zM3 10h12v4H3zM3 17h6v4H3z"/></svg>',
  pool: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 12h8M12 8v8"/></svg>',
  companies: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h18M5 21V7l8-4v18M13 21V3l6 4v14"/><path d="M9 9h1M9 13h1M9 17h1M15 9h1M15 13h1"/></svg>',
  'contacts-icon': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>',
  'invest-docs': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>',
  sop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>',
  'invest-chart': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>',
  scoring: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  workflow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>',
  audit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  automation: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  knowledge: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/><path d="M8 7h8M8 11h6"/></svg>',
  swarm: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="6" r="3"/><circle cx="5" cy="17" r="3"/><circle cx="19" cy="17" r="3"/><path d="M12 9v2.5M8.5 14.5l-2 1.5M15.5 14.5l2 1.5"/></svg>',
  'star-office': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/><circle cx="16" cy="15" r="2"/></svg>',
}

// 新增主线图标（Phase B 9 主线需要的额外图标）
ICONS['hermes'] = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>'
ICONS['openclaw'] = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>'
ICONS['magic-wand'] = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 4V2M15 16v-2M8 9H6M22 9h-2M17.8 11.8L19 13M15 9h0M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5"/></svg>'
ICONS['industry'] = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h18M5 21V9l7 4V9l7 4v8M9 9V5"/></svg>'
ICONS['research'] = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>'

let _delegated = false
let _hasMultipleInstances = false
let _themeMenuOpen = false
let _zoneMigrated = false

/** 防止 fixed 定位元素超出视口（下方溢出时上移，上方溢出时下移） */
function _clampToViewport(el, margin = 8) {
  requestAnimationFrame(() => {
    const rect = el.getBoundingClientRect()
    if (rect.bottom > window.innerHeight - margin) {
      el.style.top = Math.max(margin, window.innerHeight - rect.height - margin) + 'px'
    }
    if (rect.top < margin) {
      el.style.top = margin + 'px'
    }
  })
}


function _positionInstanceDropdown() {
  const dd = document.getElementById('instance-dropdown')
  const trigger = document.getElementById('instance-switcher')
  if (!dd || !trigger) return
  const rect = trigger.getBoundingClientRect()
  dd.style.left = (rect.left + 12) + 'px'
  dd.style.width = (rect.width - 24) + 'px'
  dd.style.top = (rect.bottom - 4) + 'px'
  _clampToViewport(dd)
}

function _positionThemeMenu() {
  const menu = document.getElementById('sidebar-theme-menu')
  const trigger = document.getElementById('btn-theme-menu')
  if (!menu || !trigger) return
  const rect = trigger.getBoundingClientRect()
  const sidebar = document.getElementById('sidebar')
  const sidebarRect = sidebar?.getBoundingClientRect()
  if (!sidebarRect) return
  menu.style.left = (sidebarRect.left + 12) + 'px'
  menu.style.width = (sidebarRect.width - 24) + 'px'
  requestAnimationFrame(() => {
    const menuRect = menu.getBoundingClientRect()
    menu.style.top = Math.max(8, rect.top - menuRect.height + 4) + 'px'
  })
}
const ACTIVE_PRODUCT_PROFILE_ID = getActiveProductProfileId()
const REQUIRE_OPENCLAW_READY = requiresOpenclawSetup(ACTIVE_PRODUCT_PROFILE_ID)

// 社区版主线:引擎折叠组 + 钳子医生 + 一键配置 + 系统设置
function getNavPillars(engineMode = ENGINE_IDS.OPENCLAW) {
  const isHermes = engineMode === ENGINE_IDS.HERMES

  const engineFolder = isHermes
    ? {
        id: 'hermes',
        label: 'Hermes',
        icon: 'hermes',
        collapsible: true,
        children: (getEngine(ENGINE_IDS.HERMES)?.getNavItems?.() || []).flatMap(s => s.items || []),
      }
    : {
        id: 'openclaw',
        label: t('sidebar.pillar_openclaw') || 'OpenClaw',
        icon: 'openclaw',
        collapsible: true,
        children: getClawOverviewItems(),
      }

  const hermesEngine = isHermes ? getEngine(ENGINE_IDS.HERMES) : null
  const quickSetupRoute = isHermes && !hermesEngine?.isReady()
    ? (hermesEngine?.getSetupRoute() || '/h/setup')
    : (isRouteAllowed('/quick-setup') ? '/quick-setup' : '/setup')

  return [
    engineFolder,
    { id: 'claw-assistant', label: t('sidebar.assistant') || '钳子医生', icon: 'assistant',
      route: '/assistant', collapsible: false },
    { id: 'research', label: t('sidebar.pillar_research') || 'ProspectResearch', icon: 'research',
      route: '/research', collapsible: false },
    { id: 'quick-setup', label: t('sidebar.pillar_quick_setup') || '一键配置', icon: 'magic-wand',
      route: quickSetupRoute, collapsible: false },
    { id: 'system', label: t('sidebar.pillar_system') || '系统设置', icon: 'settings',
      collapsible: true, children: getSystemSettingsItems() },
  ].filter(Boolean)
}

/** 在 nav 区显示切换占位(避免看到旧主线抖动到新主线) */
function _renderNavSwitchingPlaceholder(sidebarEl) {
  const navEl = sidebarEl?.querySelector('.sidebar-nav')
  if (navEl) navEl.innerHTML = `<div class="sidebar-switching-placeholder">${t('sidebar.switching_engine') || '切换引擎中...'}</div>`
}

/** 统一的引擎切换 + 导航。同引擎直接 navigate;跨引擎显示 loading 后切换 + 导航。
 *  onEngineChange 已注册 renderSidebar listener,无需显式重绘。
 *  @param {HTMLElement} sidebarEl
 *  @param {string} engineId
 *  @param {{ route?: string }} opts  route 省略 → 引擎就绪走默认路由,否则走 setup
 */
function _switchEngineAndNavigate(sidebarEl, engineId, { route } = {}) {
  const resolveRoute = () => {
    if (route) return route
    const engine = getEngine(engineId) || getActiveEngine()
    return engine?.isReady() ? engine.getDefaultRoute() : (engine?.getSetupRoute() || '/setup')
  }
  if (getActiveEngineId() === engineId) { navigate(resolveRoute()); return }
  _renderNavSwitchingPlaceholder(sidebarEl)
  switchEngine(engineId)
    .then(() => navigate(resolveRoute()))
    .catch(err => {
      // 上游 v0.13.3:切换失败兜底,toast + 重渲染 sidebar + 恢复内容,避免侧栏卡 placeholder
      console.error('[sidebar] 切换引擎失败:', err)
      toast(t('pages.engine.switchFailed'), 'error')
      renderSidebar(sidebarEl)
      reloadCurrentRoute()
    })
}

/** Setup Shell 模式导航:当前引擎未就绪时使用,引导用户完成安装
 *  setup route 由当前活跃引擎决定(OpenClaw: /setup,Hermes: /h/setup) */
function getUnifiedSetupNavItems() {
  const engine = getActiveEngine()
  const setupRoute = engine?.getSetupRoute() || '/setup'
  const isHermesSetup = getActiveEngineId() === ENGINE_IDS.HERMES
  return [
    {
      section: '',
      items: [
        { route: setupRoute, label: t('sidebar.setup'), icon: 'setup' },
        { route: '/assistant', label: t('sidebar.assistant'), icon: 'assistant' },
      ]
    },
    {
      section: '',
      items: [
        { route: '/settings', label: t('sidebar.settings'), icon: 'settings' },
        ...(!isHermesSetup ? [{ route: '/chat-debug', label: t('sidebar.chat_debug'), icon: 'debug' }] : []),
        { route: '/about', label: t('sidebar.about'), icon: 'about' },
      ]
    }
  ]
}

function getNavItemHash(item) {
  return buildRouteHash(item.route, item.query)
}

function isNavItemActive(item, currentState) {
  const currentHash = buildRouteHash(currentState.path, currentState.query)
  const isDefaultEvo = item.isDefault && item.route === currentState.path && (!currentState.query || !Object.keys(currentState.query).length)
  return getNavItemHash(item) === currentHash || isDefaultEvo
}

// 异步检测是否有多实例（首次渲染后触发，有多实例时重渲染）
function _checkMultiInstances(el) {
  api.instanceList().then(data => {
    const has = data.instances && data.instances.length > 1
    if (has !== _hasMultipleInstances) {
      _hasMultipleInstances = has
      renderSidebar(el)
    }
  }).catch(() => {})
}

/** 引擎切换(segmented 滑块,仅多引擎时显示) */
function _renderEngineSwitcher() {
  const engines = listEngines()
  if (engines.length <= 1) return ''
  const activeId = getActiveEngineId()
  const segs = engines.map(e => {
    const active = e.id === activeId ? ' engine-seg-active' : ''
    return `<button type="button" class="engine-seg${active}" data-engine-id="${e.id}" title="${_escSidebar(e.name)}">
      <span class="engine-seg-icon">${e.icon}</span>
      <span class="engine-seg-label">${_escSidebar(e.name)}</span>
    </button>`
  }).join('')
  // data-engine-active 指示 indicator 位置(CSS 根据属性滑动)
  return `<div class="engine-switcher engine-segmented" id="engine-switcher" data-engine-active="${activeId}">
    <div class="engine-seg-indicator" aria-hidden="true"></div>
    ${segs}
  </div>`
}

export function renderSidebar(el) {
  const currentState = getCurrentRouteState()
  const current = currentState.path
  const isHermesMode = getActiveEngineId() === ENGINE_IDS.HERMES
  const navPillars = getNavPillars(isHermesMode ? ENGINE_IDS.HERMES : ENGINE_IDS.OPENCLAW)
  const setupNavItems = getUnifiedSetupNavItems()
  // Setup shell:任一引擎未就绪都应进入引导(防止切换后绕过)
  const activeEngineForSetup = getActiveEngine()
  const showSetupShell = REQUIRE_OPENCLAW_READY && (
    isHermesMode
      ? !(activeEngineForSetup?.isReady?.())
      : !isOpenclawReady()
  )
  const themeOptions = getThemeOptions()
  const activeTheme = getThemeOption(getThemePreset())

  const inst = getActiveInstance()
  const isLocal = inst.type === 'local'
  const showSwitcher = !isLocal || _hasMultipleInstances

  // 迁移旧的系统区折叠 key（仅执行一次）
  if (!_zoneMigrated) {
    _zoneMigrated = true
    if (localStorage.getItem('privix-community-sys-collapsed') !== null) {
      const oldVal = localStorage.getItem('privix-community-sys-collapsed')
      localStorage.setItem('privix-community-zone-system-collapsed', oldVal)
      localStorage.removeItem('privix-community-sys-collapsed')
    }
    // Phase B 迁移:移除已废弃的 nav-mode 存储(flyout 已删除)
    try { localStorage.removeItem('privix-community-nav-mode') } catch {}
  }

  let html = `
    <div class="sidebar-header">
      <div class="sidebar-brand-shell">
        <div class="sidebar-logo">
          <img src="${BRAND_LOGO_SRC}" alt="${BRAND_LOGO_ALT}" style="width:var(--sidebar-logo-size);height:var(--sidebar-logo-size);border-radius:var(--radius-lg);object-fit:contain">
        </div>
        <div class="sidebar-brand">
          <span class="sidebar-title">${BRAND_NAME}</span>
          <span class="sidebar-subtitle">${BRAND_SUBTITLE}</span>
        </div>
      </div>
      <button class="sidebar-close-btn" id="btn-sidebar-close" title="关闭菜单">&times;</button>
    </div>
    ${renderWorkspaceSwitcher()}
    ${showSwitcher ? `<div class="instance-switcher" id="instance-switcher">
      <button class="instance-current" id="btn-instance-toggle">
        <span class="instance-dot ${isLocal ? 'local' : 'remote'}"></span>
        <span class="instance-label">${_escSidebar(inst.name)}</span>
        <svg class="instance-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M6 9l6 6 6-6"/></svg>
      </button>
      <div class="instance-dropdown" id="instance-dropdown"></div>
    </div>` : ''}
    ${_renderEngineSwitcher()}
    <nav class="sidebar-nav">
  `

  // Setup Shell 模式(OpenClaw 未就绪时)- 走独立的简化导航
  if (showSetupShell) {
    for (const section of setupNavItems) {
      html += `<div class="nav-section">
        ${section.section ? `<div class="nav-section-title">${section.section}</div>` : ''}`
      for (const item of section.items.filter(item => isRouteAllowed(item.route) && (!item.gate || isFeatureAvailable(item.gate)))) {
        const active = isNavItemActive(item, currentState) ? ' active' : ''
        const navHash = getNavItemHash(item)
        const itemBadge = ''
        html += `<div class="nav-item${active}" data-route="${item.route}" data-nav-hash="${navHash}" ${item.isDefault ? 'data-nav-default="1"' : ''}>
          <span class="nav-item-icon">${ICONS[item.icon] || ''}</span>
          <span class="nav-item-label">${item.label}${itemBadge}</span>
        </div>`
      }
      html += '</div>'
    }
  } else {
    // 全局概览入口(位于所有主线之前)
    if (!isHermesMode && isRouteAllowed('/overview')) {
      const overviewActive = currentState.path === '/overview' ? ' active' : ''
      html += `<div class="nav-overview-item">
        <div class="nav-item${overviewActive}" data-route="/overview" data-nav-hash="/overview">
          <span class="nav-item-icon">${ICONS.overview}</span>
          <span class="nav-item-label">${t('sidebar.global_overview')}</span>
        </div>
      </div>
      <div class="nav-zone-divider"></div>`
    }

    // === 9 主线导航(或 Hermes 极简模式) ===
    let renderedPillarCount = 0
    for (let pi = 0; pi < navPillars.length; pi++) {
      const pillar = navPillars[pi]
      if (!pillar) continue

      const isHermesPillar = pillar.id === 'hermes' && !isHermesMode
      const isLeafPillar = !pillar.children && pillar.route

      // 过滤子项(路由许可 / feature gate)
      const visibleChildren = (pillar.children || []).filter(item => {
        if (!isRouteAllowed(item.route)) return false
        if (item.gate && !isFeatureAvailable(item.gate)) return false
        if (item.hiddenInProduction && !import.meta.env.DEV) return false
        return true
      })

      // 叶子主线:当前路由不允许则不渲染
      if (isLeafPillar && !isHermesPillar && !isRouteAllowed(pillar.route)) continue
      // 折叠组主线:无可见子项则不渲染
      if (pillar.children && !visibleChildren.length) continue

      // 主线间分隔线
      if (renderedPillarCount > 0) html += '<div class="nav-zone-divider"></div>'
      renderedPillarCount++

      const pillarHasActive = isLeafPillar
        ? current === pillar.route || (current || '').startsWith(pillar.route + '/') || (current || '').startsWith(pillar.route + '?')
        : visibleChildren.some(item => isNavItemActive(item, currentState))

      // 叶子主线:直接渲染为单个导航项
      if (isLeafPillar && !pillar.children) {
        const active = pillarHasActive ? ' active' : ''
        let extraAttr = isHermesPillar ? ' data-engine-switch="hermes"' : ''
        const leafRequiredEngine = pillar.requiresEngineSwitch || getNavRouteSwitch(pillar.route, isHermesMode ? ENGINE_IDS.HERMES : ENGINE_IDS.OPENCLAW)
        if (leafRequiredEngine) extraAttr += ` data-requires-engine-switch="${leafRequiredEngine}"`
        const itemBadge = ''
        html += `<div class="nav-pillar-${pillar.id}">
          <div class="nav-item${active}" data-route="${pillar.route}" data-nav-hash="${pillar.route}"${extraAttr}>
            <span class="nav-item-icon">${ICONS[pillar.icon] || ''}</span>
            <span class="nav-item-label">${_escSidebar(pillar.label)}${itemBadge}</span>
          </div>
        </div>`
        continue
      }

      // Hermes 主线(OpenClaw 模式下):单击切换引擎,非路由
      if (isHermesPillar) {
        html += `<div class="nav-pillar-hermes">
          <div class="nav-item" data-engine-switch="hermes">
            <span class="nav-item-icon">${ICONS['hermes'] || ''}</span>
            <span class="nav-item-label">${_escSidebar(pillar.label)}</span>
          </div>
        </div>`
        continue
      }

      // 折叠组主线:顶部 toggle 按钮 + 子项列表
      // 默认折叠(除非用户显式展开过,即 localStorage === '0');当前路由激活的主线自动展开
      const stored = localStorage.getItem(`privix-community-pillar-${pillar.id}-collapsed`)
      const collapsedPref = pillar.collapsible && stored !== '0'
      const effectiveCollapsed = pillar.collapsible && !pillar.alwaysExpanded && collapsedPref && !pillarHasActive
      const collapsedClass = effectiveCollapsed ? ' collapsed' : ''

      html += `<div class="nav-pillar-${pillar.id} nav-pillar${collapsedClass}">`

      // industry 主线加入滑动指示器(保留原 primary 视觉)
      if (pillar.id === 'industry') {
        html += `<div class="nav-active-indicator" aria-hidden="true"></div>`
      }

      // 主线标题(可折叠的有 toggle 按钮,总是展开的只显示静态标题)
      if (pillar.collapsible && !pillar.alwaysExpanded) {
        html += `<button class="zone-toggle-btn pillar-toggle-btn" data-pillar="${pillar.id}" title="${_escSidebar(pillar.label)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
          <span>${_escSidebar(pillar.label)}</span>
          <span class="zone-toggle-count">${visibleChildren.length}</span>
        </button>`
      } else if (pillar.alwaysExpanded) {
        html += `<div class="nav-section-title">${_escSidebar(pillar.label)}</div>`
      }

      // 主线子项
      html += `<div class="nav-section">`
      for (const item of visibleChildren) {
        const active = isNavItemActive(item, currentState) ? ' active' : ''
        const navHash = getNavItemHash(item)
        const itemBadge2 = ''
        const itemReq = item.requiresEngineSwitch || getNavRouteSwitch(item.route, isHermesMode ? ENGINE_IDS.HERMES : ENGINE_IDS.OPENCLAW)
        const reqAttr = itemReq ? ` data-requires-engine-switch="${itemReq}"` : ''
        html += `<div class="nav-item${active}" data-route="${item.route}" data-nav-hash="${navHash}" ${item.isDefault ? 'data-nav-default="1"' : ''}${reqAttr}>
          <span class="nav-item-icon">${ICONS[item.icon] || ''}</span>
          <span class="nav-item-label">${_escSidebar(item.label)}${itemBadge2}</span>
        </div>`
      }
      html += '</div>' // .nav-section

      html += '</div>' // .nav-pillar
    }
  }

  html += '</nav>'

  const paletteIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3a9 9 0 100 18h1.2a2.8 2.8 0 000-5.6H12a2.2 2.2 0 110-4.4h1.8a3.2 3.2 0 100-6.4H12z"/><circle cx="7.5" cy="10.5" r="1"/><circle cx="10.5" cy="7.5" r="1"/><circle cx="15.5" cy="8.5" r="1"/><circle cx="17" cy="13" r="1"/></svg>'
  const chevronIcon = '<svg class="sidebar-theme-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>'
  const checkIcon = '<svg class="sidebar-theme-option-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M5 12.5l4.2 4.2L19 7"/></svg>'
  const themeMenuHtml = themeOptions.map(option => {
    const active = option.id === activeTheme.id ? ' active' : ''
    const swatches = option.swatches.map(color => `<span style="background:${color}"></span>`).join('')
    return `<button class="sidebar-theme-option${active}" type="button" data-theme-preset="${option.id}" role="menuitemradio" aria-checked="${option.id === activeTheme.id ? 'true' : 'false'}">
      <span class="sidebar-theme-option-swatches">${swatches}</span>
      <span class="sidebar-theme-option-copy">
        <span class="sidebar-theme-option-label">${option.label}</span>
        <span class="sidebar-theme-option-desc">${option.description}</span>
      </span>
      ${checkIcon}
    </button>`
  }).join('')

  html += `
    <div class="sidebar-footer">
      <div class="sidebar-theme-menu${_themeMenuOpen ? ' open' : ''}" id="sidebar-theme-menu" role="menu" aria-label="${t('sidebar.theme_label')}">
        ${themeMenuHtml}
      </div>
      <div class="nav-item sidebar-theme-trigger${_themeMenuOpen ? ' open' : ''}" id="btn-theme-menu" aria-haspopup="menu" aria-expanded="${_themeMenuOpen ? 'true' : 'false'}">
        <span class="nav-item-icon">${paletteIcon}</span>
        <span class="nav-item-label">
          <span class="sidebar-theme-meta">
            <span class="sidebar-theme-caption">${t('sidebar.theme_label')}</span>
            <span class="sidebar-theme-name">${activeTheme.label}</span>
          </span>
          ${chevronIcon}
        </span>
      </div>
    </div>
  `

  el.innerHTML = html
  syncSidebarState(currentState)

  // 社区版无行业模块

  // Workspace 切换器:每次 render 都要重新绑(因为按钮元素是新的)
  bindWorkspaceSwitcher(el)

  // 首次渲染时异步检测多实例
  if (!_delegated) _checkMultiInstances(el)

  // 事件委托：只绑定一次，避免重复绑定
  if (!_delegated) {
    _delegated = true
    el.addEventListener('click', (e) => {
      // Hermes 主线点击 — 切换引擎(优先级高于普通导航项,因为 engine-switch 没有 route)
      const engineSwitchEl = e.target.closest('[data-engine-switch]')
      if (engineSwitchEl && !e.target.closest('.nav-item[data-route]')) {
        const targetEngine = engineSwitchEl.dataset.engineSwitch
        if (targetEngine === ENGINE_IDS.HERMES) {
          _switchEngineAndNavigate(el, ENGINE_IDS.HERMES)
          _closeMobileSidebar()
        }
        return
      }
      // 导航点击
      const navItem = e.target.closest('.nav-item[data-route]')
      if (navItem) {
        const targetRoute = navItem.dataset.navHash || navItem.dataset.route
        const requiredEngine = navItem.dataset.requiresEngineSwitch
        const needsSwitch = requiredEngine && getActiveEngineId() !== requiredEngine
        if (needsSwitch) {
          const engineName = getEngine(requiredEngine)?.name || requiredEngine
          toast(t('sidebar.toast_switching_engine', { engine: engineName }) || `切换到 ${engineName} 引擎中...`, 'info')
          _switchEngineAndNavigate(el, requiredEngine, { route: targetRoute })
          _closeMobileSidebar()
          return
        }
        navigate(targetRoute)
        _closeMobileSidebar()
        return
      }
      // 移动端关闭按钮
      if (e.target.closest('#btn-sidebar-close')) {
        _closeMobileSidebar()
        return
      }
      // 主线(pillar)折叠/展开 — 新 Phase B 语义
      const pillarToggle = e.target.closest('.pillar-toggle-btn')
      if (pillarToggle) {
        const pillarId = pillarToggle.dataset.pillar
        const pillarEl = pillarToggle.closest('.nav-pillar')
        if (pillarEl && pillarId) {
          const isCollapsed = pillarEl.classList.toggle('collapsed')
          localStorage.setItem(`privix-community-pillar-${pillarId}-collapsed`, isCollapsed ? '1' : '0')
        }
        return
      }
      // 主题菜单
      const themeBtn = e.target.closest('#btn-theme-menu')
      if (themeBtn) {
        _toggleThemeMenu()
        return
      }
      const themeOption = e.target.closest('.sidebar-theme-option[data-theme-preset]')
      if (themeOption) {
        _themeMenuOpen = false
        setThemePreset(themeOption.dataset.themePreset)
        return
      }
      // 实例切换器
      const toggleBtn = e.target.closest('#btn-instance-toggle')
      if (toggleBtn) {
        _toggleInstanceDropdown(el)
        return
      }
      // 选择实例
      const opt = e.target.closest('.instance-option[data-id]')
      if (opt) {
        const id = opt.dataset.id
        _closeInstanceDropdown()
        if (id !== getActiveInstance().id) {
          opt.style.opacity = '0.5'
          switchInstance(id).then(() => {
            const inst = getActiveInstance()
            const desc = inst.type === 'local' ? '本机' : inst.name
            toast(`已切换到 ${desc} — 模型配置、Agent 等将管理该实例`, 'success')
            renderSidebar(el)
            reloadCurrentRoute()
          })
        }
        return
      }
      // 添加实例
      const addBtn = e.target.closest('#btn-instance-add')
      if (addBtn) {
        _closeInstanceDropdown()
        _showAddInstanceDialog(el)
        return
      }
      // 引擎 segmented 切换
      const engineSeg = e.target.closest('.engine-seg[data-engine-id]')
      if (engineSeg) {
        const eid = engineSeg.dataset.engineId
        if (eid !== getActiveEngineId()) {
          // 立即在 UI 上移动 indicator(避免等 async switchEngine 才看到反馈)
          const switcher = engineSeg.closest('.engine-segmented')
          if (switcher) switcher.dataset.engineActive = eid
          _switchEngineAndNavigate(el, eid)
        }
        return
      }
    })

    document.addEventListener('click', _handleSidebarDismiss, true)
    document.addEventListener('keydown', _handleSidebarHotkeys)

    // 监听实例变化:_checkMultiInstances 自身会在 _hasMultipleInstances 翻转时触发
    // re-render,这里只需为「实例 ID 切换」(数量未变但 active 变了) 的情况兜底
    let _lastInstanceId = getActiveInstance().id
    onInstanceChange(() => {
      _checkMultiInstances(el)
      const cur = getActiveInstance().id
      if (cur !== _lastInstanceId) { _lastInstanceId = cur; renderSidebar(el) }
    })
    // 引擎切换(来自侧栏下拉 / Overview 卡 / 任何地方)→ sidebar 同步重渲染
    let _lastEngineId = getActiveEngineId()
    onEngineChange(() => {
      const cur = getActiveEngineId()
      if (cur !== _lastEngineId) { _lastEngineId = cur; renderSidebar(el) }
    })
    onThemeChange(() => {
      // 增量更新：只刷新主题菜单选中状态
      _themeMenuOpen = false
      const menu = el.querySelector('#sidebar-theme-menu')
      if (menu) {
        menu.classList.remove('open')
        const currentPreset = getThemePreset()
        menu.querySelectorAll('[data-theme-preset]').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.themePreset === currentPreset)
        })
      }
    })
  }
}

function _escSidebar(s) { return String(s || '').replace(/</g, '&lt;').replace(/>/g, '&gt;') }

function _toggleThemeMenu() {
  const menu = document.getElementById('sidebar-theme-menu')
  const trigger = document.getElementById('btn-theme-menu')
  if (!menu || !trigger) return
  _themeMenuOpen = !menu.classList.contains('open')
  menu.classList.toggle('open', _themeMenuOpen)
  trigger.classList.toggle('open', _themeMenuOpen)
  trigger.setAttribute('aria-expanded', _themeMenuOpen ? 'true' : 'false')
  if (_themeMenuOpen) {
    _closeInstanceDropdown()
    _positionThemeMenu()
  }
}

function _closeThemeMenu() {
  _themeMenuOpen = false
  const menu = document.getElementById('sidebar-theme-menu')
  const trigger = document.getElementById('btn-theme-menu')
  if (menu) menu.classList.remove('open')
  if (trigger) {
    trigger.classList.remove('open')
    trigger.setAttribute('aria-expanded', 'false')
  }
}

function _handleSidebarDismiss(event) {
  const target = event.target
  if (!target?.closest?.('.instance-switcher')) _closeInstanceDropdown()
  if (!target?.closest?.('#btn-theme-menu') && !target?.closest?.('#sidebar-theme-menu')) _closeThemeMenu()
}

function _handleSidebarHotkeys(event) {
  if (event.key !== 'Escape') return
  _closeInstanceDropdown()
  _closeThemeMenu()
}

// === 移动端侧边栏 ===
function _closeMobileSidebar() {
  const sidebar = document.getElementById('sidebar')
  const overlay = document.getElementById('sidebar-overlay')
  if (sidebar) sidebar.classList.remove('sidebar-open')
  if (overlay) overlay.classList.remove('visible')
}

export function openMobileSidebar() {
  const sidebar = document.getElementById('sidebar')
  if (!sidebar) return
  sidebar.classList.add('sidebar-open')
  let overlay = document.getElementById('sidebar-overlay')
  if (!overlay) {
    overlay = document.createElement('div')
    overlay.id = 'sidebar-overlay'
    overlay.className = 'sidebar-overlay'
    overlay.addEventListener('click', _closeMobileSidebar)
    document.getElementById('app').appendChild(overlay)
  }
  requestAnimationFrame(() => overlay.classList.add('visible'))
}

function _closeInstanceDropdown() {
  const dd = document.getElementById('instance-dropdown')
  if (dd) dd.classList.remove('open')
}

async function _toggleInstanceDropdown(sidebarEl) {
  const dd = document.getElementById('instance-dropdown')
  if (!dd) return
  if (dd.classList.contains('open')) { dd.classList.remove('open'); return }

  dd.innerHTML = '<div style="padding:8px;color:var(--text-tertiary);font-size:12px">加载中...</div>'
  dd.classList.add('open')
  _positionInstanceDropdown()

  try {
    const [data, health] = await Promise.all([api.instanceList(), api.instanceHealthAll()])
    const healthMap = Object.fromEntries((health || []).map(h => [h.id, h]))
    const activeId = getActiveInstance().id
    let html = '<div class="instance-hint">切换后，模型配置、Agent 等页面将管理对应实例</div>'
    for (const inst of data.instances) {
      const h = healthMap[inst.id] || {}
      const active = inst.id === activeId ? ' active' : ''
      const dot = h.online !== false ? 'online' : 'offline'
      const badge = inst.type === 'docker' ? '<span class="instance-badge docker">Docker</span>' : inst.type === 'remote' ? '<span class="instance-badge remote">远程</span>' : ''
      const port = inst.endpoint ? inst.endpoint.match(/:(\d+)/)?.[1] : ''
      const portTag = port ? `<span class="instance-port">:${port}</span>` : ''
      html += `<div class="instance-option${active}" data-id="${inst.id}">
        <span class="instance-dot ${dot}"></span>
        <span class="instance-opt-name">${_escSidebar(inst.name)}</span>
        ${portTag}
        ${badge}
        ${active ? '<span class="instance-active-tag">当前</span>' : ''}
      </div>`
    }
    html += '<div class="instance-divider"></div>'
    html += '<div class="instance-option instance-add" id="btn-instance-add">+ 添加实例</div>'
    dd.innerHTML = html
  } catch (e) {
    dd.innerHTML = `<div style="padding:8px;color:var(--error);font-size:12px">${_escSidebar(e.message)}</div>`
  }
}

async function _showAddInstanceDialog(sidebarEl) {
  const overlay = document.createElement('div')
  overlay.className = 'docker-dialog-overlay'
  overlay.innerHTML = `
    <div class="docker-dialog">
      <div class="docker-dialog-title">添加远程实例</div>
      <div class="form-group" style="margin-bottom:var(--space-md)">
        <label class="form-label">名称</label>
        <input class="form-input" id="inst-name" placeholder="远程服务器" />
      </div>
      <div class="form-group" style="margin-bottom:var(--space-md)">
        <label class="form-label">面板地址</label>
        <input class="form-input" id="inst-endpoint" placeholder="http://192.168.1.100:1420" />
      </div>
      <div class="form-group" style="margin-bottom:var(--space-md)">
        <label class="form-label">Gateway 端口（可选）</label>
        <input class="form-input" id="inst-gw-port" type="number" value="18789" />
      </div>
      <div class="docker-dialog-hint">
        远程服务器需要运行 Privix (serve.js)。<br/>
        示例: <code>http://192.168.1.100:1420</code>
      </div>
      <div id="inst-add-error" style="color:var(--error);font-size:12px;margin-top:var(--space-sm)"></div>
      <div class="docker-dialog-actions">
        <button class="btn btn-secondary btn-sm" id="inst-cancel">取消</button>
        <button class="btn btn-primary btn-sm" id="inst-confirm">添加</button>
      </div>
    </div>
  `
  document.body.appendChild(overlay)
  overlay.querySelector('#inst-cancel').onclick = () => overlay.remove()
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove() })
  overlay.querySelector('#inst-confirm').onclick = async () => {
    const name = overlay.querySelector('#inst-name').value.trim()
    const endpoint = overlay.querySelector('#inst-endpoint').value.trim()
    const gwPort = parseInt(overlay.querySelector('#inst-gw-port').value) || 18789
    const errEl = overlay.querySelector('#inst-add-error')
    if (!name || !endpoint) { errEl.textContent = '请填写名称和面板地址'; return }
    const btn = overlay.querySelector('#inst-confirm')
    btn.disabled = true; btn.textContent = '添加中...'
    try {
      await api.instanceAdd({ name, type: 'remote', endpoint, gatewayPort: gwPort })
      overlay.remove()
      renderSidebar(sidebarEl)
    } catch (e) {
      errEl.textContent = e.message || String(e)
      btn.disabled = false; btn.textContent = '添加'
    }
  }
}
