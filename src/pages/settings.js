/**
 * 面板设置页面
 * 统一管理 Privix 的网络代理、npm 源、模型代理等配置
 */
import { api } from '../lib/tauri-api.js'
import { toast } from '../components/toast.js'
import { BRAND_NAME } from '../lib/brand.js'
import { getThemeOptions, getThemePreset, onThemeChange, setThemePreset, isUserCssEnabled, setUserCssEnabled, reloadUserCss } from '../lib/theme.js'
import { t, getLocale, setLocale, SUPPORTED_LOCALES } from '../lib/i18n.js'
import { loadSensitiveDetectConfig, saveSensitiveDetectConfig, listSensitiveTypes } from '../lib/sensitive-detect.js'

const isTauri = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__
let _detachThemeListener = null

function escapeHtml(str) {
  if (!str) return ''
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const REGISTRIES = [
  { label: '淘宝镜像 (推荐)', value: 'https://registry.npmmirror.com' },
  { label: 'npm 官方源', value: 'https://registry.npmjs.org' },
  { label: '华为云镜像', value: 'https://repo.huaweicloud.com/repository/npm/' },
]

export async function render() {
  cleanup()
  const page = document.createElement('div')
  page.className = 'page'

  page.innerHTML = `
    <div class="page-header">
      <h1 class="apple-section">面板设置</h1>
      <p class="apple-body-secondary">管理 ${BRAND_NAME} 的网络、代理和下载源配置</p>
    </div>

    <div class="config-section" id="language-section">
      <div class="config-section-title">${t('pages.settings.language')}</div>
      <div class="stat-card" style="padding:16px">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <label style="font-size:13px;color:var(--text-secondary);min-width:80px">${t('pages.settings.language')}</label>
          <select class="form-input" id="locale-select" style="max-width:260px;font-size:13px">
            ${SUPPORTED_LOCALES.map(l => `<option value="${l.code}" ${l.code === getLocale() ? 'selected' : ''}>${l.nativeLabel}</option>`).join('')}
          </select>
        </div>
        <div style="margin-top:8px;font-size:12px;color:var(--text-tertiary)">${t('pages.settings.language_desc')}</div>
      </div>
    </div>

    <div class="config-section" id="theme-section">
      <div class="config-section-title">外观主题</div>
      <div id="theme-bar"><div class="stat-card loading-placeholder" style="height:196px"></div></div>
    </div>

    <div class="config-section" id="user-css-section">
      <div class="config-section-title">${t('pages.settings.user_css_title')}</div>
      <div id="user-css-bar"><div class="stat-card loading-placeholder" style="height:120px"></div></div>
    </div>

    <div class="config-section" id="sensitive-section">
      <div class="config-section-title">${t('sensitive.settings_section')}</div>
      <div id="sensitive-bar"><div class="stat-card loading-placeholder" style="height:120px"></div></div>
    </div>

    <div class="config-section" id="proxy-section">
      <div class="config-section-title">网络代理</div>
      <div id="proxy-bar"><div class="stat-card loading-placeholder" style="height:48px"></div></div>
    </div>

    <div class="config-section" id="model-proxy-section">
      <div class="config-section-title">模型请求代理</div>
      <div id="model-proxy-bar"><div class="stat-card loading-placeholder" style="height:48px"></div></div>
    </div>

    <div class="config-section" id="registry-section">
      <div class="config-section-title">npm 源设置</div>
      <div id="registry-bar"><div class="stat-card loading-placeholder" style="height:48px"></div></div>
    </div>

    <div class="config-section" id="git-path-section">
      <div class="config-section-title">Git 可执行文件路径</div>
      <div id="git-path-bar"><div class="stat-card loading-placeholder" style="height:48px"></div></div>
    </div>

    ${isTauri ? `<div class="config-section" id="autostart-section">
      <div class="config-section-title">开机自启</div>
      <div id="autostart-bar"><div class="stat-card loading-placeholder" style="height:48px"></div></div>
    </div>` : ''}
  `

  bindEvents(page)
  loadAll(page)
  renderSensitiveBar(page.querySelector('#sensitive-bar'))
  _detachThemeListener = onThemeChange(() => renderThemeBar(page.querySelector('#theme-bar')))
  return page
}

function renderSensitiveBar(bar) {
  if (!bar) return
  const cfg = loadSensitiveDetectConfig()
  const types = listSensitiveTypes()
  bar.innerHTML = `
    <div class="stat-card" style="padding:16px">
      <div style="font-size:12px;color:var(--text-secondary);margin-bottom:12px;line-height:1.5">
        ${escapeHtml(t('sensitive.settings_intro'))}
      </div>
      <label style="display:flex;align-items:center;gap:8px;margin-bottom:14px;cursor:pointer">
        <input type="checkbox" id="sensitive-enabled" ${cfg.enabled ? 'checked' : ''}>
        <span style="font-size:13px">${escapeHtml(t('sensitive.settings_enable'))}</span>
      </label>
      <div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px">${escapeHtml(t('sensitive.settings_types_label'))}</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:6px;margin-bottom:14px">
        ${types.map(type => `
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer">
            <input type="checkbox" data-sensitive-type="${escapeHtml(type)}" ${cfg.types.includes(type) ? 'checked' : ''}>
            <span>${escapeHtml(t(`sensitive.type_${type}`))}</span>
          </label>
        `).join('')}
      </div>
      <button class="btn btn-pill-filled btn-sm" id="sensitive-save">${escapeHtml(t('sensitive.settings_save'))}</button>
    </div>
  `
  bar.querySelector('#sensitive-save').onclick = () => {
    const enabled = bar.querySelector('#sensitive-enabled').checked
    const selectedTypes = Array.from(bar.querySelectorAll('[data-sensitive-type]'))
      .filter(cb => cb.checked)
      .map(cb => cb.dataset.sensitiveType)
    saveSensitiveDetectConfig({ enabled, types: selectedTypes })
    toast(`✓ ${t('sensitive.settings_save')}`, 'success')
  }
}

export function cleanup() {
  _detachThemeListener?.()
  _detachThemeListener = null
}

async function loadAll(page) {
  const tasks = [loadAppearance(page), loadProxyConfig(page), loadModelProxyConfig(page)]
  tasks.push(loadRegistry(page), loadGitPath(page))
  if (isTauri) tasks.push(loadAutostart(page))
  await Promise.all(tasks)
}

async function loadAppearance(page) {
  renderThemeBar(page.querySelector('#theme-bar'))
  loadUserCssBar(page)
}

async function loadUserCssBar(page) {
  const bar = page.querySelector('#user-css-bar')
  if (!bar) return
  const enabled = isUserCssEnabled()
  let cssPath = ''
  let hasContent = false
  try {
    const [path, content] = await Promise.all([
      api.getUserCssPath(),
      api.readUserCss(),
    ])
    cssPath = path || ''
    hasContent = !!(content && content.trim())
  } catch {
    // Web 模式或后端未启动 — 只展示开关,不显示路径
  }

  bar.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div style="flex:1;min-width:200px">
          <div style="font-size:var(--font-size-base);color:var(--text-primary);margin-bottom:4px">${t('pages.settings.user_css_toggle_label')}</div>
          <div class="form-hint">${t('pages.settings.user_css_toggle_hint')}</div>
        </div>
        <label class="apple-switch" style="cursor:pointer;display:flex;align-items:center;gap:8px">
          <input type="checkbox" id="user-css-toggle" ${enabled ? 'checked' : ''}>
          <span style="color:var(--text-body-secondary);font-size:var(--font-size-sm)">${enabled ? t('common.enabled') : t('common.disabled')}</span>
        </label>
      </div>
      ${cssPath ? `
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <code style="flex:1;min-width:200px;padding:6px 10px;background:var(--bg-tertiary);border-radius:6px;font-size:var(--font-size-xs);font-family:var(--font-mono);word-break:break-all">${escapeHtml(cssPath)}</code>
        <button class="btn btn-secondary btn-sm" id="btn-user-css-open" ${isTauri ? '' : 'disabled'}>${t('pages.settings.user_css_open')}</button>
        <button class="btn btn-secondary btn-sm" id="btn-user-css-reload">${t('pages.settings.user_css_reload')}</button>
      </div>
      <div class="form-hint">
        ${hasContent ? t('pages.settings.user_css_has_content') : t('pages.settings.user_css_no_content')}
      </div>
      ` : `<div class="form-hint">${t('pages.settings.user_css_web_notice')}</div>`}
    </div>
  `

  // 绑定事件
  const toggle = bar.querySelector('#user-css-toggle')
  if (toggle) {
    toggle.addEventListener('change', async (e) => {
      setUserCssEnabled(e.target.checked)
      await loadUserCssBar(page)
      toast(e.target.checked ? t('pages.settings.user_css_enabled_toast') : t('pages.settings.user_css_disabled_toast'), 'success')
    })
  }

  const openBtn = bar.querySelector('#btn-user-css-open')
  if (openBtn && cssPath) {
    openBtn.addEventListener('click', async () => {
      try {
        // 若文件不存在,先创建(写入空内容)
        if (!hasContent) {
          await api.writeUserCss('/* 在此写入自定义 CSS,会覆盖 Apple Design token */\n/* 示例:覆盖主色 */\n/*\n:root {\n  --accent-blue: #ff3b30;\n}\n*/\n')
        }
        const { open } = await import('@tauri-apps/plugin-shell')
        await open(cssPath)
      } catch (e) {
        toast(t('pages.settings.user_css_open_failed', { error: String(e) }), 'error')
      }
    })
  }

  const reloadBtn = bar.querySelector('#btn-user-css-reload')
  if (reloadBtn) {
    reloadBtn.addEventListener('click', async () => {
      reloadBtn.disabled = true
      await reloadUserCss()
      await loadUserCssBar(page)
      toast(t('pages.settings.user_css_reloaded'), 'success')
    })
  }
}

function renderThemeBar(bar) {
  if (!bar) return
  const currentPreset = getThemePreset()
  const checkIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="18" height="18"><path d="M5 12.5l4.2 4.2L19 7"/></svg>'
  bar.innerHTML = `
    <div class="theme-grid">
      ${getThemeOptions().map(option => {
        const active = option.id === currentPreset ? ' active' : ''
        const toneLabel = option.tone === 'dark' ? '深色预设' : '浅色预设'
        const swatches = option.swatches.map(color => `<span class="theme-card-swatch" style="background:${color}"></span>`).join('')
        return `<button type="button" class="theme-card${active}" data-theme-preset="${option.id}" aria-pressed="${option.id === currentPreset ? 'true' : 'false'}">
          <span class="theme-card-head">
            <span>
              <span class="theme-card-title">${escapeHtml(option.label)}</span>
              <span class="theme-card-desc">${escapeHtml(option.description)}</span>
            </span>
            <span class="theme-card-check">${checkIcon}</span>
          </span>
          <span class="theme-card-preview">${swatches}</span>
          <span class="theme-card-caption">${toneLabel}</span>
        </button>`
      }).join('')}
    </div>
    <div class="form-hint" style="margin-top:var(--space-md)">
      主题会立即应用到当前界面，并保存在本机浏览器 / 桌面端 WebView 的本地偏好中。
    </div>
  `
}

// 授权面板 — 社区版移除

// ===== 网络代理 =====

async function loadProxyConfig(page) {
  const bar = page.querySelector('#proxy-bar')
  if (!bar) return
  try {
    const cfg = await api.readPanelConfig()
    const proxyUrl = cfg?.networkProxy?.url || ''
    bar.innerHTML = `
      <div style="display:flex;align-items:center;gap:var(--space-sm);flex-wrap:wrap">
        <input class="form-input" data-name="proxy-url" placeholder="http://127.0.0.1:7897" value="${escapeHtml(proxyUrl)}" style="max-width:360px">
        <button class="btn btn-pill-filled btn-sm" data-action="save-proxy">保存</button>
        <button class="btn btn-secondary btn-sm" data-action="test-proxy" ${proxyUrl ? '' : 'disabled'}>测试连通</button>
        <button class="btn btn-secondary btn-sm" data-action="clear-proxy" ${proxyUrl ? '' : 'disabled'}>关闭代理</button>
      </div>
      <div id="proxy-test-result" style="margin-top:var(--space-xs);font-size:var(--font-size-xs);min-height:20px"></div>
      <div class="form-hint" style="margin-top:var(--space-xs)">
        设置后，npm 安装/升级、版本检测、GitHub/Gitee 更新检查、ClawHub Skills 等下载类操作会走此代理。自动绕过 localhost 和内网地址。保存后新请求立即生效；如 Gateway 正在运行，建议重启一次服务。
      </div>
    `
  } catch (e) {
    bar.innerHTML = `<div style="color:var(--error)">加载失败: ${escapeHtml(String(e))}</div>`
  }
}

// ===== 模型请求代理 =====

async function loadModelProxyConfig(page) {
  const bar = page.querySelector('#model-proxy-bar')
  if (!bar) return
  try {
    const cfg = await api.readPanelConfig()
    const proxyUrl = cfg?.networkProxy?.url || ''
    const modelProxy = !!cfg?.networkProxy?.proxyModelRequests
    const hasProxy = !!proxyUrl

    bar.innerHTML = `
      <div style="display:flex;align-items:center;gap:var(--space-sm);flex-wrap:wrap">
        <label style="display:flex;align-items:center;gap:6px;font-size:var(--font-size-sm);cursor:pointer">
          <input type="checkbox" data-name="model-proxy-toggle" ${modelProxy ? 'checked' : ''} ${hasProxy ? '' : 'disabled'}>
          模型测试和模型列表请求也走代理
        </label>
        <button class="btn btn-pill-filled btn-sm" data-action="save-model-proxy">保存</button>
      </div>
      <div class="form-hint" style="margin-top:var(--space-xs)">
        ${hasProxy
          ? '默认关闭。部分用户的模型 API 地址本身就是国内中转或内网地址，走代理反而会连接失败。只有当你的模型服务商需要翻墙访问时才建议开启。'
          : '请先在上方设置网络代理地址后，才能启用此选项。'
        }
      </div>
    `
  } catch (e) {
    bar.innerHTML = `<div style="color:var(--error)">加载失败: ${escapeHtml(String(e))}</div>`
  }
}

// ===== npm 源设置 =====

async function loadRegistry(page) {
  const bar = page.querySelector('#registry-bar')
  try {
    const current = await api.getNpmRegistry()
    const isPreset = REGISTRIES.some(r => r.value === current)
    bar.innerHTML = `
      <div style="display:flex;align-items:center;gap:var(--space-sm);flex-wrap:wrap">
        <select class="form-input" data-name="registry" style="max-width:320px">
          ${REGISTRIES.map(r => `<option value="${r.value}" ${r.value === current ? 'selected' : ''}>${r.label}</option>`).join('')}
          <option value="custom" ${!isPreset ? 'selected' : ''}>自定义</option>
        </select>
        <input class="form-input" data-name="custom-registry" placeholder="https://..." value="${isPreset ? '' : escapeHtml(current)}" style="max-width:320px;${isPreset ? 'display:none' : ''}">
        <button class="btn btn-pill-filled btn-sm" data-action="save-registry">保存</button>
      </div>
      <div class="form-hint" style="margin-top:var(--space-xs)">升级和版本检测使用此源下载 npm 包，国内用户推荐淘宝镜像</div>
    `
    const select = bar.querySelector('[data-name="registry"]')
    const customInput = bar.querySelector('[data-name="custom-registry"]')
    select.onchange = () => {
      customInput.style.display = select.value === 'custom' ? '' : 'none'
    }
  } catch (e) {
    bar.innerHTML = `<div style="color:var(--error)">加载失败: ${escapeHtml(String(e))}</div>`
  }
}

// ===== 事件绑定 =====

function bindEvents(page) {
  // 语言选择器
  const localeSelect = page.querySelector('#locale-select')
  if (localeSelect) {
    localeSelect.addEventListener('change', (e) => {
      setLocale(e.target.value)
    })
  }

  page.addEventListener('click', async (e) => {
    const themeCard = e.target.closest('.theme-card[data-theme-preset]')
    if (themeCard) {
      setThemePreset(themeCard.dataset.themePreset)
      return
    }

    const btn = e.target.closest('[data-action]')
    if (!btn) return
    const action = btn.dataset.action
    btn.disabled = true
    try {
      switch (action) {
        case 'save-proxy':
          await handleSaveProxy(page)
          break
        case 'test-proxy':
          await handleTestProxy(page)
          break
        case 'clear-proxy':
          await handleClearProxy(page)
          break
        case 'save-model-proxy':
          await handleSaveModelProxy(page)
          break
        case 'save-registry':
          await handleSaveRegistry(page)
          break
        case 'save-git-path':
          await handleSaveGitPath(page)
          break
        case 'reset-git-path':
          await handleResetGitPath(page)
          break
        case 'scan-git-paths':
          await handleScanGitPaths(page)
          break
        case 'use-scanned-git':
          page.querySelector('[data-name="git-path"]').value = btn.dataset.gitPath || ''
          await handleSaveGitPath(page)
          break
      }
    } catch (e) {
      toast(e.toString(), 'error')
    } finally {
      btn.disabled = false
    }
  })
}

function normalizeProxyUrl(value) {
  const url = String(value || '').trim()
  if (!url) return ''
  if (!/^https?:\/\//i.test(url)) {
    throw new Error('代理地址必须以 http:// 或 https:// 开头')
  }
  return url
}

async function handleTestProxy(page) {
  const resultEl = page.querySelector('#proxy-test-result')
  if (resultEl) resultEl.innerHTML = '<span style="color:var(--text-tertiary)">正在测试代理连通性...</span>'
  try {
    const r = await api.testProxy()
    if (resultEl) {
      resultEl.innerHTML = r.ok
        ? `<span style="color:var(--success)">✓ 代理连通（HTTP ${r.status}，耗时 ${r.elapsed_ms}ms）→ ${escapeHtml(r.target)}</span>`
        : `<span style="color:var(--warning)">⚠ 代理可达但返回异常（HTTP ${r.status}，${r.elapsed_ms}ms）</span>`
    }
  } catch (e) {
    if (resultEl) resultEl.innerHTML = `<span style="color:var(--error)">✗ ${escapeHtml(String(e))}</span>`
  }
}

async function handleSaveProxy(page) {
  const input = page.querySelector('[data-name="proxy-url"]')
  const proxyUrl = normalizeProxyUrl(input?.value || '')
  if (!proxyUrl) {
    toast('请输入代理地址，或点击"关闭代理"', 'error')
    return
  }
  const cfg = await api.readPanelConfig()
  if (!cfg.networkProxy || typeof cfg.networkProxy !== 'object') {
    cfg.networkProxy = {}
  }
  cfg.networkProxy.url = proxyUrl
  await api.writePanelConfig(cfg)
  toast('网络代理已保存；如 Gateway 正在运行，建议重启服务', 'success')
  await loadProxyConfig(page)
  await loadModelProxyConfig(page)
}

async function handleClearProxy(page) {
  const cfg = await api.readPanelConfig()
  delete cfg.networkProxy
  await api.writePanelConfig(cfg)
  toast('网络代理已关闭', 'success')
  await loadProxyConfig(page)
  await loadModelProxyConfig(page)
}

async function handleSaveModelProxy(page) {
  const toggle = page.querySelector('[data-name="model-proxy-toggle"]')
  const checked = toggle?.checked || false
  const cfg = await api.readPanelConfig()
  if (!cfg.networkProxy || typeof cfg.networkProxy !== 'object') {
    cfg.networkProxy = {}
  }
  cfg.networkProxy.proxyModelRequests = checked
  await api.writePanelConfig(cfg)
  toast(checked ? '模型请求将走代理' : '模型请求已关闭代理', 'success')
}

async function handleSaveRegistry(page) {
  const select = page.querySelector('[data-name="registry"]')
  const customInput = page.querySelector('[data-name="custom-registry"]')
  const registry = select.value === 'custom' ? customInput.value.trim() : select.value
  if (!registry) { toast('请输入源地址', 'error'); return }
  await api.setNpmRegistry(registry)
  toast('npm 源已保存', 'success')
}

// ===== Git 路径 =====

async function loadGitPath(page) {
  const bar = page.querySelector('#git-path-bar')
  if (!bar) return
  try {
    const [gitInfo, cfg] = await Promise.all([api.checkGit(), api.readPanelConfig()])
    const customValue = cfg?.gitPath || ''
    const invalidCustom = gitInfo.isCustom && !gitInfo.installed
    const statusText = gitInfo.installed
      ? `<span style="color:var(--success)">✓ ${escapeHtml(gitInfo.version || 'Git')}</span>`
      : invalidCustom
        ? `<span style="color:var(--error)">✗ 指定的 Git 路径不存在</span>`
        : `<span style="color:var(--error)">✗ Git 未安装</span>`
    const pathText = gitInfo.path ? `<span style="font-size:var(--font-size-xs);opacity:0.7">${escapeHtml(gitInfo.path)}</span>` : ''
    const customBadge = gitInfo.isCustom ? `<span class="badge" style="margin-left:6px;font-size:10px">自定义</span>` : ''
    bar.innerHTML = `
      <div class="stat-card" style="padding:16px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          ${statusText}${customBadge}
        </div>
        ${pathText ? `<div style="margin-bottom:10px">${pathText}</div>` : ''}
        <p style="font-size:var(--font-size-xs);color:var(--text-tertiary);margin-bottom:12px;line-height:1.5">自定义 Git 可执行文件路径。留空则自动从系统 PATH 中查找。当系统找不到 Git 时，可在此手动指定完整路径。</p>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input class="input" data-name="git-path" value="${escapeHtml(customValue)}" placeholder="留空自动检测，例如 /usr/local/bin/git" style="flex:1;min-width:200px">
          <button class="btn btn-pill-filled btn-sm" data-action="save-git-path">保存</button>
          <button class="btn btn-secondary btn-sm" data-action="reset-git-path">恢复默认</button>
          <button class="btn btn-secondary btn-sm" data-action="scan-git-paths">扫描</button>
        </div>
        <div id="git-scan-results"></div>
      </div>`
  } catch (e) {
    bar.innerHTML = `<div class="stat-card" style="padding:16px;color:var(--error)">${e}</div>`
  }
}

async function handleSaveGitPath(page) {
  const input = page.querySelector('[data-name="git-path"]')
  const value = (input?.value || '').trim()
  const cfg = await api.readPanelConfig()
  if (value) {
    cfg.gitPath = value
  } else {
    delete cfg.gitPath
  }
  await api.writePanelConfig(cfg)
  toast(value ? 'Git 路径已保存，正在验证...' : '已恢复 Git 自动检测', 'success')
  await loadGitPath(page)
}

async function handleScanGitPaths(page) {
  const container = page.querySelector('#git-scan-results')
  if (!container) return
  container.innerHTML = `<div style="margin-top:10px;font-size:12px;color:var(--text-secondary)">正在扫描…</div>`
  try {
    const results = await api.scanGitPaths()
    if (!results || results.length === 0) {
      container.innerHTML = `<div style="margin-top:10px;font-size:12px;color:var(--text-tertiary)">未找到 Git 安装</div>`
      return
    }
    container.innerHTML = `<div style="margin-top:10px;display:flex;flex-direction:column;gap:6px">${results.map(r =>
      `<div style="display:flex;align-items:center;gap:8px;font-size:12px;padding:6px 8px;background:var(--bg-tertiary);border-radius:var(--radius-sm)">
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(r.path)}">${escapeHtml(r.path)}</span>
        <span style="color:var(--text-tertiary);flex-shrink:0">${escapeHtml(r.version || '')}</span>
        <span class="badge" style="font-size:10px;flex-shrink:0">${escapeHtml(r.source)}</span>
        <button class="btn btn-primary btn-sm" style="padding:2px 8px;font-size:11px" data-action="use-scanned-git" data-git-path="${escapeHtml(r.path)}">使用</button>
      </div>`
    ).join('')}</div>`
  } catch (e) {
    container.innerHTML = `<div style="margin-top:10px;font-size:12px;color:var(--error)">${e}</div>`
  }
}

async function handleResetGitPath(page) {
  const cfg = await api.readPanelConfig()
  delete cfg.gitPath
  await api.writePanelConfig(cfg)
  toast('已恢复 Git 自动检测', 'success')
  await loadGitPath(page)
}

// ===== 开机自启 =====

async function loadAutostart(page) {
  const bar = page.querySelector('#autostart-bar')
  if (!bar) return
  try {
    const { isEnabled, enable, disable } = await import('@tauri-apps/plugin-autostart')
    const enabled = await isEnabled()
    bar.innerHTML = `
      <div style="display:flex;align-items:center;gap:var(--space-sm)">
        <label style="display:flex;align-items:center;gap:6px;font-size:var(--font-size-sm);cursor:pointer">
          <input type="checkbox" id="autostart-toggle" ${enabled ? 'checked' : ''}>
          系统启动时自动运行 ${BRAND_NAME}
        </label>
      </div>
      <div class="form-hint" style="margin-top:var(--space-xs)">
        开启后，电脑重启时 ${BRAND_NAME} 会自动启动并检测 Gateway 状态
      </div>
    `
    bar.querySelector('#autostart-toggle')?.addEventListener('change', async (e) => {
      try {
        if (e.target.checked) {
          await enable()
          toast('已开启开机自启', 'success')
        } else {
          await disable()
          toast('已关闭开机自启', 'success')
        }
      } catch (err) {
        e.target.checked = !e.target.checked
        toast('设置失败: ' + err, 'error')
      }
    })
  } catch {
    bar.innerHTML = '<div style="color:var(--text-tertiary);font-size:var(--font-size-sm)">当前环境不支持开机自启</div>'
  }
}
