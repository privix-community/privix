/**
 * Privix 入口
 */
// Workspace 隔离 monkey-patch 必须第一个 import,覆写 localStorage 后续所有读写才会自动加命名空间
import { installWorkspaceStorage } from './lib/workspace-storage.js'
installWorkspaceStorage()

import { getHashPath, registerRoute, initRouter, navigate, setDefaultRoute, setRouteGuard, reloadCurrentRoute } from './router.js'
import { renderSidebar, openMobileSidebar } from './components/sidebar.js'
import { initTheme, initScale, initUserCss } from './lib/theme.js'
import { detectOpenclawStatus, isOpenclawReady, isUpgrading, isGatewayRunning, isGatewayForeign, onGatewayChange, startGatewayPoll, onGuardianGiveUp, resetAutoRestart, loadActiveInstance, getActiveInstance, onInstanceChange } from './lib/app-state.js'
import { wsClient } from './lib/ws-client.js'
import { api, checkBackendHealth, isBackendOnline, onBackendStatusChange } from './lib/tauri-api.js'
import { version as APP_VERSION } from '../package.json'
import { statusIcon } from './lib/icons.js'
import { renderTopHeader, updateBreadcrumb } from './components/top-header.js'
import { BRAND_LOGO_ALT, BRAND_LOGO_SRC, BRAND_NAME } from './lib/brand.js'
import { getProfileHomeRoute, getProfileScopedPanelConfigPath, requiresOpenclawSetup, isRouteAllowed, MODULE_IDS, setEnabledModules } from './lib/product-profile.js'
import { initWelcome } from './components/welcome-modal.js'
import { mountHelpFab } from './components/help-fab.js'
import { initI18n, onLocaleChange, t } from './lib/i18n.js'
import { initFeatureGates } from './lib/feature-gates.js'
import { registerEngine, initEngineManager, getActiveEngine, getActiveEngineId, onEngineChange } from './lib/engine-manager.js'
import { canRouteRunInEngine, ENGINE_ROUTE_IDS } from './lib/engine-route-policy.js'
import openclawEngine from './engines/openclaw/index.js'
import hermesEngine from './engines/hermes/index.js'

// 样式
import './style/variables.css'
import './style/reset.css'
import './style/layout.css'
import './style/components.css'
import './style/pages.css'
import './style/chat.css'
import './style/agents.css'
import './style/debug.css'
import './style/assistant.css'
import './style/ai-drawer.css'
import './style/preview-panel.css'

// 初始化主题 + UI缩放 + 用户自定义 CSS
initTheme()
initScale()
initUserCss()  // 非阻塞:后台读取 ~/.privix/user.css 并注入
document.body?.classList.add('app-shell-pending')

const APP_BOOT_MIN_DURATION = 520
const APP_BOOT_STARTED_AT = typeof performance !== 'undefined' ? performance.now() : Date.now()
let _splashHideTimer = null
let _appShellReady = false

// === 访问密码保护（Web + 桌面端通用） ===
const isTauri = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__

