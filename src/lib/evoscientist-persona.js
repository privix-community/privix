import { getAssistantStorageKeys, migrateAssistantStorage } from './assistant-storage.js'
import { getActiveProductProfileId } from './product-profile.js'

const ACTIVE_PRODUCT_PROFILE_ID = getActiveProductProfileId()

export const EVOSCIENTIST_PERSONA_STORAGE_KEY = `prospectclaw-evoscientist-persona:${ACTIVE_PRODUCT_PROFILE_ID}`

const DEFAULT_PERSONA = Object.freeze({
  version: 1,
  overlayEnabled: false,
  name: 'Prospect-Research Coordinator',
  roleLabel: '总控协调者',
  source: 'manual',
  summary: '严谨、结构化、善于拆解复杂任务，并通过 Scientists 协作推进复杂工作。',
  directive: '优先给出计划、依据、风险和下一步，再决定是否拆给 Scientists。',
  boundaries: '不虚构事实，不跳过审批，不隐藏风险；涉及高影响操作时先明确影响范围与回退路径。',
  levels: {
    rigor: 5,
    initiative: 3,
    restraint: 4,
    architecture: 5,
  },
})

function clampLevel(value, fallback = 3) {
  const numeric = Number.parseInt(value, 10)
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(5, Math.max(1, numeric))
}

function normalizeLevels(raw = {}) {
  const levels = raw && typeof raw === 'object' ? raw : {}
  return {
    rigor: clampLevel(levels.rigor, DEFAULT_PERSONA.levels.rigor),
    initiative: clampLevel(levels.initiative, DEFAULT_PERSONA.levels.initiative),
    restraint: clampLevel(levels.restraint, DEFAULT_PERSONA.levels.restraint),
    architecture: clampLevel(levels.architecture, DEFAULT_PERSONA.levels.architecture),
  }
}

function safeText(value, fallback = '') {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || fallback
}

function keywordScore(text, keywords = []) {
  const haystack = String(text || '').toLowerCase()
  return keywords.reduce((total, keyword) => (
    haystack.includes(String(keyword).toLowerCase()) ? total + 1 : total
  ), 0)
}

function inferLevelsFromText(text = '') {
  const rigorScore = keywordScore(text, ['严谨', '审计', '引用', 'fact', '证据', 'verify', 'review', '复核'])
  const initiativeScore = keywordScore(text, ['高效', '主动', '推进', '拆解', 'owner', '执行', '落地'])
  const restraintScore = keywordScore(text, ['克制', '边界', '风险', '谨慎', '不要幻想', '审慎'])
  const architectureScore = keywordScore(text, ['结构化', '协作', 'workflow', '架构', 'system', '系统', '分工'])

  return {
    rigor: Math.min(5, Math.max(2, 3 + Math.min(2, rigorScore))),
    initiative: Math.min(5, Math.max(2, 2 + Math.min(3, initiativeScore))),
    restraint: Math.min(5, Math.max(2, 3 + Math.min(2, restraintScore))),
    architecture: Math.min(5, Math.max(2, 3 + Math.min(2, architectureScore))),
  }
}

export function createDefaultEvoscientistPersona() {
  return normalizeEvoscientistPersona(DEFAULT_PERSONA)
}

export function normalizeEvoscientistPersona(raw = {}) {
  const persona = raw && typeof raw === 'object'
    ? (raw.persona && typeof raw.persona === 'object' ? raw.persona : raw)
    : {}

  return {
    version: 1,
    overlayEnabled: persona.overlayEnabled !== undefined
      ? !!persona.overlayEnabled
      : DEFAULT_PERSONA.overlayEnabled,
    name: safeText(persona.name, DEFAULT_PERSONA.name),
    roleLabel: safeText(persona.roleLabel, DEFAULT_PERSONA.roleLabel),
    source: safeText(persona.source, DEFAULT_PERSONA.source),
    summary: safeText(persona.summary, DEFAULT_PERSONA.summary),
    directive: safeText(persona.directive, DEFAULT_PERSONA.directive),
    boundaries: safeText(persona.boundaries, DEFAULT_PERSONA.boundaries),
    levels: normalizeLevels(persona.levels),
  }
}

export function loadEvoscientistPersona(storage = globalThis?.localStorage) {
  if (!storage?.getItem) return createDefaultEvoscientistPersona()
  try {
    const raw = storage.getItem(EVOSCIENTIST_PERSONA_STORAGE_KEY)
    return raw ? normalizeEvoscientistPersona(JSON.parse(raw)) : createDefaultEvoscientistPersona()
  } catch {
    return createDefaultEvoscientistPersona()
  }
}

export function saveEvoscientistPersona(persona, storage = globalThis?.localStorage) {
  if (!storage?.setItem) return
  storage.setItem(EVOSCIENTIST_PERSONA_STORAGE_KEY, JSON.stringify(normalizeEvoscientistPersona(persona)))
}

