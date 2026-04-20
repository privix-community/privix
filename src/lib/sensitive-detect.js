/**
 * Privix Community — 敏感信息检测与脱敏
 *
 * 在 chat / assistant 发送前拦截消息,识别常见敏感串并让用户选择:
 *   - 掩码后发送:每项替换为 [REDACTED_XXX]
 *   - 移除包含行:整行删除
 *   - 原文发送:需二次确认
 *   - 取消:回到输入框
 *
 * 默认启用;用户可在"设置 → 隐私与安全"关闭或按类型勾选。
 */

import { t } from './i18n.js'

const STORAGE_KEY = 'privix-community-sensitive-detect'
const DEFAULT_TYPES = [
  'api_key_anthropic',
  'api_key_openai',
  'api_key_google',
  'jwt',
  'pem_private',
  'cn_id_card',
  'cn_mobile',
  'credit_card',
]

// ── 检测器 ──
// 顺序:更特化的模式放前面(如 sk-ant- 放 sk- 前),去重时保留先命中更特化项。

function validateLuhn(s) {
  const digits = s.replace(/\D/g, '')
  if (digits.length < 13 || digits.length > 19) return false
  let sum = 0
  let alt = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = parseInt(digits[i], 10)
    if (alt) { d *= 2; if (d > 9) d -= 9 }
    sum += d
    alt = !alt
  }
  return sum % 10 === 0
}

// GB 11643-1999 中国身份证 18 位校验
function validateCnIdCard(s) {
  if (s.length !== 18) return false
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
  const checksums = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2']
  let sum = 0
  for (let i = 0; i < 17; i++) sum += parseInt(s[i], 10) * weights[i]
  return s[17].toUpperCase() === checksums[sum % 11]
}

const DETECTORS = [
  { type: 'api_key_anthropic', regex: /\bsk-ant-[a-zA-Z0-9_-]{30,}\b/g },
  { type: 'api_key_openai', regex: /\bsk-[a-zA-Z0-9_-]{20,}\b/g },
  { type: 'api_key_google', regex: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { type: 'jwt', regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { type: 'pem_private', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { type: 'cn_id_card', regex: /\b[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/g, validate: validateCnIdCard },
  { type: 'cn_mobile', regex: /(?<!\d)1[3-9]\d{9}(?!\d)/g },
  { type: 'credit_card', regex: /\b(?:\d[ -]?){13,19}\b/g, validate: validateLuhn },
]

export function detectSensitive(text, { enabledTypes = DEFAULT_TYPES } = {}) {
  if (!text || typeof text !== 'string') return []
  const enabled = new Set(enabledTypes)
  const allHits = []
  for (const d of DETECTORS) {
    if (!enabled.has(d.type)) continue
    d.regex.lastIndex = 0
    let m
    while ((m = d.regex.exec(text)) !== null) {
      if (d.validate && !d.validate(m[0])) continue
      allHits.push({ type: d.type, match: m[0], index: m.index, length: m[0].length })
    }
  }
  // 去重:按起点升序 + 长度降序,后续 hit 若落在前一个区间内则丢弃
  allHits.sort((a, b) => a.index - b.index || b.length - a.length)
  const dedup = []
  let lastEnd = -1
  for (const h of allHits) {
    if (h.index >= lastEnd) { dedup.push(h); lastEnd = h.index + h.length }
  }
  return dedup
}

export function redactText(text, hits) {
  if (!hits.length) return text
  const sorted = [...hits].sort((a, b) => b.index - a.index)
  let out = text
  for (const h of sorted) {
    out = out.slice(0, h.index) + `[REDACTED_${h.type.toUpperCase()}]` + out.slice(h.index + h.length)
  }
  return out
}

export function stripLinesWithHits(text, hits) {
  if (!hits.length) return text
  const hitLines = new Set()
  for (const h of hits) hitLines.add(text.slice(0, h.index).split('\n').length - 1)
  return text.split('\n').filter((_, i) => !hitLines.has(i)).join('\n')
}

// ── 配置 ──

export function loadSensitiveDetectConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { enabled: true, types: [...DEFAULT_TYPES] }
    const parsed = JSON.parse(raw)
    return {
      enabled: parsed.enabled !== false,
      types: Array.isArray(parsed.types) ? parsed.types.filter(x => DEFAULT_TYPES.includes(x)) : [...DEFAULT_TYPES],
    }
  } catch {
    return { enabled: true, types: [...DEFAULT_TYPES] }
  }
}

export function saveSensitiveDetectConfig(cfg) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      enabled: !!cfg.enabled,
      types: Array.isArray(cfg.types) ? cfg.types : [...DEFAULT_TYPES],
    }))
  } catch { /* quota or private mode — noop */ }
}