async function checkAuth() {
  if (isTauri) {
    // 桌面端：读 clawpanel.json，检查密码配置
    try {
      const { api } = await import('./lib/tauri-api.js')
      const cfg = await api.readPanelConfig()
      if (!cfg.accessPassword) return { ok: true }
      if (sessionStorage.getItem('privix_community_authed') === '1' || sessionStorage.getItem('clawpanel_authed') === '1') return { ok: true }
      // 默认密码：直接传给登录页，避免二次读取
      const defaultPw = (cfg.mustChangePassword && cfg.accessPassword) ? cfg.accessPassword : null
      return { ok: false, defaultPw }
    } catch (error) {
      return {
        ok: false,
        configError: `读取面板配置失败，已阻止跳过密码校验。请检查配置文件是否损坏：${error?.message || error}`,
      }
    }
  }
  // Web 模式
  try {
    const resp = await fetch('/__api/auth_check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    const data = await resp.json()
    if (!data.required || data.authenticated) return { ok: true }
    return { ok: false, defaultPw: data.defaultPassword || null }
  } catch { return { ok: true } }
}

const PROFILE_HOME_ROUTE = getProfileHomeRoute()
const REQUIRE_OPENCLAW_READY = requiresOpenclawSetup()
const PANEL_CONFIG_HINT = getProfileScopedPanelConfigPath()
const SETUP_SAFE_ROUTES = new Set(['/setup', '/assistant', '/settings', '/about', '/chat-debug'])
const _logoSvg = `<div class="login-logo"><img src="${BRAND_LOGO_SRC}" alt="${BRAND_LOGO_ALT}" style="width:64px;height:64px;border-radius:14px;object-fit:contain"></div>`

function isSafeRouteDuringActiveEngineSetup(path) {
  const currentPath = String(path || '')
  if (getActiveEngineId() === ENGINE_ROUTE_IDS.HERMES) {
    return canRouteRunInEngine(ENGINE_ROUTE_IDS.HERMES, currentPath)
  }
  return SETUP_SAFE_ROUTES.has(currentPath)
}

function escHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function _hideSplash() {
  const splash = document.getElementById('splash')
  if (!splash) return
  if (splash.dataset.hiding === '1') return
  splash.dataset.hiding = '1'
  splash.classList.add('hide')
  setTimeout(() => splash.remove(), 500)
}

function _revealAppShell() {
  if (_appShellReady) return
  _appShellReady = true
  document.body?.classList.add('app-shell-ready')
  document.body?.classList.remove('app-shell-pending')
}

function _hideSplashWhenReady({ immediate = false, revealApp = false } = {}) {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const elapsed = now - APP_BOOT_STARTED_AT
  const delay = immediate ? 0 : Math.max(0, APP_BOOT_MIN_DURATION - elapsed)
  if (_splashHideTimer) clearTimeout(_splashHideTimer)
  _splashHideTimer = setTimeout(() => {
    if (revealApp) _revealAppShell()
    _hideSplash()
  }, delay)
}

function mountDefaultPasswordBanner() {
  const shouldShow = sessionStorage.getItem('privix_community_must_change_pw') === '1'
    || sessionStorage.getItem('clawpanel_must_change_pw') === '1'
  if (!shouldShow || document.getElementById('pw-change-banner')) return

  const banner = document.createElement('div')
  banner.id = 'pw-change-banner'
  banner.className = 'pw-change-banner'
  banner.innerHTML = `
    <div class="pw-change-banner-content" role="status" aria-live="polite">
      <span class="pw-change-banner-icon">${statusIcon('warn', 16)}</span>
      <div class="pw-change-banner-copy">
        <div class="pw-change-banner-title">${t('comp.header.page_security')}</div>
        <div class="pw-change-banner-text">${t('main.default_pw_banner')}</div>
      </div>
      <a href="#/security" class="pw-change-banner-link">${t('main.default_pw_go_security')}</a>
      <button type="button" class="pw-change-banner-close" aria-label="Dismiss">×</button>
    </div>
  `
  document.body.appendChild(banner)

  let hideTimer = null
  const scheduleHide = (ms = 5000) => {
    clearTimeout(hideTimer)
    hideTimer = setTimeout(() => dismiss(false), ms)
  }
  const dismiss = (clearMustChangeFlag = false) => {
    clearTimeout(hideTimer)
    if (clearMustChangeFlag) {
      sessionStorage.removeItem('privix_community_must_change_pw')
      sessionStorage.removeItem('clawpanel_must_change_pw')
    }
    banner.classList.remove('pw-change-banner-visible')
    banner.classList.add('pw-change-banner-hidden')
    setTimeout(() => banner.remove(), 240)
  }

  banner.querySelector('.pw-change-banner-link')?.addEventListener('click', () => dismiss(true))
  banner.querySelector('.pw-change-banner-close')?.addEventListener('click', () => dismiss(false))
  banner.addEventListener('mouseenter', () => clearTimeout(hideTimer))
  banner.addEventListener('mouseleave', () => scheduleHide(1800))

  requestAnimationFrame(() => banner.classList.add('pw-change-banner-visible'))
  scheduleHide()
}

// 社区版无激活码 overlay
function enableCommunityModules() {
  setEnabledModules([MODULE_IDS.BASE])
}

// 社区版已移除激活码 overlay + checkLicenseGate 函数

// === 后端离线检测（Web 模式） ===
let _backendRetryTimer = null

function showBackendDownOverlay() {
  if (document.getElementById('backend-down-overlay')) return
  _hideSplashWhenReady({ immediate: true })
  const overlay = document.createElement('div')
  overlay.id = 'backend-down-overlay'
  overlay.innerHTML = `
    <div class="login-card" style="text-align:center">
      ${_logoSvg}
      <div class="login-title" style="color:var(--error,#ef4444)">${t('main.backend_down_title')}</div>
      <div class="login-desc" style="line-height:1.8">
        ${t('main.backend_down_desc', { brand: BRAND_NAME })}<br>
        <span style="font-size:12px;color:var(--text-tertiary)">${t('main.backend_down_hint')}</span>
      </div>
      <div style="background:var(--bg-tertiary);border-radius:var(--radius-md,8px);padding:14px 18px;margin:16px 0;text-align:left;font-family:var(--font-mono,monospace);font-size:12px;line-height:1.8;user-select:all;color:var(--text-secondary)">
        <div style="color:var(--text-tertiary);margin-bottom:4px">${t('main.backend_dev_mode')}</div>
        npm run dev<br>
        <div style="color:var(--text-tertiary);margin-top:8px;margin-bottom:4px">${t('main.backend_prod_mode')}</div>
        npm run preview
      </div>
      <button class="login-btn" id="btn-backend-retry" style="margin-top:8px">
        <span id="backend-retry-text">${t('main.backend_retry')}</span>
      </button>
      <div id="backend-retry-status" style="font-size:12px;color:var(--text-tertiary);margin-top:12px"></div>
      <div style="margin-top:16px;font-size:11px;color:#aaa">
        ${BRAND_NAME}
        <span style="margin:0 6px">&middot;</span>v${APP_VERSION}
      </div>
    </div>
  `
  document.body.appendChild(overlay)

  let retrying = false
  const btn = overlay.querySelector('#btn-backend-retry')
  const statusEl = overlay.querySelector('#backend-retry-status')
  const textEl = overlay.querySelector('#backend-retry-text')

  btn.addEventListener('click', async () => {
    if (retrying) return
    retrying = true
    btn.disabled = true
    textEl.textContent = t('main.backend_checking')
    statusEl.textContent = ''

    const ok = await checkBackendHealth()
    if (ok) {
      statusEl.textContent = t('main.backend_connected')
      statusEl.style.color = 'var(--success,#22c55e)'
      overlay.classList.add('hide')
      setTimeout(() => { overlay.remove(); location.reload() }, 600)
    } else {
      statusEl.textContent = t('main.backend_still_down')
      statusEl.style.color = 'var(--error,#ef4444)'
      textEl.textContent = '重新检测'
      btn.disabled = false
      retrying = false
    }
  })

  // 自动轮询：每 5 秒检测一次
  if (_backendRetryTimer) clearInterval(_backendRetryTimer)
  _backendRetryTimer = setInterval(async () => {
    const ok = await checkBackendHealth()
    if (ok) {
      clearInterval(_backendRetryTimer)
      _backendRetryTimer = null
      statusEl.textContent = t('main.backend_connected')
      statusEl.style.color = 'var(--success,#22c55e)'
      overlay.classList.add('hide')
      setTimeout(() => { overlay.remove(); location.reload() }, 600)
    }
  }, 5000)
}

function showAuthConfigErrorOverlay(message) {
  if (document.getElementById('auth-config-error-overlay')) return
  _hideSplashWhenReady({ immediate: true })
  const overlay = document.createElement('div')
  overlay.id = 'auth-config-error-overlay'
  overlay.innerHTML = `
    <div class="login-card" style="text-align:center">
      ${_logoSvg}
      <div class="login-title" style="color:var(--error,#ef4444)">${t('main.auth_config_error_title')}</div>
      <div class="login-desc" style="line-height:1.8">
        读取桌面端安全配置时出错，应用已停止进入工作台以避免绕过密码保护。<br>
        <span style="font-size:12px;color:var(--text-tertiary)">${t('main.auth_config_error_hint')}</span>
      </div>
      <div style="margin-top:14px;padding:12px 14px;border-radius:10px;background:var(--bg-tertiary);text-align:left;font-size:12px;line-height:1.8;color:var(--text-secondary);word-break:break-all">
        <div style="color:var(--text-tertiary);margin-bottom:6px">${t('main.auth_config_file')}</div>
        <code>${escHtml(PANEL_CONFIG_HINT)}</code>
      </div>
      <div style="margin-top:12px;padding:12px 14px;border-radius:10px;background:rgba(239,68,68,0.08);text-align:left;font-size:12px;line-height:1.8;color:var(--error,#ef4444)">${escHtml(message)}</div>
      <button class="login-btn" id="btn-auth-config-retry" style="margin-top:16px">${t('main.backend_retry')}</button>
      <div style="margin-top:16px;font-size:11px;color:#aaa">
        ${BRAND_NAME}
        <span style="margin:0 6px">&middot;</span>v${APP_VERSION}
      </div>
    </div>
  `
  document.body.appendChild(overlay)
  overlay.querySelector('#btn-auth-config-retry')?.addEventListener('click', () => {
    location.reload()
  })
}

let _loginFailCount = 0
const CAPTCHA_THRESHOLD = 3

function _genCaptcha() {
  const a = Math.floor(Math.random() * 20) + 1
  const b = Math.floor(Math.random() * 20) + 1
  return { q: `${a} + ${b} = ?`, a: a + b }
}

function showLoginOverlay(defaultPw) {
  const hasDefault = !!defaultPw
  const overlay = document.createElement('div')
  overlay.id = 'login-overlay'
  let _captcha = _loginFailCount >= CAPTCHA_THRESHOLD ? _genCaptcha() : null
  overlay.innerHTML = `
    <div class="login-card">
      ${_logoSvg}
      <div class="login-title">${BRAND_NAME}</div>
      <div class="login-desc">${hasDefault
        ? t('main.login_default_pw_hint') + '<br><span style="font-size:12px;color:var(--accent);font-weight:600">' + t('main.login_change_pw_hint') + '</span>'
        : (isTauri ? t('main.login_app_locked') : t('main.login_enter_pw'))}</div>
      <form id="login-form">
        <input class="login-input" type="${hasDefault ? 'text' : 'password'}" id="login-pw" placeholder="${t('main.login_pw_placeholder')}" autocomplete="current-password" autofocus value="${hasDefault ? defaultPw : ''}" />
        <div id="login-captcha" style="display:${_captcha ? 'block' : 'none'};margin-bottom:10px">
          <div style="font-size:12px;color:#888;margin-bottom:6px">${t('main.login_captcha_hint')}<strong id="captcha-q" style="color:var(--text-primary,#333)">${_captcha ? _captcha.q : ''}</strong></div>
          <input class="login-input" type="number" id="login-captcha-input" placeholder="${t('main.login_captcha_placeholder')}" style="text-align:center" />
        </div>
        <button class="login-btn" type="submit">${t('main.login_btn')}</button>
        <div class="login-error" id="login-error"></div>
      </form>
      ${!hasDefault ? `<details class="login-forgot" style="margin-top:16px;text-align:center">
        <summary style="font-size:11px;color:#aaa;cursor:pointer;list-style:none;user-select:none">${t('main.login_forgot_pw')}</summary>
        <div style="margin-top:8px;font-size:11px;color:#888;line-height:1.8;text-align:left;background:rgba(0,0,0,.03);border-radius:8px;padding:10px 14px">
          ${isTauri
            ? `${t('main.login_reset_tauri').split('<code')[0]}<code style="background:rgba(30,58,95,.1);padding:1px 5px;border-radius:3px;font-size:10px">accessPassword</code> 字段即可重置：<br><code style="background:rgba(30,58,95,.1);padding:2px 6px;border-radius:3px;font-size:10px;word-break:break-all">${PANEL_CONFIG_HINT}</code>`
            : `${t('main.login_reset_web').split('<code')[0]}<code style="background:rgba(30,58,95,.1);padding:1px 5px;border-radius:3px;font-size:10px">accessPassword</code> 字段后重启服务：<br><code style="background:rgba(30,58,95,.1);padding:2px 6px;border-radius:3px;font-size:10px;word-break:break-all">${PANEL_CONFIG_HINT}</code>`
          }
        </div>
      </details>` : ''}
      <div style="margin-top:${hasDefault ? '20' : '12'}px;font-size:11px;color:#aaa;text-align:center">
        ${BRAND_NAME}
        <span style="margin:0 6px">·</span>v${APP_VERSION}
      </div>
    </div>
  `
  document.body.appendChild(overlay)
  _hideSplashWhenReady({ immediate: true })

  return new Promise((resolve) => {
    overlay.querySelector('#login-form').addEventListener('submit', async (e) => {
      e.preventDefault()
      const pw = overlay.querySelector('#login-pw').value
      const btn = overlay.querySelector('.login-btn')
      const errEl = overlay.querySelector('#login-error')
      btn.disabled = true
      btn.textContent = t('main.login_logging_in')
      errEl.textContent = ''
      // 验证码校验
      if (_captcha) {
        const captchaVal = parseInt(overlay.querySelector('#login-captcha-input')?.value)
        if (captchaVal !== _captcha.a) {
          errEl.textContent = t('main.login_captcha_error')
          _captcha = _genCaptcha()
          const qEl = overlay.querySelector('#captcha-q')
          if (qEl) qEl.textContent = _captcha.q
          overlay.querySelector('#login-captcha-input').value = ''
          btn.disabled = false
          btn.textContent = t('main.login_btn')
          return
        }
      }
      try {
        if (isTauri) {
          // 桌面端：本地比对密码
          const { api } = await import('./lib/tauri-api.js')
          const cfg = await api.readPanelConfig()
          if (pw !== cfg.accessPassword) {
            _loginFailCount++
            if (_loginFailCount >= CAPTCHA_THRESHOLD && !_captcha) {
              _captcha = _genCaptcha()
              const cEl = overlay.querySelector('#login-captcha')
              if (cEl) { cEl.style.display = 'block'; cEl.querySelector('#captcha-q').textContent = _captcha.q }
            }
            errEl.textContent = `密码错误${_loginFailCount >= CAPTCHA_THRESHOLD ? '' : ` (${_loginFailCount}/${CAPTCHA_THRESHOLD})`}`
            btn.disabled = false
            btn.textContent = t('main.login_btn')
            return
          }
          sessionStorage.setItem('privix_community_authed', '1')
          // 同步建立 web session（WEB_ONLY_CMDS 需要 cookie 认证）
          try {
            await fetch('/__api/auth_login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ password: pw }),
            })
          } catch {}
          overlay.classList.add('hide')
          setTimeout(() => overlay.remove(), 400)
          if (cfg.accessPassword === '123456') {
            sessionStorage.setItem('privix_community_must_change_pw', '1')
          }
          resolve()
        } else {
          // Web 模式：调后端
          const resp = await fetch('/__api/auth_login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: pw }),
          })
          const data = await resp.json()
          if (!resp.ok) {
            _loginFailCount++
            if (_loginFailCount >= CAPTCHA_THRESHOLD && !_captcha) {
              _captcha = _genCaptcha()
              const cEl = overlay.querySelector('#login-captcha')
              if (cEl) { cEl.style.display = 'block'; cEl.querySelector('#captcha-q').textContent = _captcha.q }
            }
            errEl.textContent = (data.error || '登录失败') + (_loginFailCount >= CAPTCHA_THRESHOLD ? '' : ` (${_loginFailCount}/${CAPTCHA_THRESHOLD})`)
            btn.disabled = false
            btn.textContent = t('main.login_btn')
            return
          }
          overlay.classList.add('hide')
          setTimeout(() => overlay.remove(), 400)
          if (data.mustChangePassword || data.defaultPassword === '123456') {
            sessionStorage.setItem('privix_community_must_change_pw', '1')
          }
          resolve()
        }
      } catch (err) {
        errEl.textContent = '网络错误: ' + (err.message || err)
        btn.disabled = false
        btn.textContent = t('main.login_btn')
      }
    })
  })
}

