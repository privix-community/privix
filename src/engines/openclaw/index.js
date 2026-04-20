/**
 * OpenClaw 引擎
 * 包装现有 OpenClaw 逻辑为统一的 Engine 接口，不改动原有代码
 */
import { detectOpenclawStatus, isOpenclawReady, isGatewayRunning, isGatewayForeign,
  onGatewayChange, startGatewayPoll, stopGatewayPoll, onReadyChange } from '../../lib/app-state.js'
import { initFeatureGates, isFeatureAvailable } from '../../lib/feature-gates.js'
import { getProfileHomeRoute, requiresOpenclawSetup } from '../../lib/product-profile.js'
import { t } from '../../lib/i18n.js'

export default {
  id: 'openclaw',
  name: 'OpenClaw',
  description: 'OpenClaw AI Agent Framework',
  icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>',

  /** 检测 OpenClaw 是否已安装 */
  async detect() {
    const ready = await detectOpenclawStatus()
    return { installed: ready, ready }
  },

  /** 启动 OpenClaw 引擎相关逻辑 */
  async boot() {
    await detectOpenclawStatus()
    await initFeatureGates().catch(() => {})
    startGatewayPoll()
  },

  /** 清理（停止轮询等） */
  cleanup() {
    stopGatewayPoll()
  },

  /** 路由注册表 — 包含所有 OpenClaw 核心路由 + 投资域路��� */
  getRoutes() {
    return [
      // 核心 OpenClaw 页面
      { path: '/overview', loader: () => import('../../pages/overview.js') },
      { path: '/dashboard', loader: () => import('../../pages/dashboard.js') },
      { path: '/chat', loader: () => import('../../pages/chat.js') },
      { path: '/chat-debug', loader: () => import('../../pages/chat-debug.js') },
      { path: '/services', loader: () => import('../../pages/services.js') },
      { path: '/logs', loader: () => import('../../pages/logs.js') },
      { path: '/models', loader: () => import('../../pages/models.js') },
      { path: '/agents', loader: () => import('../../pages/agents.js') },
      { path: '/gateway', loader: () => import('../../pages/gateway.js') },
      { path: '/memory', loader: () => import('../../pages/memory.js') },
      { path: '/skills', loader: () => import('../../pages/skills.js') },
      { path: '/mcp', loader: () => import('../../pages/mcp.js') },
      { path: '/security', loader: () => import('../../pages/security.js') },
      { path: '/about', loader: () => import('../../pages/about.js') },
      { path: '/assistant', loader: () => import('../../pages/assistant.js') },
      { path: '/setup', loader: () => import('../../pages/setup.js') },
      { path: '/quick-setup', loader: () => import('../../pages/quick-setup.js') },
      { path: '/channels', loader: () => import('../../pages/channels.js') },
      { path: '/cron', loader: () => import('../../pages/cron.js') },
      { path: '/usage', loader: () => import('../../pages/usage.js') },
      { path: '/communication', loader: () => import('../../pages/communication.js') },
      { path: '/settings', loader: () => import('../../pages/settings.js') },
      { path: '/dreaming', loader: () => import('../../pages/dreaming.js') },
      { path: '/plugin-hub', loader: () => import('../../pages/plugin-hub.js') },
      { path: '/route-map', loader: () => import('../../pages/route-map.js') },
      { path: '/diagnose', loader: () => import('../../pages/diagnose.js') },
      { path: '/research', loader: () => import('../../pages/evoscientist.js') },
    ]
  },

  getSetupRoute() { return '/setup' },
  getDefaultRoute() { return getProfileHomeRoute() },

  isReady() { return isOpenclawReady() },
  isGatewayRunning() { return isGatewayRunning() },
  isGatewayForeign() { return isGatewayForeign() },

  onStateChange(fn) { return onGatewayChange(fn) },
  onReadyChange(fn) { return onReadyChange(fn) },

  /** 功能门控：基于 OpenClaw 版本号 */
  isFeatureAvailable(featureId) { return isFeatureAvailable(featureId) },
}