export function readLocalAssistantPersonaSnapshot(storage = globalThis?.localStorage) {
  if (!storage?.getItem) {
    return {
      name: '钳子助手',
      personality: '',
      soulSource: 'default',
      promptPreset: 'default',
      knowledgeCount: 0,
    }
  }

  const keys = migrateAssistantStorage(storage, ACTIVE_PRODUCT_PROFILE_ID) || getAssistantStorageKeys(ACTIVE_PRODUCT_PROFILE_ID)
  try {
    const raw = storage.getItem(keys.config)
    const config = raw ? JSON.parse(raw) : {}
    const knowledgeFiles = Array.isArray(config?.knowledgeFiles) ? config.knowledgeFiles : []
    return {
      name: safeText(config?.assistantName, '钳子助手'),
      personality: safeText(config?.assistantPersonality, ''),
      soulSource: safeText(config?.soulSource, 'default'),
      promptPreset: safeText(config?.promptPreset, 'default'),
      knowledgeCount: knowledgeFiles.filter(file => file?.enabled !== false).length,
    }
  } catch {
    return {
      name: '钳子助手',
      personality: '',
      soulSource: 'default',
      promptPreset: 'default',
      knowledgeCount: 0,
    }
  }
}

export function createPersonaFromAssistantSnapshot(snapshot = readLocalAssistantPersonaSnapshot()) {
  const personality = safeText(snapshot.personality, DEFAULT_PERSONA.summary)
  return normalizeEvoscientistPersona({
    overlayEnabled: true,
    name: safeText(snapshot.name, DEFAULT_PERSONA.name),
    roleLabel: '本地助手人格镜像',
    source: String(snapshot.soulSource || '').startsWith('openclaw:') ? 'openclaw' : 'assistant',
    summary: personality,
    directive: `尽量延续「${safeText(snapshot.name, DEFAULT_PERSONA.name)}」的表达方式，同时保留 Prospect-Research 的多 Scientist 协作能力。`,
    boundaries: '保持本地助手的风格边界，但遇到多步骤任务时要显式拆解、复核并汇总。',
    levels: inferLevelsFromText(personality),
  })
}

// === Agent 舰队人格导入 ===

/**
 * 从 Agent 舰队中读取所有 agent 的简要信息（用于选择器）
 * @param {Function} listAgentsFn - api.listAgents
 * @returns {Promise<Array<{id, name, emoji, workspace}>>}
 */
export async function readAgentFleetOptions(listAgentsFn) {
  try {
    const agents = await listAgentsFn()
    if (!Array.isArray(agents)) return []
    return agents.map(a => ({
      id: String(a.id || ''),
      name: safeText(a.identityName ? a.identityName.split(',')[0].trim() : '', a.id || '未命名'),
      emoji: safeText(a.identityEmoji, '🤖'),
      workspace: safeText(a.workspace, ''),
    })).filter(a => a.id)
  } catch {
    return []
  }
}

/**
 * 读取指定 agent 的人格快照（SOUL.md + IDENTITY.md 内容）
 * @param {string} agentId
 * @param {string} workspace
 * @param {Function} readFileFn - api.assistantReadFile
 * @returns {Promise<{id, name, emoji, soulContent, identityContent}>}
 */
export async function readAgentPersonaSnapshot(agentId, workspace, readFileFn) {
  const base = { id: agentId, name: agentId, emoji: '🤖', soulContent: '', identityContent: '' }
  if (!workspace || !readFileFn) return base
  const wsPath = workspace.replace(/\/+$/, '')
  try {
    const [soul, identity] = await Promise.all([
      readFileFn(`${wsPath}/SOUL.md`).catch(() => ''),
      readFileFn(`${wsPath}/IDENTITY.md`).catch(() => ''),
    ])
    return { ...base, soulContent: safeText(soul), identityContent: safeText(identity) }
  } catch {
    return base
  }
}

/**
 * 从 agent SOUL.md 内容构建 EvoScientist persona
 */
export function createPersonaFromAgentSnapshot(snapshot) {
  const name = safeText(snapshot?.name, DEFAULT_PERSONA.name)
  const soul = safeText(snapshot?.soulContent, '')
  const identity = safeText(snapshot?.identityContent, '')
  const combined = `${identity}\n${soul}`.trim()
  const summary = soul
    ? (soul.length > 200 ? soul.slice(0, 200) + '...' : soul)
    : DEFAULT_PERSONA.summary

  return normalizeEvoscientistPersona({
    overlayEnabled: true,
    name: `${snapshot?.emoji || '🤖'} ${name}`,
    roleLabel: 'Agent 舰队人格镜像',
    source: 'agent-fleet',
    summary,
    directive: `延续 Agent「${name}」的 SOUL 风格，同时保留 Prospect-Research 的多 Scientist 协作能力。`,
    boundaries: identity
      ? `遵循「${name}」IDENTITY 中定义的职责边界，遇到多步骤任务时显式拆解、复核并汇总。`
      : DEFAULT_PERSONA.boundaries,
    levels: inferLevelsFromText(combined),
  })
}