// 全局 401 拦截：API 返回 401 时弹出登录
window.__privix_community_show_login = async function() {
  if (document.getElementById('login-overlay')) return
  await showLoginOverlay()
  location.reload()
}
// Keep old alias for backward compatibility
window.__clawpanel_show_login = window.__privix_community_show_login

const sidebar = document.getElementById('sidebar')
const content = document.getElementById('content')

async function boot() {
  enableCommunityModules()

  // 注册双引擎并初始化（读取 clawpanel.json 中的 engineMode）
  registerEngine(openclawEngine)
  registerEngine(hermesEngine)
  await initEngineManager()

  // 引擎路由已由 engine-manager 注册，此处确保 overview 路由始终存在
  registerRoute('/overview', () => import('./pages/overview.js'))

  renderSidebar(sidebar)

  // 顶部 Header 栏
  const topHeaderEl = document.getElementById('top-header')
  renderTopHeader(topHeaderEl)
  window.addEventListener('hashchange', () => updateBreadcrumb(topHeaderEl))

  // i18n: 语言切换时重新渲染侧边栏、顶栏和当前页面
  onLocaleChange(() => {
    renderSidebar(sidebar)
    renderTopHeader(topHeaderEl)
    updateBreadcrumb(topHeaderEl)
    reloadCurrentRoute()
  })

  content.innerHTML = `
    <div class="page-loader">
      <div class="page-loader-shell">
        <div class="page-loader-spinner"></div>
        <div class="page-loader-copy">
          <div class="page-loader-kicker">Privix</div>
          <div class="page-loader-text">${t('main.page_loading')}</div>
        </div>
      </div>
    </div>
  `

  // 移动端顶栏（汉堡菜单 + 标题）
  const mainCol = document.getElementById('main-col')
  const topbar = document.createElement('div')
  topbar.className = 'mobile-topbar'
  topbar.id = 'mobile-topbar'
  topbar.innerHTML = `
    <button class="mobile-hamburger" id="btn-mobile-menu">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
    </button>
    <span class="mobile-topbar-title">${BRAND_NAME}</span>
  `
  topbar.querySelector('.mobile-hamburger').addEventListener('click', openMobileSidebar)
  mainCol.prepend(topbar)

  // Tauri 模式：确保 web session 存在（页面刷新后 cookie 可能丢失），然后加载实例和检测状态
  const ensureWebSession = isTauri
    ? api.readPanelConfig().then(cfg => {
        if (cfg.accessPassword) {
          return fetch('/__api/auth_login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: cfg.accessPassword }),
          }).catch(() => {})
        }
      }).catch(() => {})
    : Promise.resolve()

  ensureWebSession.then(() => Promise.all([loadActiveInstance(), detectOpenclawStatus()])).then(() => {
    // 版本门控预加载（fire-and-forget，未获取到版本时默认显示所有功能）
    initFeatureGates().catch(() => {})
    setRouteGuard(async (routeState) => {
      if (getActiveEngineId() === ENGINE_ROUTE_IDS.HERMES) {
        if (!canRouteRunInEngine(ENGINE_ROUTE_IDS.HERMES, routeState.path)) {
          return { redirectTo: { path: getActiveEngine()?.getDefaultRoute() || '/h/dashboard' } }
        }
        return null
      }
      if (!isRouteAllowed(routeState.path)) {
        const activeEngine = getActiveEngine()
        const fallbackSetup = activeEngine?.getSetupRoute?.() || '/setup'
        return {
          redirectTo: {
            path: !REQUIRE_OPENCLAW_READY || activeEngine?.isReady?.() ? PROFILE_HOME_ROUTE : fallbackSetup,
          },
        }
      }
      // 引擎感知的 setup 守卫
      const activeEngineGuard = getActiveEngine()
      const activeReady = activeEngineGuard?.isReady?.() ?? false
      const activeSetup = activeEngineGuard?.getSetupRoute?.() || '/setup'
      const safeDuringSetup = routeState.path === activeSetup || isSafeRouteDuringActiveEngineSetup(routeState.path)
      if (REQUIRE_OPENCLAW_READY && !activeReady && !safeDuringSetup) {
        return { redirectTo: { path: activeSetup } }
      }
      return null
    })

    // 重新渲染侧边栏（检测完成后 isOpenclawReady 状态已更新）
    renderSidebar(sidebar)
    const currentHashPath = getHashPath(window.location.hash, PROFILE_HOME_ROUTE)
    const bootActiveEngine = getActiveEngine()
    const bootEngineReady = bootActiveEngine?.isReady?.() ?? false
    const bootSetupRoute = bootActiveEngine?.getSetupRoute?.() || '/setup'
    const bootSafe = currentHashPath === bootSetupRoute || isSafeRouteDuringActiveEngineSetup(currentHashPath)
    if (REQUIRE_OPENCLAW_READY && !bootEngineReady && !bootSafe) {
      setDefaultRoute(bootSetupRoute)
      navigate(bootSetupRoute)
    } else {
      setDefaultRoute(PROFILE_HOME_ROUTE)
      if (window.location.hash === '#/setup') navigate(PROFILE_HOME_ROUTE)
      setupGatewayBanner()
      startGatewayPoll()

      // 自动连接 WebSocket（如果 Gateway 正在运行）
      if (isGatewayRunning()) {
        autoConnectWebSocket()
      }

      // 监听 Gateway 状态变化，自动连接/断开 WebSocket
      onGatewayChange((running) => {
        if (running) {
          autoConnectWebSocket()
        } else {
          wsClient.disconnect()
        }
      })

      // 守护放弃时，弹出恢复选项
      if (window.__TAURI_INTERNALS__) {
        import('@tauri-apps/api/event').then(async ({ listen }) => {
          await listen('guardian-event', (e) => {
            if (e.payload?.kind === 'give_up' || e.payload?.kind === 'config_error') {
              showGuardianRecovery(e.payload?.message)
            }
          })
        }).catch(() => {})
        api.guardianStatus().then(status => {
          if (status?.giveUp) showGuardianRecovery()
        }).catch(() => {})
      } else {
        onGuardianGiveUp(() => {
          showGuardianRecovery()
        })
      }

      // 实例切换时，重连 WebSocket + 重新检测状态
      onInstanceChange(async () => {
        wsClient.disconnect()
        await detectOpenclawStatus()
        if (isGatewayRunning()) autoConnectWebSocket()
      })
    }
    const revealWorkspace = () => {
      clearTimeout(revealFallbackTimer)
      requestAnimationFrame(() => {
        _hideSplashWhenReady({ revealApp: true })
        mountDefaultPasswordBanner()
      })
    }
    window.addEventListener('app:first-route-ready', revealWorkspace, { once: true })
    const revealFallbackTimer = setTimeout(revealWorkspace, 2200)

    initRouter(content)

    // 暴露 navigate 给 welcome-modal 的场景跳转使用
    window.__clawpanel_router = { navigate }

    // 挂载常驻帮助 FAB
    mountHelpFab()

    // 首次进入时显示欢迎弹窗（仅新用户）
    initWelcome({
      brandName: BRAND_NAME,
      brandLogoSrc: BRAND_LOGO_SRC,
    })

    // 全局监听后台任务完成/失败事件，自动刷新安装状态和侧边栏
    if (window.__TAURI_INTERNALS__) {
      import('@tauri-apps/api/event').then(async ({ listen }) => {
        const refreshAfterTask = async () => {
          // 清除 API 缓存，确保拿到最新状态
          const { invalidate } = await import('./lib/tauri-api.js')
          invalidate('check_installation', 'get_services_status', 'get_version_info')
            await detectOpenclawStatus()
          renderSidebar(sidebar)
          // 如果安装完成后变为就绪，跳转到仪表盘
          if ((!REQUIRE_OPENCLAW_READY || isOpenclawReady()) && window.location.hash === '#/setup') {
            navigate(PROFILE_HOME_ROUTE)
          }
          // 如果卸载后变为未就绪，跳转到 setup
          const currentPath = getHashPath(window.location.hash, PROFILE_HOME_ROUTE)
          if (REQUIRE_OPENCLAW_READY && !isOpenclawReady() && !isUpgrading() && !isSafeRouteDuringActiveEngineSetup(currentPath)) {
            setDefaultRoute('/setup')
            navigate('/setup')
          }
        }
        await listen('upgrade-done', async (e) => {
          await refreshAfterTask()
          // OpenClaw 版本变更成功后，自动重装已安装的渠道插件以确保兼容
          const { api: tApi } = await import('./lib/tauri-api.js')
          reinstallChannelPluginsAfterUpgrade(tApi).catch(() => {})
        })
        await listen('upgrade-error', refreshAfterTask)
      }).catch(() => {})
    }
  })
}

