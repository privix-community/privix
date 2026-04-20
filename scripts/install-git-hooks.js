#!/usr/bin/env node
/**
 * 安装本地 git pre-commit hook
 * 用法: node scripts/install-git-hooks.js
 *
 * 安装后,每次 commit 前自动跑 i18n:check(zh-CN 缺失即阻断 commit)。
 * 如需暂时跳过:`git commit --no-verify`(不推荐)
 */
import { writeFileSync, chmodSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execSync } from 'node:child_process'

const ROOT = resolve(import.meta.dirname, '..')
const HOOK_DIR = join(ROOT, '.git/hooks')
const HOOK_PATH = join(HOOK_DIR, 'pre-commit')

const HOOK = `#!/bin/sh
# Privix Community pre-commit: i18n key 校验 + 零遥测守卫
# 由 scripts/install-git-hooks.js 安装
# 如需跳过(不推荐): git commit --no-verify
set -e

echo "[pre-commit] running i18n:check:strict (all 11 locales)..."
npm run -s i18n:check:strict

echo "[pre-commit] running check:telemetry (zero-telemetry guardian)..."
npm run -s check:telemetry
`

if (!existsSync(join(ROOT, '.git'))) {
  console.error('错误:不在 git 仓库根目录下,无法安装 hook。')
  process.exit(1)
}
if (!existsSync(HOOK_DIR)) mkdirSync(HOOK_DIR, { recursive: true })

writeFileSync(HOOK_PATH, HOOK, 'utf8')
chmodSync(HOOK_PATH, 0o755)

console.log('✓ pre-commit hook 已安装到 .git/hooks/pre-commit')
console.log('  每次 commit 前会自动跑 i18n:check:strict + check:telemetry')
console.log('  如需跳过(不推荐):git commit --no-verify')

// 验证可执行
try {
  execSync(`test -x ${HOOK_PATH}`)
  console.log('✓ hook 可执行权限验证通过')
} catch {
  console.warn('⚠ hook 文件已写入,但可执行权限校验未通过,请手动 chmod +x')
}
