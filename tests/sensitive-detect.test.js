import test from 'node:test'
import assert from 'node:assert/strict'

// 在 import 前 stub localStorage(sensitive-detect.js 的配置函数需要它)
globalThis.localStorage = {
  _store: new Map(),
  getItem(k) { return this._store.has(k) ? this._store.get(k) : null },
  setItem(k, v) { this._store.set(k, String(v)) },
  removeItem(k) { this._store.delete(k) },
}

const { detectSensitive, redactText, stripLinesWithHits } = await import('../src/lib/sensitive-detect.js')

test('detectSensitive 命中 Anthropic API Key 且优先于通用 sk- 前缀', () => {
  const text = '这是我的 key: sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890 请处理'
  const hits = detectSensitive(text)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].type, 'api_key_anthropic')
})

test('detectSensitive 命中 OpenAI 风格 sk- Key', () => {
  const text = 'export OPENAI_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz123456'
  const hits = detectSensitive(text)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].type, 'api_key_openai')
})

test('detectSensitive 命中 Google AIza Key', () => {
  const text = 'gemini: AIzaSyDxxx_yyyyyyyyyyyyyyyyyyyyyyyyyyy-z'
  const hits = detectSensitive(text)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].type, 'api_key_google')
})

test('detectSensitive 命中 PEM 私钥头', () => {
  const text = '粘贴如下:\n-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----'
  const hits = detectSensitive(text)
  assert.equal(hits.filter(h => h.type === 'pem_private').length, 1)
})

test('detectSensitive 校验中国身份证号(GB 11643-1999 checksum)', () => {
  // 11010519491231002X — 合法
  const validText = '身份证 11010519491231002X 已登记'
  assert.equal(detectSensitive(validText).filter(h => h.type === 'cn_id_card').length, 1)
  // 非法 checksum(末位改错)
  const invalidText = '身份证 110105194912310020 已登记'
  assert.equal(detectSensitive(invalidText).filter(h => h.type === 'cn_id_card').length, 0)
})

test('detectSensitive 命中中国大陆手机号,但不命中短号 / 长号', () => {
  assert.equal(detectSensitive('联系 13800138000').filter(h => h.type === 'cn_mobile').length, 1)
  assert.equal(detectSensitive('联系 138001380').filter(h => h.type === 'cn_mobile').length, 0)
  assert.equal(detectSensitive('账号 138001380001').filter(h => h.type === 'cn_mobile').length, 0)
})

test('detectSensitive 使用 Luhn 校验银行卡号,拒绝非法序列', () => {
  // 4532015112830366 — Luhn 合法示例卡号
  const ok = detectSensitive('卡号 4532015112830366')
  assert.ok(ok.some(h => h.type === 'credit_card'))
  // 4532015112830360 — 末位改错
  const bad = detectSensitive('卡号 4532015112830360')
  assert.equal(bad.filter(h => h.type === 'credit_card').length, 0)
})

test('detectSensitive 对无敏感内容返回空数组', () => {
  assert.deepEqual(detectSensitive('今天天气真好,没有任何敏感信息。'), [])
  assert.deepEqual(detectSensitive(''), [])
  assert.deepEqual(detectSensitive(null), [])
})

test('detectSensitive 尊重 enabledTypes 过滤', () => {
  const text = 'key sk-abcdefghijklmnopqrstuvwxyz 手机 13800138000'
  const onlyMobile = detectSensitive(text, { enabledTypes: ['cn_mobile'] })
  assert.equal(onlyMobile.length, 1)
  assert.equal(onlyMobile[0].type, 'cn_mobile')
})

test('redactText 按命中项替换为 [REDACTED_*] 且非命中部分原样保留', () => {
  const text = 'before sk-abcdefghijklmnopqrstuvwxyz after'
  const hits = detectSensitive(text)
  const redacted = redactText(text, hits)
  assert.match(redacted, /^before \[REDACTED_API_KEY_OPENAI\] after$/)
})

test('redactText 处理多个命中时索引不错位', () => {
  const text = 'sk-abcdefghijklmnopqrstuvwxyz 和 13800138000'
  const hits = detectSensitive(text)
  assert.equal(hits.length, 2)
  const redacted = redactText(text, hits)
  assert.ok(redacted.includes('[REDACTED_API_KEY_OPENAI]'))
  assert.ok(redacted.includes('[REDACTED_CN_MOBILE]'))
  assert.ok(!redacted.includes('sk-abc'))
  assert.ok(!redacted.includes('13800138000'))
})

test('stripLinesWithHits 只移除包含敏感项的行', () => {
  const text = 'safe line 1\nkey sk-abcdefghijklmnopqrstuvwxyz leaked\nsafe line 2'
  const hits = detectSensitive(text)
  const stripped = stripLinesWithHits(text, hits)
  assert.equal(stripped, 'safe line 1\nsafe line 2')
})
