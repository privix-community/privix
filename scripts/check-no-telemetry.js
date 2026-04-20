#!/usr/bin/env node
/**
 * Privix Community — 零遥测守卫 (Zero-Telemetry Guardian)
 *
 * 扫描 src/ / src-tauri/src/ / scripts/ 下所有硬编码 URL,
 * 把其中的主机(host)与 scripts/telemetry-allowlist.txt 比对。
 * 任一 host 未登记即失败退出,阻断 commit / CI。
 *
 * 目的:
 *   防止有人(含 AI 贡献者)在不提 PR 讨论的情况下把遥测 / 分析 /
 *   错误上报 / 心跳 / 在线许可 / 自动更新等 phone-home 端点塞回仓库。
 *
 * 用法:
 *   node scripts/check-no-telemetry.js
 *
 * 退出码:
 *   0  全部通过
 *   1  有未登记 host
 *   2  allowlist 文件缺失 / 读取失败
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, extname, relative } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const SCAN_DIRS = ['src', 'src-tauri/src', 'scripts']
const SCAN_EXTS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.rs', '.html', '.json', '.toml', '.sh'])
const EXCLUDE_DIR = /[\\/](node_modules|target|dist|gen|\.git)[\\/]/
const ALLOWLIST_PATH = join(ROOT, 'scripts/telemetry-allowlist.txt')
const URL_RE = /https?:\/\/([a-zA-Z0-9.\-]+)/g

function loadAllowlist() {
  let raw
  try {
    raw = readFileSync(ALLOWLIST_PATH, 'utf8')
  } catch {
    console.error(`错误:allowlist 文件不存在:${relative(ROOT, ALLOWLIST_PATH)}`)
    process.exit(2)
  }
  return raw
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
}

function hostAllowed(host, patterns) {
  for (const pat of patterns) {
    if (pat === host) return true
    if (pat.startsWith('*.') && host.endsWith(pat.slice(1))) return true
  }
  return false
}

// 占位符如 `https://...` 不是真实域名,跳过
function isRealHost(host) {
  if (!/[a-zA-Z]/.test(host) && !/^\d+\.\d+\.\d+\.\d+$/.test(host)) return false
  return true
}

// RFC1918 私网段 / 回环 / 链路本地 — 按定义不可能外联遥测,直接放行
function isPrivateIp(host) {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(host)) return false
  const p = host.split('.').map(Number)
  if (p[0] === 10) return true
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true
  if (p[0] === 192 && p[1] === 168) return true
  if (p[0] === 127) return true
  if (p[0] === 169 && p[1] === 254) return true
  return false
}

function walk(dir, out) {
  let entries
  try { entries = readdirSync(dir) } catch { return }
  for (const name of entries) {
    if (name.startsWith('.')) continue
    const p = join(dir, name)
    if (EXCLUDE_DIR.test(`/${p}/`)) continue
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, out)
    else if (SCAN_EXTS.has(extname(p))) out.push(p)
  }
}

function scan(files, patterns) {
  const violations = new Map()
  for (const file of files) {
    let content
    try { content = readFileSync(file, 'utf8') } catch { continue }
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      URL_RE.lastIndex = 0
      let m
      while ((m = URL_RE.exec(line)) !== null) {
        const host = m[1].toLowerCase()
        if (!isRealHost(host)) continue
        if (isPrivateIp(host)) continue
        if (hostAllowed(host, patterns)) continue
        if (!violations.has(host)) violations.set(host, [])
        violations.get(host).push({
          file: relative(ROOT, file),
          line: i + 1,
          url: m[0],
        })
      }
    }
  }
  return violations
}

const patterns = loadAllowlist()
const files = []
for (const dir of SCAN_DIRS) walk(join(ROOT, dir), files)

const violations = scan(files, patterns)

if (violations.size === 0) {
  console.log(`✓ 零遥测守卫通过 — 扫描 ${files.length} 个文件,allowlist ${patterns.length} 条`)
  process.exit(0)
}

console.error(`✗ 零遥测守卫失败 — 发现 ${violations.size} 个未登记 host:\n`)
for (const [host, occurrences] of [...violations.entries()].sort()) {
  console.error(`  ${host}`)
  for (const o of occurrences.slice(0, 3)) {
    console.error(`    ${o.file}:${o.line}  ${o.url}`)
  }
  if (occurrences.length > 3) console.error(`    ... (+${occurrences.length - 3} 条)`)
  console.error('')
}
console.error('处理方式:')
console.error('  1. 如果是合法外部资源(模型 API 默认值 / 文档链接 / OSS 仓库引用),')
console.error('     编辑 scripts/telemetry-allowlist.txt 添加该 host。')
console.error('  2. 如果是遥测 / 分析 / phone-home / 自动更新,请删除或替换为用户可配置值。')
console.error('  3. PR reviewer 必须逐行审查 allowlist 改动。')
process.exit(1)
