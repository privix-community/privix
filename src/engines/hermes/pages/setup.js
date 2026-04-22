/**
 * Hermes Agent 一键安装/配置向导
 *
 * 状态机: detect → install → configure → gateway → complete
 */
import { t } from '../../../lib/i18n.js'
import { api, invalidate } from '../../../lib/tauri-api.js'
import { PROVIDER_PRESETS } from '../../../lib/model-presets.js'
import { getActiveEngine } from '../../../lib/engine-manager.js'

// SVG 图标
const ICONS = {
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.5" width="16" height="16"><polyline points="20 6 9 17 4 12"/></svg>`,
  warn: `<svg viewBox="0 0 24 24" fill="none" stroke="var(--warning)" stroke-width="2" width="16" height="16"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  error: `<svg viewBox="0 0 24 24" fill="none" stroke="var(--error)" stroke-width="2" width="16" height="16"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
  spinner: `<svg class="hermes-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M12 2a10 10 0 0110 10"/></svg>`,
  rocket: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 00-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 012-3.95A12.88 12.88 0 0122 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 01-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg>`,
  done: `<svg viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" width="24" height="24"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
}

// 核心安装不带 extras，后续可在管理页面按需安装

// Hermes 使用 OpenAI 兼容接口，过滤出兼容的服务商
const HERMES_PROVIDERS = PROVIDER_PRESETS.filter(p => !p.hidden)

