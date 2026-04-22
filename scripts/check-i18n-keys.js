#!/usr/bin/env node
/**
 * i18n key 校验脚本
 *
 * 功能(Phase D 扩展):
 *   - 扫描 src/**\/*.js,提取 t()/tc() 调用 key
 *   - zh-CN 缺失 → 硬阻(exit 1)
 *   - 其他 locales 缺失 → 默认软告警(可用 --strict-all-locales 转硬阻)
 *   - 检测 locale JSON 中的孤立 key(代码未引用)
 *   - 标记动态 key(模板字符串调用 `t(`...${x}`)`,无法静态校验)
 *
 * 用法:
 *   node scripts/check-i18n-keys.js                          # 全扫,zh-CN 缺失 exit 1
 *   node scripts/check-i18n-keys.js src/pages/foo.js          # 仅扫某文件
 *   node scripts/check-i18n-keys.js --strict-all-locales      # 任意 locale 缺失即 exit 1
 *   node scripts/check-i18n-keys.js --orphans                 # 同时报告孤立 key
 *   node scripts/check-i18n-keys.js --json                    # JSON 输出(供 CI/工具消费)
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const I18N_DIR = join(ROOT, 'src/i18n')
const PRIMARY_LOCALE = 'zh-CN'
// locale 列表从 src/i18n 目录扫出,新增 locale 自动覆盖,避免和 i18n.js 的 SUPPORTED_LOCALES 失同步
const ALL_LOCALES = [
  PRIMARY_LOCALE,
  ...readdirSync(I18N_DIR)
    .filter(f => f.endsWith('.json') && f !== `${PRIMARY_LOCALE}.json`)
    .map(f => f.slice(0, -5))
    .sort(),
]

// 命令行参数
const args = process.argv.slice(2)
const flags = new Set(args.filter(a => a.startsWith('--')))
const positional = args.filter(a => !a.startsWith('--'))
const STRICT_ALL = flags.has('--strict-all-locales')
const SHOW_ORPHANS = flags.has('--orphans')
const JSON_OUT = flags.has('--json')

// ===== 加载 locale 文件(默认只加载主 locale;strict/orphan/json 模式才加载全部)=====
const NEEDS_ALL_LOCALES = STRICT_ALL || SHOW_ORPHANS || JSON_OUT
const LOCALES_TO_LOAD = NEEDS_ALL_LOCALES ? ALL_LOCALES : [PRIMARY_LOCALE]
const locales = {}
for (const loc of LOCALES_TO_LOAD) {
  const file = join(I18N_DIR, `${loc}.json`)
  try {
    locales[loc] = JSON.parse(readFileSync(file, 'utf-8'))
  } catch (err) {
    if (loc === PRIMARY_LOCALE) {
      console.error(`无法读取主 locale ${file}: ${err.message}`)
      process.exit(2)
    }
    locales[loc] = null  // 缺文件 → 跳过该 locale
  }
}

// 解析嵌套 key("a.b.c" → obj.a.b.c)
function resolveKey(obj, key) {
  if (!obj) return undefined
  const parts = key.split('.')
  let cur = obj
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = cur[p]
  }
  return cur
}

// 扁平化 locale → Set<dotted-key>
function flattenKeys(obj, prefix = '', out = new Set()) {
  if (!obj || typeof obj !== 'object') return out
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) flattenKeys(v, full, out)
    else out.add(full)
  }
  return out
}

// ===== 扫源码:提取 t/tc 调用 =====
const STATIC_RE = /\btc?\(\s*['"]([^'"\\]+)['"]/g           // t('foo.bar') / tc("a.b", n)
const DYNAMIC_RE = /\btc?\(\s*`([^`]*\$\{[^`]*)`/g          // t(`foo.${x}`)

function extractFromSource(source) {
  const staticKeys = []
  const dynamicHints = []
  const lines = source.split('\n')
  let inBlockComment = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (inBlockComment) { if (trimmed.includes('*/')) inBlockComment = false; continue }
    if (trimmed.startsWith('/*')) { if (!trimmed.includes('*/')) inBlockComment = true; continue }
    if (trimmed.startsWith('//')) continue
    let m
    while ((m = STATIC_RE.exec(line)) !== null) staticKeys.push({ key: m[1], line: i + 1 })
    DYNAMIC_RE.lastIndex = 0
    while ((m = DYNAMIC_RE.exec(line)) !== null) dynamicHints.push({ snippet: m[1], line: i + 1 })
  }
  return { staticKeys, dynamicHints }
}

function collectFiles(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'i18n') continue
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) collectFiles(full, files)
    else if (entry.endsWith('.js') && !entry.endsWith('.test.js')) files.push(full)
  }
  return files
}

// ===== 主流程 =====
const targetFiles = positional.length
  ? positional.map(f => resolve(f))
  : collectFiles(join(ROOT, 'src'))

const allUsedKeys = new Set()
const dynamicByFile = {}
const missing = {}                    // { locale: [{file, key, line}] }
for (const loc of ALL_LOCALES) missing[loc] = []
let totalChecked = 0