export function listSensitiveTypes() {
  return [...DEFAULT_TYPES]
}

// ── 模态 ──

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function maskPreview(s) {
  const str = String(s)
  if (str.length <= 8) return str.slice(0, 2) + '***'
  return str.slice(0, 4) + '***' + str.slice(-4)
}

async function showSensitiveWarningModal(text, hits) {
  return new Promise((resolve) => {
    const byType = new Map()
    for (const h of hits) {
      if (!byType.has(h.type)) byType.set(h.type, [])
      byType.get(h.type).push(h.match)
    }

    const summaryHtml = [...byType.entries()].map(([type, matches]) => {
      const label = t(`sensitive.type_${type}`)
      const preview = matches.slice(0, 3).map(m => `<li><code>${escapeHtml(maskPreview(m))}</code></li>`).join('')
      const more = matches.length > 3 ? `<li>… +${matches.length - 3}</li>` : ''
      return `<div style="margin-bottom:8px"><strong>${escapeHtml(label)}</strong> × ${matches.length}<ul style="margin:4px 0 0 18px;font-size:12px;color:var(--text-secondary)">${preview}${more}</ul></div>`
    }).join('')

    const overlay = document.createElement('div')
    overlay.className = 'modal-overlay'
    overlay.innerHTML = `
      <div class="modal" style="max-width:560px">
        <div class="modal-title">⚠ ${escapeHtml(t('sensitive.title', { count: hits.length }))}</div>
        <div class="modal-body" style="font-size:13px;line-height:1.6">
          ${summaryHtml}
          <div style="margin-top:12px;padding:10px 12px;background:var(--surface-warn, rgba(255, 149, 0, 0.1));border-radius:8px;font-size:12px;color:var(--text-secondary)">
            ${escapeHtml(t('sensitive.hint'))}
          </div>
        </div>
        <div class="modal-actions" style="flex-wrap:wrap;gap:8px">
          <button class="btn btn-secondary btn-sm" data-action="cancel">${escapeHtml(t('sensitive.action_cancel'))}</button>
          <button class="btn btn-secondary btn-sm" data-action="strip">${escapeHtml(t('sensitive.action_strip'))}</button>
          <button class="btn btn-primary btn-sm" data-action="mask">${escapeHtml(t('sensitive.action_mask'))}</button>
          <button class="btn btn-danger btn-sm" data-action="send">${escapeHtml(t('sensitive.action_send'))}</button>
        </div>
      </div>
    `
    document.body.appendChild(overlay)

    const close = (result) => { overlay.remove(); resolve(result) }

    overlay.querySelector('[data-action="cancel"]').onclick = () => close({ action: 'cancel', text: null })
    overlay.querySelector('[data-action="strip"]').onclick = () => close({ action: 'strip', text: stripLinesWithHits(text, hits) })
    overlay.querySelector('[data-action="mask"]').onclick = () => close({ action: 'mask', text: redactText(text, hits) })
    overlay.querySelector('[data-action="send"]').onclick = async () => {
      const { showConfirm } = await import('../components/modal.js')
      const ok = await showConfirm(t('sensitive.confirm_send', { count: hits.length }))
      if (ok) close({ action: 'send', text })
    }
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close({ action: 'cancel', text: null }) })
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') close({ action: 'cancel', text: null }) })
    overlay.querySelector('[data-action="mask"]').focus()
  })
}

/**
 * 发送前检查入口。外部调用者:
 *   const result = await checkAndResolveSensitive(text)
 *   if (result.action === 'cancel') return // 用户取消,不发送
 *   // 否则用 result.text 发送(可能已被掩码或移除敏感行)
 */
export async function checkAndResolveSensitive(text) {
  const cfg = loadSensitiveDetectConfig()
  if (!cfg.enabled) return { action: 'send', text }
  const hits = detectSensitive(text, { enabledTypes: cfg.types })
  if (hits.length === 0) return { action: 'send', text }
  return showSensitiveWarningModal(text, hits)
}