/** OpenClaw 版本变更后，静默重装已安装的渠道插件以确保兼容性。 */
async function reinstallChannelPluginsAfterUpgrade(tauriApi) {
  const CHANNEL_PLUGINS = [
    { pluginId: 'openclaw-lark', packageName: '@larksuite/openclaw-lark@latest', label: '飞书' },
    { pluginId: 'dingtalk-connector', packageName: '@dingtalk-real-ai/dingtalk-connector', label: '钉钉' },
  ]
  for (const plugin of CHANNEL_PLUGINS) {
    try {
      const status = await tauriApi.getChannelPluginStatus(plugin.pluginId)
      if (!status?.installed) continue
      console.log(`[main] OpenClaw 版本变更，重装渠道插件 ${plugin.label} (${plugin.pluginId})...`)
      await tauriApi.installChannelPlugin(plugin.packageName, plugin.pluginId)
      console.log(`[main] 渠道插件 ${plugin.label} 重装完成`)
    } catch (err) {
      console.warn(`[main] 渠道插件 ${plugin.label} 重装失败:`, err)
    }
  }
}

async function autoConnectWebSocket() {
  try {
    const inst = getActiveInstance()
    console.log(`[main] 自动连接 WebSocket (实例: ${inst.name})...`)
    const config = await api.readOpenclawConfig()
    const port = config?.gateway?.port || 18789
    const rawToken = config?.gateway?.auth?.token
    const token = (typeof rawToken === 'string') ? rawToken : ''

    // 启动前先确保设备已配对 + allowedOrigins 已写入，无需用户手动操作
    let needReload = false
    try {
      const pairResult = await api.autoPairDevice()
      console.log('[main] 设备配对 + origins 已就绪:', pairResult)
      // 仅在配置实际变更时才需要 reload（dev-api 返回 {changed}，Tauri 返回字符串）
      if (typeof pairResult === 'object' && pairResult.changed) {
        needReload = true
      } else if (typeof pairResult === 'string' && pairResult !== '设备已配对') {
        needReload = true
      }
    } catch (pairErr) {
      console.warn('[main] autoPairDevice 失败（非致命）:', pairErr)
    }

    // 确保模型配置包含 vision 支持（input: ["text", "image"]）
    try {
      const patched = await api.patchModelVision()
      if (patched) {
        console.log('[main] 已为模型添加 vision 支持')
        needReload = true
      }
    } catch (visionErr) {
      console.warn('[main] patchModelVision 失败（非致命）:', visionErr)
    }

    // 统一 reload Gateway（配对 origins + vision patch 合并为一次 reload）
    if (needReload) {
      try {
        await api.reloadGateway()
        console.log('[main] Gateway 已重载')
      } catch (reloadErr) {
        console.warn('[main] reloadGateway 失败（非致命）:', reloadErr)
      }
    }

    let host
    const inst2 = getActiveInstance()
    if (inst2.type !== 'local' && inst2.endpoint) {
      try {
        const url = new URL(inst2.endpoint)
        host = `${url.hostname}:${inst2.gatewayPort || port}`
      } catch {
        host = window.__TAURI_INTERNALS__ ? `127.0.0.1:${port}` : location.host
      }
    } else {
      host = window.__TAURI_INTERNALS__ ? `127.0.0.1:${port}` : location.host
    }
    wsClient.connect(host, token)
    console.log(`[main] WebSocket 连接已启动 -> ${host}`)
  } catch (e) {
    console.error('[main] 自动连接 WebSocket 失败:', e)
  }
}