for (const file of targetFiles) {
  let source
  try { source = readFileSync(file, 'utf-8') } catch { continue }
  const { staticKeys, dynamicHints } = extractFromSource(source)
  if (!staticKeys.length && !dynamicHints.length) continue

  const rel = file.replace(ROOT + '/', '')
  if (dynamicHints.length) dynamicByFile[rel] = dynamicHints

  for (const { key, line } of staticKeys) {
    allUsedKeys.add(key)
    totalChecked++
    for (const loc of ALL_LOCALES) {
      const data = locales[loc]
      if (!data) continue                        // 文件不存在 → 跳过
      if (resolveKey(data, key) !== undefined) continue
      // 复数后缀兜底:tc('common.items', n) 实际查 common.items_other / .._one
      const stripped = key.replace(/_(?:zero|one|two|few|many|other)$/, '')
      if (stripped !== key && resolveKey(data, stripped) !== undefined) continue
      missing[loc].push({ file: rel, key, line })
    }
  }
}

// ===== 孤立 key 检测(可选) =====
const orphans = {}
if (SHOW_ORPHANS) {
  for (const loc of ALL_LOCALES) {
    if (!locales[loc]) continue
    const localeKeys = flattenKeys(locales[loc])
    const orphanList = []
    for (const k of localeKeys) {
      // 复数变体不算孤立
      const stripped = k.replace(/_(?:zero|one|two|few|many|other)$/, '')
      if (allUsedKeys.has(k) || allUsedKeys.has(stripped)) continue
      orphanList.push(k)
    }
    if (orphanList.length) orphans[loc] = orphanList
  }
}

// ===== 输出 =====
if (JSON_OUT) {
  const summary = {
    totalChecked,
    files: targetFiles.length,
    locales: ALL_LOCALES.map(loc => ({
      locale: loc,
      missingCount: missing[loc].length,
      orphanCount: orphans[loc]?.length || 0,
    })),
    primary: PRIMARY_LOCALE,
    strictAllLocales: STRICT_ALL,
    missing: STRICT_ALL ? missing : { [PRIMARY_LOCALE]: missing[PRIMARY_LOCALE] },
    dynamicByFile,
  }
  console.log(JSON.stringify(summary, null, 2))
} else {
  // 人类友好输出
  console.log(`已扫 ${targetFiles.length} 个文件,提取 ${totalChecked} 处 t/tc 调用 (${allUsedKeys.size} 个唯一 key)`)
  console.log()

  // Per-locale 缺失汇总
  for (const loc of ALL_LOCALES) {
    if (!NEEDS_ALL_LOCALES && loc !== PRIMARY_LOCALE) {
      console.log(`  · ${loc}: (跳过,使用 --strict-all-locales 全量扫)`)
      continue
    }
    if (!locales[loc]) {
      console.log(`  [${loc}]  (locale 文件不存在,跳过)`)
      continue
    }
    const cnt = missing[loc].length
    const tag = cnt === 0 ? '✓' : (loc === PRIMARY_LOCALE ? '✗' : '⚠')
    console.log(`  ${tag} ${loc}: 缺失 ${cnt} 个 key`)
  }
  console.log()

  // 详细列出主 locale 的缺失(zh-CN)
  if (missing[PRIMARY_LOCALE].length) {
    console.error(`【${PRIMARY_LOCALE}】缺失明细:`)
    const grouped = {}
    for (const m of missing[PRIMARY_LOCALE]) {
      ;(grouped[m.file] ||= []).push(m)
    }
    for (const [file, list] of Object.entries(grouped)) {
      console.error(`  ${file}:`)
      for (const { key, line } of list) console.error(`    L${line}  ${key}`)
    }
    console.error()
  }

  // STRICT 模式下,详列所有 locale 缺失
  if (STRICT_ALL) {
    for (const loc of ALL_LOCALES) {
      if (loc === PRIMARY_LOCALE || !missing[loc].length) continue
      console.error(`【${loc}】缺失明细(${missing[loc].length}):`)
      const grouped = {}
      for (const m of missing[loc]) (grouped[m.file] ||= []).push(m)
      for (const [file, list] of Object.entries(grouped)) {
        console.error(`  ${file}:`)
        for (const { key, line } of list) console.error(`    L${line}  ${key}`)
      }
      console.error()
    }
  }

  // 动态 key 提示(信息性)
  if (Object.keys(dynamicByFile).length) {
    console.log(`⚠ 动态 key(模板字符串)— 静态扫描无法验证,需人工核查:`)
    for (const [file, hints] of Object.entries(dynamicByFile)) {
      console.log(`  ${file}:`)
      for (const { snippet, line } of hints) console.log(`    L${line}  t(\`${snippet}…\`)`)
    }
    console.log()
  }

  // 孤立 key
  if (SHOW_ORPHANS && Object.keys(orphans).length) {
    console.log(`⚠ 孤立 key(locale 中存在但代码未引用):`)
    for (const [loc, list] of Object.entries(orphans)) {
      console.log(`  [${loc}] ${list.length} 个`)
      for (const k of list.slice(0, 20)) console.log(`    - ${k}`)
      if (list.length > 20) console.log(`    ...还有 ${list.length - 20} 个`)
    }
  }
}

// ===== 退出码策略 =====
const primaryFails = missing[PRIMARY_LOCALE].length > 0
const anyLocaleFails = ALL_LOCALES.some(loc => missing[loc].length > 0)
if (primaryFails) process.exit(1)
if (STRICT_ALL && anyLocaleFails) process.exit(1)
if (!JSON_OUT) console.log('✓ 检查通过')
process.exit(0)