export function render() {
  const el = document.createElement('div')
  el.className = 'page'

  // 状态
  let phase = 'detect' // detect | install | configure | gateway | complete
  let pyInfo = null
  let hermesInfo = null
  let logs = []
  let installing = false
  let installError = null
  let installMode = 'local' // 'local' | 'custom'
  let customGatewayUrl = 'http://127.0.0.1:8642'
  let progress = 0
  let unlisten = null

  function draw() {
    el.innerHTML = `
      <div class="page-header">
        <h1>${t('comp.header.page_setup')}</h1>
        <p class="page-desc">${t('pages.engine.hermesSetupDesc')}</p>
      </div>
      <div class="hermes-setup-shell">
        ${renderPhaseIndicator()}
        ${phase === 'detect' ? renderDetect() : ''}
        ${phase === 'install' ? renderInstall() : ''}
        ${phase === 'configure' ? renderConfigure() : ''}
        ${phase === 'gateway' ? renderGateway() : ''}
        ${phase === 'complete' ? renderComplete() : ''}
        <div class="hermes-setup-doclink">
          <a href="https://hermes-agent.nousresearch.com/docs/getting-started/installation/" target="_blank" rel="noopener">
            ${t('pages.engine.hermesSetupDocLink')} →
          </a>
        </div>
      </div>`
    bind()
  }

  // --- 阶段指示器 ---
  function renderPhaseIndicator() {
    const phases = [
      { id: 'detect', label: t('pages.engine.phaseDetect') },
      { id: 'install', label: t('pages.engine.phaseInstall') },
      { id: 'configure', label: t('pages.engine.phaseConfigure') },
      { id: 'gateway', label: t('pages.engine.phaseGateway') },
      { id: 'complete', label: t('pages.engine.phaseComplete') },
    ]
    const idx = phases.findIndex(p => p.id === phase)
    return `<div class="hermes-phases">${phases.map((p, i) => {
      const cls = i < idx ? 'done' : i === idx ? 'active' : ''
      const clickable = i < idx ? `data-goto-phase="${p.id}" style="cursor:pointer" title="${t('pages.engine.hermesPhaseClickHint')}"` : ''
      return `<div class="hermes-phase ${cls}" ${clickable}>
        <span class="hermes-phase-dot">${i < idx ? ICONS.check : i + 1}</span>
        <span class="hermes-phase-label">${p.label}</span>
      </div>`
    }).join('<div class="hermes-phase-line"></div>')}</div>`
  }

  // --- 检测阶段 ---
  function renderDetect() {
    const rows = []
    if (!pyInfo && !hermesInfo) {
      rows.push(`<div class="hermes-detect-row">${ICONS.spinner} <span>${t('pages.engine.detecting')}</span></div>`)
    } else {
      // Python
      if (pyInfo) {
        if (pyInfo.installed && pyInfo.versionOk) {
          rows.push(`<div class="hermes-detect-row ok">${ICONS.check} <span>${t('pages.engine.pythonFound', { version: pyInfo.version })}</span></div>`)
        } else if (pyInfo.installed && !pyInfo.versionOk) {
          rows.push(`<div class="hermes-detect-row warn">${ICONS.warn} <span>${t('pages.engine.pythonTooOld', { version: pyInfo.version })}</span></div>`)
        } else {
          rows.push(`<div class="hermes-detect-row warn">${ICONS.warn} <span>${t('pages.engine.pythonNotFound')}</span></div>`)
        }
        // uv
        if (pyInfo.hasUv) {
          rows.push(`<div class="hermes-detect-row ok">${ICONS.check} <span>${t('pages.engine.uvFound')}</span></div>`)
        } else {
          rows.push(`<div class="hermes-detect-row warn">${ICONS.warn} <span>${t('pages.engine.uvNotFound')}</span></div>`)
        }
        // git（从 GitHub 安装需要）
        if (pyInfo.hasGit) {
          rows.push(`<div class="hermes-detect-row ok">${ICONS.check} <span>${t('pages.engine.gitFound')}</span></div>`)
        } else {
          rows.push(`<div class="hermes-detect-row warn">${ICONS.error} <span>${t('pages.engine.gitNotFound')}</span></div>`)
        }
      }
      // Hermes
      if (hermesInfo) {
        if (hermesInfo.installed) {
          rows.push(`<div class="hermes-detect-row ok">${ICONS.check} <span>${t('pages.engine.hermesFound', { version: hermesInfo.version })}</span></div>`)
          if (hermesInfo.gatewayRunning) {
            rows.push(`<div class="hermes-detect-row ok">${ICONS.check} <span>${t('pages.engine.hermesReady')}</span></div>`)
          }
        } else {
          rows.push(`<div class="hermes-detect-row">${ICONS.warn} <span>${t('pages.engine.hermesNotFound')}</span></div>`)
        }
      }
    }
    return `<div class="card hermes-setup-card">
      <div class="card-body hermes-setup-card-body">
        <p class="hermes-card-intro">${t('pages.engine.hermesSetupIntro')}</p>
        <div class="hermes-detect-list">${rows.join('')}</div>
      </div>
    </div>`
  }

  // --- 安装阶段 ---
  function renderInstall() {
    // 模式切换按钮
    const modeSwitch = `
      <div class="hermes-mode-switch">
        <button class="btn btn-sm hermes-mode-btn ${installMode === 'local' ? 'btn-primary' : 'btn-secondary'}" data-mode="local">
          <svg class="hermes-mode-btn__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
          ${t('pages.engine.installModeLocal')}
        </button>
        <button class="btn btn-sm hermes-mode-btn ${installMode === 'custom' ? 'btn-primary' : 'btn-secondary'}" data-mode="custom">
          <svg class="hermes-mode-btn__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>
          ${t('pages.engine.installModeCustom')}
        </button>
      </div>`

    if (installMode === 'custom') {
      // 自定义模式：输入已有 Gateway 地址
      return `<div class="card hermes-setup-card">
        <div class="card-body hermes-setup-card-body">
          <h3 class="hermes-card-title">${t('pages.engine.installTitle')}</h3>
          <p class="hermes-card-subtitle">${t('pages.engine.installCustomDesc')}</p>
          ${modeSwitch}
          ${installError ? `
            <div class="hermes-alert hermes-alert--error">
              ${esc(installError)}
            </div>
          ` : ''}
          <div class="hermes-form">
            <label class="hermes-field">
              <span>Gateway URL</span>
              <input type="text" id="hm-custom-url" class="input" placeholder="http://127.0.0.1:8642" value="${esc(customGatewayUrl)}">
              <div class="hermes-field-hint">${t('pages.engine.installCustomHint')}</div>
            </label>
          </div>
          <div class="hermes-setup-actions">
            <button class="btn btn-primary hermes-custom-connect" ${installing ? 'disabled' : ''}>${installing ? ICONS.spinner + ' ' + t('pages.engine.installCustomTesting') : t('pages.engine.installCustomConnect')}</button>
          </div>
        </div>
      </div>`
    }

    // 本地模式：一键安装
    const btnText = installing ? `${ICONS.spinner} ${t('pages.engine.installingBtn')}` : `${ICONS.rocket} ${t('pages.engine.installBtn')}`
    const btnDisabled = installing ? 'disabled' : ''

    // 错误提示块
    const errorBlock = installError ? `
      <div class="hermes-alert hermes-alert--error hermes-alert--rich">
        <div class="hermes-alert__row">
          ${ICONS.error}
          <div>
            <div class="hermes-alert__title">${t('pages.engine.installFailed')}</div>
            <div class="hermes-alert__body">${esc(installError)}</div>
          </div>
        </div>
      </div>
    ` : ''

    // 进度 + 日志区（安装中或安装失败后都显示）
    const hasLogs = installing || logs.length > 0
    const progressBlock = hasLogs ? `
      <div class="hermes-install-status">
        <div class="hermes-progress"><div class="hermes-progress-bar${installError ? ' error' : ''}" style="width:${progress}%"></div></div>
        <div class="hermes-progress-meta">
          <span class="hermes-progress-text ${installError ? 'is-error' : ''}">${installError ? t('pages.engine.installFailed') : progress >= 100 ? t('pages.engine.installSuccess') : t('pages.engine.installingBtn')}</span>
          <span class="hermes-progress-pct">${Math.min(progress, 100)}%</span>
        </div>
      </div>
      <div class="hermes-log-panel hermes-log-panel--spaced">
        <div class="hermes-log-content">${logs.map(l => `<div>${esc(l)}</div>`).join('')}</div>
      </div>
    ` : `
      <div class="hermes-install-info">
        <div class="hermes-detect-row hermes-detect-row--compact">${ICONS.check} <span>${t('pages.engine.installInfoUv')}</span></div>
        <div class="hermes-detect-row hermes-detect-row--compact">${ICONS.check} <span>${t('pages.engine.installInfoCore')}</span></div>
        <div class="hermes-detect-row hermes-detect-row--muted">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <span>${t('pages.engine.installInfoExtrasLater')}</span>
        </div>
      </div>
    `

    return `<div class="card hermes-setup-card">
      <div class="card-body hermes-setup-card-body">
        <h3 class="hermes-card-title">${t('pages.engine.installTitle')}</h3>
        <p class="hermes-card-subtitle">${t('pages.engine.installDescSimple')}</p>
        ${modeSwitch}
        ${errorBlock}
        ${progressBlock}
        <div class="hermes-setup-actions">
          <button class="btn btn-primary hermes-install-btn" ${btnDisabled}>${installError ? `${ICONS.rocket} ${t('pages.engine.retryBtn')}` : btnText}</button>
        </div>
      </div>
    </div>`
  }

  // --- 配置阶段 ---
  function renderConfigure() {
    const presetBtns = HERMES_PROVIDERS.map(p =>
      `<button class="btn btn-sm btn-secondary hermes-preset-btn" data-key="${p.key}" data-url="${p.baseUrl}" data-api="${p.api}">${p.label}${p.badge ? ` <span class="hermes-preset-badge">${p.badge}</span>` : ''}</button>`
    ).join('')

    return `<div class="card hermes-setup-card">
      <div class="card-body hermes-setup-card-body">
        <h3 class="hermes-card-title">${t('pages.engine.configTitle')}</h3>
        <p class="hermes-card-subtitle">${t('pages.engine.configDesc')}</p>

        <div class="hermes-form">
          <div class="hermes-field">
            <span>${t('pages.engine.configProvider')}</span>
            <div class="hermes-preset-list">${presetBtns}</div>
            <div id="hm-preset-detail" class="hermes-preset-detail" hidden></div>
          </div>
          <label class="hermes-field">
            <span>API Base URL</span>
            <input type="text" id="hm-baseurl" class="input" placeholder="https://openrouter.ai/api/v1">
          </label>
          <div class="hermes-field">
            <span>${t('pages.engine.configApiKey')}</span>
            <div class="hermes-apikey-row">
              <input type="password" id="hm-apikey" class="input hermes-apikey-input" placeholder="sk-..." autocomplete="off">
              <button class="btn btn-sm btn-secondary hermes-fetch-models">${t('pages.engine.configFetchModels')}</button>
            </div>
          </div>
          <div id="hm-fetch-result" class="hermes-fetch-result"></div>
          <div class="hermes-field">
            <span>${t('pages.engine.configModel')}</span>
            <div class="hermes-model-field">
              <input type="text" id="hm-model" class="input" placeholder="anthropic/claude-sonnet-4-20250514" autocomplete="off">
              <div id="hm-model-dropdown" class="hermes-model-dropdown" hidden></div>
            </div>
          </div>
        </div>

        <div class="hermes-setup-actions">
          <button class="btn btn-primary hermes-config-save">${t('pages.engine.configSaveBtn')}</button>
          <button class="btn-text hermes-config-skip">${t('pages.engine.configSkipBtn')}</button>
        </div>
      </div>
    </div>`
  }

  // --- Gateway 阶段 ---
  function renderGateway() {
    const running = hermesInfo?.gatewayRunning
    // Gateway 阶段 CTA 层级:启动 Gateway 是唯一主操作;运行后 "进入仪表盘" 才是主操作,
    // 未运行时的第二按钮是可选路径,使用 .btn-text 保持一屏单主蓝
    const nextBtnClass = running ? 'btn btn-primary' : 'btn-text'
    const nextBtnLabel = running ? t('pages.engine.goToDashboard') : t('pages.engine.gatewaySkipBtn')
    return `<div class="card hermes-setup-card">
      <div class="card-body hermes-setup-card-body">
        <h3 class="hermes-card-title">${t('pages.engine.gatewayTitle')}</h3>
        <p class="hermes-card-subtitle">${t('pages.engine.gatewayDesc')}</p>
        <div class="hermes-detect-row ${running ? 'ok' : ''}">
          ${running ? ICONS.check : ICONS.warn}
          <span>${running ? t('pages.engine.gatewayRunning', { port: hermesInfo?.gatewayPort || 8642 }) : t('pages.engine.gatewayStopped')}</span>
        </div>
        <div id="hm-gw-error" class="hermes-alert hermes-alert--error hermes-alert--gw" hidden></div>
        <div class="hermes-setup-actions">
          ${!running ? `<button class="btn btn-primary hermes-gw-start">${t('pages.engine.gatewayStartBtn')}</button>` : ''}
          <button class="${nextBtnClass} hermes-gw-next">${nextBtnLabel}</button>
        </div>
      </div>
    </div>`
  }

  // --- 完成 ---
  function renderComplete() {
    return `<div class="card hermes-setup-card">
      <div class="card-body hermes-setup-card-body hermes-setup-card-body--complete">
        <div class="hermes-complete-icon">${ICONS.done}</div>
        <h3 class="hermes-card-title hermes-card-title--complete">${t('pages.engine.setupComplete')}</h3>
        <p class="hermes-card-subtitle hermes-card-subtitle--complete">${t('pages.engine.setupCompleteDesc')}</p>
        <button class="btn btn-primary hermes-go-dashboard">${t('pages.engine.goToDashboard')}</button>
      </div>
    </div>`
  }

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  // --- 事件绑定 ---
  function bind() {
    // 点击已完成的阶段指示器，跳回该步骤
    el.querySelectorAll('[data-goto-phase]').forEach(dot => {
      dot.addEventListener('click', () => {
        phase = dot.dataset.gotoPhase
        draw()
      })
    })
    // 安装模式切换
    el.querySelectorAll('.hermes-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode
        if (mode && mode !== installMode) {
          installMode = mode
          installError = null
          draw()
        }
      })
    })
    // 安装按钮（本地模式）
    el.querySelector('.hermes-install-btn')?.addEventListener('click', doInstall)
    // 自定义连接按钮
    el.querySelector('.hermes-custom-connect')?.addEventListener('click', doCustomConnect)
    // 服务商预设按钮
    el.querySelectorAll('.hermes-preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const baseUrlInput = el.querySelector('#hm-baseurl')
        if (baseUrlInput) baseUrlInput.value = btn.dataset.url
        // 高亮选中
        el.querySelectorAll('.hermes-preset-btn').forEach(b => b.classList.remove('is-active'))
        btn.classList.add('is-active')
        // 显示服务商详情
        const preset = HERMES_PROVIDERS.find(p => p.key === btn.dataset.key)
        const detailEl = el.querySelector('#hm-preset-detail')
        if (detailEl && preset) {
          let html = preset.desc ? `<div class="hermes-preset-detail__desc">${preset.desc}</div>` : ''
          if (preset.site) html += `<a class="hermes-preset-detail__site" href="${preset.site}" target="_blank" rel="noopener">→ ${preset.label} 官网</a>`
          detailEl.innerHTML = html
          detailEl.hidden = !html
        }
      })
    })
    // 获取模型列表
    el.querySelector('.hermes-fetch-models')?.addEventListener('click', doFetchModels)
    // 模型下拉选择：点击选项填入 input
    el.querySelector('#hm-model-dropdown')?.addEventListener('click', (e) => {
      const opt = e.target.closest('.hermes-model-option')
      if (!opt) return
      const modelInput = el.querySelector('#hm-model')
      if (modelInput) modelInput.value = opt.dataset.model
      el.querySelector('#hm-model-dropdown').hidden = true
    })
    // 点击 input 时如果有下拉就展开
    el.querySelector('#hm-model')?.addEventListener('focus', () => {
      const dd = el.querySelector('#hm-model-dropdown')
      if (dd && dd.children.length > 0) dd.hidden = false
    })
    // 点击其他地方关闭下拉
    document.addEventListener('click', (e) => {
      const dd = el.querySelector('#hm-model-dropdown')
      if (dd && !e.target.closest('.hermes-field')) dd.hidden = true
    })
    // 配置保存
    el.querySelector('.hermes-config-save')?.addEventListener('click', doSaveConfig)
    el.querySelector('.hermes-config-skip')?.addEventListener('click', () => { phase = 'gateway'; refreshHermes() })
    // Gateway
    el.querySelector('.hermes-gw-start')?.addEventListener('click', doStartGateway)
    el.querySelector('.hermes-gw-next')?.addEventListener('click', () => {
      if (hermesInfo?.gatewayRunning) { phase = 'complete'; draw() }
      else { phase = 'complete'; draw() }
    })
    // 仪表盘
    el.querySelector('.hermes-go-dashboard')?.addEventListener('click', async () => {
      const engine = getActiveEngine()
      if (engine?.detect) await engine.detect()
      window.location.hash = '#/h/dashboard'
    })
    // 自动滚日志到底
    const logEl = el.querySelector('.hermes-log-content')
    if (logEl) logEl.scrollTop = logEl.scrollHeight
  }

  // --- 检测流程 ---
  async function detect() {
    phase = 'detect'
    draw()
    try {
      invalidate('check_hermes', 'check_python')
      const [py, hm] = await Promise.all([api.checkPython(), api.checkHermes()])
      pyInfo = py
      hermesInfo = hm

      draw()

      // 自动跳转到最合适的阶段（不自动离开向导，让用户可以查看和回退每一步）
      await new Promise(r => setTimeout(r, 800))
      if (hm.installed && hm.gatewayRunning) {
        phase = 'complete'
      } else if (hm.installed && hm.configExists) {
        phase = 'gateway'
      } else if (hm.installed) {
        phase = 'configure'
      } else {
        phase = 'install'
      }
      draw()
    } catch (e) {
      logs.push(`${t('pages.engine.detect_error')}: ${e}`)
      phase = 'install'
      draw()
    }
  }

  // --- 自定义连接流程 ---
  async function doCustomConnect() {
    const urlInput = el.querySelector('#hm-custom-url')
    const url = urlInput?.value?.trim()
    if (!url) { installError = t('pages.engine.installCustomEmpty'); draw(); return }

    // 基础 URL 格式检查
    try { new URL(url) } catch { installError = t('pages.engine.installCustomInvalidUrl'); draw(); return }

    installing = true
    installError = null
    draw()

    try {
      // 保存 Gateway URL
      await api.hermesSetGatewayUrl(url)

      // 测试连接
      const health = await api.hermesHealthCheck()
      if (!health) throw new Error(t('pages.engine.installCustomNoResponse'))

      installing = false
      customGatewayUrl = url
      // 连接成功，跳到配置步骤
      phase = 'configure'
      draw()
    } catch (e) {
      installing = false
      installError = t('pages.engine.installCustomFailed', { error: e.message || e })
      draw()
    }
  }

  // --- 安装流程 ---
  async function doInstall() {
    installing = true
    installError = null
    progress = 0
    logs = []
    draw()

    // 监听事件（Tauri 模式下有 hermes-install-log/progress 事件）
    try {
      const { listen } = await import('@tauri-apps/api/event')
      const u1 = await listen('hermes-install-log', (e) => {
        const line = String(e.payload)
        logs.push(line)
        const logEl = el.querySelector('.hermes-log-content')
        if (logEl) {
          const div = document.createElement('div')
          div.textContent = line
          logEl.appendChild(div)
          logEl.scrollTop = logEl.scrollHeight
        }
      })
      const u2 = await listen('hermes-install-progress', (e) => {
        progress = Number(e.payload) || 0
        const bar = el.querySelector('.hermes-progress-bar')
        if (bar) bar.style.width = progress + '%'
        const pctEl = el.querySelector('.hermes-progress-text')
        if (pctEl) pctEl.textContent = progress >= 100 ? t('pages.engine.installSuccess') : t('pages.engine.installingBtn')
        // 更新百分比数字
        const pctNum = bar?.parentElement?.nextElementSibling?.querySelector('span:last-child')
        if (pctNum) pctNum.textContent = Math.min(progress, 100) + '%'
      })
      unlisten = () => { u1(); u2() }
    } catch (_) {}

    try {
      await api.installHermes('uv-tool', [])
      installing = false
      progress = 100
      logs.push('✅ ' + t('pages.engine.installSuccess'))
      phase = 'configure'
      draw()
    } catch (e) {
      installing = false
      installError = String(e.message || e)
      logs.push(`❌ ${t('pages.engine.installFailed')}: ${e}`)
      draw()
    } finally {
      if (unlisten) { unlisten(); unlisten = null }
    }
  }

  // --- 获取模型列表 ---
  async function doFetchModels() {
    const btn = el.querySelector('.hermes-fetch-models')
    const resultEl = el.querySelector('#hm-fetch-result')
    const dropdown = el.querySelector('#hm-model-dropdown')
    const baseUrl = el.querySelector('#hm-baseurl')?.value?.trim()
    const apiKey = el.querySelector('#hm-apikey')?.value?.trim()

    if (!baseUrl) {
      if (resultEl) resultEl.innerHTML = `<span style="color:var(--warning)">${t('pages.engine.configFetchNeedUrl')}</span>`
      return
    }
    if (!apiKey) {
      if (resultEl) resultEl.innerHTML = `<span style="color:var(--warning)">${t('pages.engine.configFetchNeedKey')}</span>`
      return
    }

    if (btn) { btn.disabled = true; btn.textContent = t('pages.engine.configFetching') }
    if (resultEl) resultEl.innerHTML = `<span style="color:var(--text-tertiary)">${t('pages.engine.configFetching')}</span>`

    try {
      // 清理 URL：去掉尾部多余路径，确保 /models 能正确拼接
      let base = baseUrl.replace(/\/+$/, '')
      // 移除常见尾部路径
      base = base.replace(/\/(chat\/completions|completions|responses|messages|models)\/?$/, '')

      // 判断 API 类型（大部分是 OpenAI 兼容）
      const matched = HERMES_PROVIDERS.find(p => baseUrl === p.baseUrl)
      const apiType = matched?.api || 'openai-completions'

      let models = []

      if (apiType === 'anthropic-messages') {
        // Anthropic 格式
        if (!base.endsWith('/v1')) base += '/v1'
        const resp = await fetch(base + '/models', {
          headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': apiKey },
          signal: AbortSignal.timeout(15000),
        })
        if (!resp.ok) throw new Error('HTTP ' + resp.status)
        const data = await resp.json()
        models = (data.data || []).map(m => m.id).filter(Boolean).sort()
      } else if (apiType === 'google-generative-ai' || apiType === 'google-gemini') {
        // Google Gemini
        const resp = await fetch(base + '/models?key=' + apiKey, { signal: AbortSignal.timeout(15000) })
        if (!resp.ok) throw new Error('HTTP ' + resp.status)
        const data = await resp.json()
        models = (data.models || []).map(m => (m.name || '').replace('models/', '')).filter(Boolean).sort()
      } else {
        // OpenAI 兼容（大多数服务商）
        const resp = await fetch(base + '/models', {
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(15000),
        })
        if (!resp.ok) throw new Error('HTTP ' + resp.status)
        const data = await resp.json()
        models = (data.data || []).map(m => m.id).filter(Boolean).sort()
      }

      if (models.length === 0) {
        if (resultEl) resultEl.innerHTML = `<span style="color:var(--warning)">${t('pages.engine.configFetchNotSupported')}</span>`
        return
      }

      if (resultEl) resultEl.innerHTML = `<span style="color:var(--success)">✓ ${t('pages.engine.configFetchSuccess', { count: models.length })}</span>`
      if (dropdown) {
        dropdown.innerHTML = models.map(m =>
          `<div class="hermes-model-option" data-model="${m}">${m}</div>`
        ).join('')
        dropdown.hidden = false
      }
    } catch (err) {
      // 网络错误或不支持
      const msg = err.message || String(err)
      if (resultEl) {
        if (msg.includes('403') || msg.includes('404') || msg.includes('405') || msg.includes('timeout') || msg.includes('Failed to fetch')) {
          resultEl.innerHTML = `<span style="color:var(--warning)">${t('pages.engine.configFetchNotSupported')}</span>`
        } else {
          resultEl.innerHTML = `<span style="color:var(--error)">✗ ${t('pages.engine.configFetchFailed', { error: msg })}</span>`
        }
      }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = t('pages.engine.configFetchModels') }
    }
  }

  // --- 配置保存 ---
  async function doSaveConfig() {
    const baseUrl = el.querySelector('#hm-baseurl')?.value?.trim()
    const apiKey = el.querySelector('#hm-apikey')?.value?.trim()
    const model = el.querySelector('#hm-model')?.value?.trim()
    // 从 baseUrl 推断 provider key
    const matched = HERMES_PROVIDERS.find(p => baseUrl && p.baseUrl === baseUrl)
    const provider = matched?.key || 'openai'

    if (!apiKey) {
      alert('请输入 API Key')
      return
    }
    try {
      await api.configureHermes(provider, apiKey, model, baseUrl)
      phase = 'gateway'
      await refreshHermes()
    } catch (e) {
      alert(`配置保存失败: ${e}`)
    }
  }

  // --- Gateway 启动 ---
  let gwStarting = false
  async function doStartGateway() {
    const btn = el.querySelector('.hermes-gw-start')
    if (btn) { btn.disabled = true; btn.textContent = t('pages.engine.gatewayStarting') }
    gwStarting = true
    try {
      await api.hermesGatewayAction('start')
      await refreshHermes()
    } catch (e) {
      const msg = String(e).replace(/^Error:\s*/, '')
      // 在 Gateway 阶段显示错误信息
      const errEl = el.querySelector('#hm-gw-error')
      if (errEl) {
        errEl.textContent = msg || t('pages.engine.gatewayStartFailed')
        errEl.hidden = false
      } else {
        alert(msg || t('pages.engine.gatewayStartFailed'))
      }
    } finally {
      gwStarting = false
      if (btn) { btn.disabled = false; btn.textContent = t('pages.engine.gatewayStartBtn') }
    }
  }

  // --- 刷新 hermes 状态 ---
  async function refreshHermes() {
    invalidate('check_hermes')
    try { hermesInfo = await api.checkHermes() } catch (_) {}
    // 已安装且 Gateway 在运行 → 更新引擎状态并跳转仪表盘
    if (hermesInfo?.installed && hermesInfo?.gatewayRunning) {
      phase = 'complete'
      const engine = getActiveEngine()
      if (engine?.detect) await engine.detect()
      window.location.hash = '#/h/dashboard'
      return
    }
    draw()
  }

  // 启动检测
  detect()

  return el
}