function setupGatewayBanner() {
  const banner = document.getElementById('gw-banner')
  if (!banner) return

  function update(running, foreign) {
    if (running || sessionStorage.getItem('gw-banner-dismissed')) {
      banner.classList.add('gw-banner-hidden')
      return
    }
    banner.classList.remove('gw-banner-hidden')

    if (foreign) {
      // Gateway 在运行但属于外部实例 —— 显示认领按钮
      banner.innerHTML = `
        <div class="gw-banner-content">
          <span class="gw-banner-icon">${statusIcon('warn', 16)}</span>
          <span>检测到外部 Gateway 正在运行，当前面板无法管理</span>
          <button class="btn btn-sm btn-primary" id="btn-gw-claim" style="margin-left:auto">认领 Gateway</button>
          <a class="btn btn-sm btn-ghost" href="#/services" style="color:inherit;font-size:12px">服务管理</a>
          <button class="gw-banner-close" id="btn-gw-dismiss" title="关闭提示">&times;</button>
        </div>
      `
      banner.querySelector('#btn-gw-dismiss')?.addEventListener('click', () => {
        banner.classList.add('gw-banner-hidden')
        sessionStorage.setItem('gw-banner-dismissed', '1')
      })
      banner.querySelector('#btn-gw-claim')?.addEventListener('click', async (e) => {
        const btn = e.target
        btn.disabled = true
        btn.textContent = t('main.gw_processing')
        try {
          await api.claimGateway()
          // 认领后立刻刷新全局状态
          const { refreshGatewayStatus } = await import('./lib/app-state.js')
          await refreshGatewayStatus()
        } catch (err) {
          btn.disabled = false
          btn.textContent = t('main.gw_claim')
          console.error('[banner] claim failed:', err)
        }
      })
      return
    }

    // Gateway 未运行 —— 显示启动按钮
    banner.innerHTML = `
      <div class="gw-banner-content">
        <span class="gw-banner-icon">${statusIcon('warn', 16)}</span>
        <span>Gateway 未运行</span>
        <button class="btn btn-sm btn-primary" id="btn-gw-start" style="margin-left:auto">启动</button>
        <a class="btn btn-sm btn-ghost" href="#/services" style="color:inherit;font-size:12px">服务管理</a>
        <button class="gw-banner-close" id="btn-gw-dismiss" title="关闭提示">&times;</button>
      </div>
    `
    banner.querySelector('#btn-gw-dismiss')?.addEventListener('click', () => {
      banner.classList.add('gw-banner-hidden')
      sessionStorage.setItem('gw-banner-dismissed', '1')
    })
    banner.querySelector('#btn-gw-start')?.addEventListener('click', async (e) => {
      const btn = e.target
      btn.disabled = true
      btn.classList.add('btn-loading')
      btn.textContent = t('main.gw_starting')
      try {
        await api.startService('ai.openclaw.gateway')
      } catch (err) {
        const errMsg = (err.message || String(err)).slice(0, 120)
        banner.innerHTML = `
          <div class="gw-banner-content" style="flex-wrap:wrap">
            <span class="gw-banner-icon">${statusIcon('warn', 16)}</span>
            <span>启动失败</span>
            <button class="btn btn-sm btn-primary" id="btn-gw-start" style="margin-left:auto">重试</button>
            <a class="btn btn-sm btn-ghost" href="#/services" style="color:inherit;font-size:12px">服务管理</a>
            <a class="btn btn-sm btn-ghost" href="#/logs" style="color:inherit;font-size:12px">查看日志</a>
          </div>
          <div style="font-size:11px;opacity:0.7;margin-top:4px;font-family:monospace;word-break:break-all">${errMsg}</div>
        `
        update(false)
        return
      }
      // 轮询等待实际启动
      const t0 = Date.now()
      while (Date.now() - t0 < 30000) {
        try {
          const s = await api.getServicesStatus()
          const gw = s?.find?.(x => x.label === 'ai.openclaw.gateway') || s?.[0]
          if (gw?.running) { update(true); return }
        } catch {}
        const sec = Math.floor((Date.now() - t0) / 1000)
        btn.textContent = `启动中... ${sec}s`
        await new Promise(r => setTimeout(r, 1500))
      }
      // 超时后尝试获取日志帮助排查
      let logHint = ''
      try {
        const logs = await api.readLogTail('gateway', 5)
        if (logs?.trim()) logHint = `<div style="font-size:12px;margin-top:4px;opacity:0.8;font-family:monospace;white-space:pre-wrap">${logs.trim().split('\n').slice(-3).join('\n')}</div>`
      } catch {}
      banner.innerHTML = `
        <div class="gw-banner-content">
          <span class="gw-banner-icon">${statusIcon('warn', 16)}</span>
          <span>启动超时，Gateway 可能仍在启动中</span>
          <button class="btn btn-sm btn-primary" id="btn-gw-start">重试</button>
          <a class="btn btn-sm btn-ghost" href="#/logs" style="color:inherit;text-decoration:underline">查看日志</a>
        </div>
        ${logHint}
      `
      update(false)
    })
  }

  update(isGatewayRunning(), isGatewayForeign())
  onGatewayChange(update)
}