/** Persona 旋钮 → LLM 行为指令映射表（模块级常量） */
const LEVEL_DIRECTIVE_DEFS = [
  { key: 'rigor', label: '证据标准', rules: {
    1: '可以自由推测和假设，鼓励探索性思维',
    2: '关键结论需简要说明依据，但不要求严格引用',
    3: '重要结论需附带数据来源或推理链',
    4: '每个结论必须附带具体数据源引用，区分"事实"和"推测"',
    5: '极度严谨模式：每个断言必须有可验证的数据源。未经验证的信息必须标注"[待验证]"。不接受任何无来源的推测性结论',
  }},
  { key: 'initiative', label: '执行范围', rules: {
    1: '仅执行用户明确指示的任务，不主动扩展研究范围。不确定时请求澄清',
    2: '可小幅扩展直接相关的分析维度，但不发起新方向',
    3: '可主动补充相关分析维度，但需说明"以下是我额外补充的分析"',
    4: '主动识别遗漏维度并补充。如果发现当前方向有问题，主动提出替代方案',
    5: '全面 ownership：主动拆解任务、识别盲区、提出后续 action items。像项目负责人一样推进',
  }},
  { key: 'restraint', label: '风险表达', rules: {
    1: '表达直接明确，给出确定性结论。适合快速决策场景',
    2: '适度提及主要风险，但不过度渲染不确定性',
    3: '平衡呈现：结论和风险并重，让用户自行权衡',
    4: '审慎模式：优先暴露风险和边界条件。用"如果-那么"结构呈现不确定性',
    5: '高度审慎：每个建议必须附带风险评估和回退方案。涉及高影响决策时，明确说明"这需要更多验证才能行动"',
  }},
  { key: 'architecture', label: '结构化程度', rules: {
    1: '直接回答问题，不需要额外的结构化框架',
    2: '使用简单的分点列举，保持轻量',
    3: '用清晰的标题和分层结构组织输出',
    4: '明确拆分分析维度，标注维度间的关联。如需多步骤工作，给出执行计划',
    5: '系统化思维：先给出分析框架，再按框架逐层推进。主动识别适合交给 Scientists 并行处理的子任务',
  }},
]

function _buildLevelDirectives(levels) {
  return LEVEL_DIRECTIVE_DEFS
    .map(d => `**${d.label}**：${d.rules[levels[d.key]] || d.rules[3]}`)
    .join('\n')
}

export function buildEvoscientistPersonaOverlay(persona, { observedScientists = [] } = {}) {
  const profile = normalizeEvoscientistPersona(persona)
  if (!profile.overlayEnabled) return ''

  const observed = Array.isArray(observedScientists)
    ? observedScientists.slice(0, 4).map(item => item?.name).filter(Boolean)
    : []

  // 生成具体的行为指令（而非仅描述性标签）
  const levelDirectives = _buildLevelDirectives(profile.levels)

  const lines = [
    '## Prospect-Research 协调者行为规范',
    '',
    `你是 **${profile.name}**（${profile.roleLabel}）。`,
    '',
    `**人格摘要**：${profile.summary}`,
    '',
    '### 行为指令',
    '',
    levelDirectives,
    '',
    '### 执行偏好',
    `${profile.directive}`,
    '',
    '### 行为边界（硬性约束）',
    `${profile.boundaries}`,
  ]

  if (observed.length) {
    lines.push('')
    lines.push(`### 可用 Scientists`)
    lines.push(`当前可调度的 Scientists：${observed.join('、')}。如需拆分任务，按职责清晰分工，给每个 Scientist 写出具体的、self-contained 的任务指令。`)
  }

  lines.push('')
  lines.push('### 输出规范')
  lines.push('每次回复必须包含：（1）当前步骤的核心结论或计划 （2）依据和推理过程 （3）风险/不确定性（如有） （4）建议的下一步。不要输出空洞的概述性语句。')

  return lines.join('\n')
}

export function buildEvoscientistPersonaPackage(persona, {
  assistantSnapshot = null,
  observedScientists = [],
  threadId = '',
  workspaceDir = '',
} = {}) {
  return {
    type: 'evoscientist-persona-pack',
    version: 1,
    exportedAt: new Date().toISOString(),
    productProfileId: ACTIVE_PRODUCT_PROFILE_ID,
    persona: normalizeEvoscientistPersona(persona),
    assistantSnapshot: assistantSnapshot || readLocalAssistantPersonaSnapshot(),
    observedScientists: Array.isArray(observedScientists)
      ? observedScientists.map(item => ({
        name: safeText(item?.name),
        roles: Array.isArray(item?.roles) ? item.roles : [],
        count: Number(item?.count || 0),
        preview: safeText(item?.preview),
      }))
      : [],
    context: {
      threadId: safeText(threadId),
      workspaceDir: safeText(workspaceDir),
    },
  }
}