function showGuardianRecovery(detail) {
  const banner = document.getElementById('gw-banner')
  if (!banner) return
  banner.classList.remove('gw-banner-hidden')
  const _esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const detailHtml = detail
    ? `<div style="font-size:11px;opacity:0.8;font-family:var(--font-mono);white-space:pre-wrap;max-width:480px;margin-top:4px">${_esc(detail)}</div>`
    : ''
  banner.innerHTML = `
    <div class="gw-banner-content" style="flex-wrap:wrap;gap:8px">
      <span class="gw-banner-icon">${statusIcon('warn', 16)}</span>
      <span>Gateway 反复启动失败，可能配置有误</span>
      <button class="btn btn-sm btn-primary" id="btn-gw-recover-fix" style="margin-left:auto">一键修复</button>
      <button class="btn btn-sm btn-secondary" id="btn-gw-recover-restart">重试启动</button>
      <a class="btn btn-sm btn-ghost" href="#/logs">查看日志</a>
    </div>
    ${detailHtml}
  `
  banner.querySelector('#btn-gw-recover-fix')?.addEventListener('click', async (e) => {
    const btn = e.target
    btn.disabled = true
    btn.textContent = '修复中...'
    // 弹出修复弹窗
    const overlay = document.createElement('div')
    overlay.className = 'modal-overlay'
    overlay.innerHTML = `
      <div class="modal" style="max-width:560px">
        <div class="modal-title">自动修复</div>
        <div style="font-size:var(--font-size-sm);color:var(--text-secondary);margin-bottom:12px">
          正在执行 <code>openclaw doctor --fix</code>，自动检测并修复常见配置问题...
        </div>
        <div id="fix-log" style="font-family:var(--font-mono);font-size:11px;background:var(--bg-tertiary);padding:12px;border-radius:var(--radius-md);max-height:300px;overflow-y:auto;white-space:pre-wrap;line-height:1.6;color:var(--text-secondary)">执行中...\n</div>
        <div id="fix-status" style="margin-top:12px;font-size:var(--font-size-sm);font-weight:600"></div>
        <div class="modal-actions" style="margin-top:16px">
          <button class="btn btn-secondary btn-sm" id="fix-close" style="display:none">关闭</button>
        </div>
      </div>
    `
    document.body.appendChild(overlay)
    const logEl = overlay.querySelector('#fix-log')
    const statusEl = overlay.querySelector('#fix-status')
    const closeBtn = overlay.querySelector('#fix-close')
    closeBtn.onclick = () => overlay.remove()

    try {
      const result = await api.doctorFix()
      const output = result?.stdout || result?.output || JSON.stringify(result, null, 2)
      logEl.textContent = output || '修复完成（无输出）'
      logEl.scrollTop = logEl.scrollHeight
      if (result?.errors) {
        statusEl.innerHTML = `<span style="color:var(--warning)">修复完成，但有警告：${_esc(String(result.errors).slice(0, 200))}</span>`
      } else {
        statusEl.innerHTML = '<span style="color:var(--success)">修复完成，正在重启 Gateway...</span>'
        resetAutoRestart()
        try {
          await api.startService('ai.openclaw.gateway')
          statusEl.innerHTML = '<span style="color:var(--success)">修复完成，Gateway 已重启</span>'
        } catch {
          statusEl.innerHTML = '<span style="color:var(--warning)">修复完成，但 Gateway 启动失败，请手动检查</span>'
        }
      }
    } catch (err) {
      logEl.textContent += '\n' + (err.message || String(err))
      statusEl.innerHTML = `<span style="color:var(--error)">修复失败：${_esc(String(err.message || err).slice(0, 200))}</span>`
    }
    closeBtn.style.display = ''
    btn.textContent = t('main.guardian_one_click_fix')
    btn.disabled = false
  })
  banner.querySelector('#btn-gw-recover-restart')?.addEventListener('click', async (e) => {
    const btn = e.target
    btn.disabled = true
    btn.textContent = t('main.gw_starting')
    resetAutoRestart()
    try {
      await api.resetGuardian()
    } catch { /* 忽略，可能是 Web 模式 */ }
    try {
      await api.startService('ai.openclaw.gateway')
      btn.textContent = '已发送启动命令'
    } catch (err) {
      btn.textContent = t('main.gw_start_failed')
      btn.disabled = false
    }
  })
}

// 社区版不做远程更新检查,发版走 GitHub Release

// 启动：先检查后端 → 认证 → 加载应用
;(async () => {
  // 初始化 i18n（在所有 UI 渲染之前）
  await initI18n()

  // Web 模式：先检测后端是否在线（不在线则显示提示，不加载应用）
  if (!isTauri) {
    const backendOk = await checkBackendHealth()
    if (!backendOk) {
      showBackendDownOverlay()
      return
    }
  }

  const auth = await checkAuth()
  if (auth.configError) {
    showAuthConfigErrorOverlay(auth.configError)
    return
  }
  if (!auth.ok) await showLoginOverlay(auth.defaultPw)
  boot()

  // 初始化全局 AI 助手浮动按钮（延迟加载，不阻塞启动）
  setTimeout(async () => {
    const { initAIFab, registerPageContext, openAIDrawerWithError } = await import('./components/ai-drawer.js')
    initAIFab()

    // v1.5 Agent Studio: 启动智能预览面板(给消息中的代码块加👁按钮)
    try {
      const { initPreviewPanelAutoAttach, openPreviewPanel } = await import('./components/preview-panel.js')
      initPreviewPanelAutoAttach()
      // 暴露全局 API,便于其他模块或控制台调用: window.privixPreview({ type, content, title })
      window.privixPreview = openPreviewPanel
    } catch (e) {
      console.warn('[preview-panel] 初始化失败:', e)
    }

    // 注册各页面上下文提供器
    registerPageContext('/chat-debug', async () => {
      const { isOpenclawReady, isGatewayRunning } = await import('./lib/app-state.js')
      const { wsClient } = await import('./lib/ws-client.js')
      const { api } = await import('./lib/tauri-api.js')
      const lines = ['## 系统诊断快照']
      lines.push(`- OpenClaw: ${isOpenclawReady() ? '就绪' : '未就绪'}`)
      lines.push(`- Gateway: ${isGatewayRunning() ? '运行中' : '未运行'}`)
      lines.push(`- WebSocket: ${wsClient.connected ? '已连接' : '未连接'}`)
      try {
        const node = await api.checkNode()
        lines.push(`- Node.js: ${node?.version || '未知'}`)
      } catch {}
      try {
        const ver = await api.getVersionInfo()
        lines.push(`- 版本: 当前 ${ver?.current || '?'} / 推荐 ${ver?.recommended || '?'} / 最新 ${ver?.latest || '?'}${ver?.ahead_of_recommended ? ' / 当前版本高于推荐版' : ''}`)
      } catch {}
      return { detail: lines.join('\n') }
    })

    registerPageContext('/services', async () => {
      const { isGatewayRunning } = await import('./lib/app-state.js')
      const { api } = await import('./lib/tauri-api.js')
      const lines = ['## 服务状态']
      lines.push(`- Gateway: ${isGatewayRunning() ? '运行中' : '未运行'}`)
      try {
        const svc = await api.getServicesStatus()
        if (svc?.[0]) {
          lines.push(`- CLI: ${svc[0].cli_installed ? '已安装' : '未安装'}`)
          lines.push(`- PID: ${svc[0].pid || '无'}`)
        }
      } catch {}
      return { detail: lines.join('\n') }
    })

    registerPageContext('/gateway', async () => {
      const { api } = await import('./lib/tauri-api.js')
      try {
        const config = await api.readOpenclawConfig()
        const gw = config?.gateway || {}
        const lines = ['## Gateway 配置']
        lines.push(`- 端口: ${gw.port || 18789}`)
        lines.push(`- 模式: ${gw.mode || 'local'}`)
        lines.push(`- Token: ${gw.auth?.token ? '已设置' : '未设置'}`)
        if (gw.controlUi?.allowedOrigins) lines.push(`- Origins: ${JSON.stringify(gw.controlUi.allowedOrigins)}`)
        return { detail: lines.join('\n') }
      } catch { return null }
    })

    registerPageContext('/setup', () => {
      return { detail: '用户正在进行 OpenClaw 初始安装，请帮助检查 Node.js 环境和网络状况' }
    })

    // 挂到全局，供安装/升级失败时调用
    window.__openAIDrawerWithError = openAIDrawerWithError
  }, 500)
})()
