function summarizeText(value, limit = 120) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim()
  if (!text) return ''
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`
}

function summarizeValue(value, limit = 120) {
  if (value == null) return ''
  if (typeof value === 'string') return summarizeText(value, limit)
  try {
    return summarizeText(JSON.stringify(value), limit)
  } catch {
    return summarizeText(String(value), limit)
  }
}

export const EVOSCIENTIST_TABS = Object.freeze([
  {
    key: 'chat',
    label: '聊天',
    iconName: 'message-square',
    note: '执行',
    copy: '围绕当前线程发起任务并查看关键事件。',
    isDefault: true,
  },
  {
    key: 'settings',
    label: '设置',
    iconName: 'gear',
    note: '配置',
    copy: '管理模型、默认目录与高级选项。',
  },
])

export function getEvoscientistTabMeta(tab = 'chat') {
  return EVOSCIENTIST_TABS.find(item => item.key === tab) || EVOSCIENTIST_TABS[0]
}

export function getEvoscientistNextStep(readiness = {}, { installing = false } = {}) {
  if (installing) {
    return {
      title: '安装进行中',
      summary: '保持当前页面，安装完成后再继续配置或启动。',
      actions: [
        { action: 'refresh-status', label: '刷新状态', tone: 'secondary' },
      ],
    }
  }

  const state = readiness?.state || 'unsupported'

  if (state === 'ready') {
    return {
      title: '可以开始任务',
      summary: 'Bridge 已就绪，直接进入聊天发出第一条任务即可。',
      actions: [
        { tab: 'chat', label: '进入聊天', tone: 'primary' },
      ],
    }
  }

  if (state === 'not_installed') {
    return {
      title: '先完成安装',
      summary: '安装完成后才能继续配置模型并启动运行环境。',
      actions: [
        { action: 'install-evoscientist', label: '安装 Prospect-Research', tone: 'primary' },
      ],
    }
  }

  if (state === 'needs_config') {
    return {
      title: '先补齐配置',
      summary: '优先完成 Provider、模型和默认目录配置，再回到工作台启动 Bridge。',
      actions: [
        { action: 'open-config', label: '打开配置', tone: 'primary' },
        { tab: 'settings', label: '查看设置', tone: 'secondary' },
      ],
    }
  }

  if (state === 'stopped') {
    return {
      title: '启动 Bridge',
      summary: '环境已经准备好，启动后就可以进入聊天执行任务。',
      actions: [
        { action: 'start-bridge', label: '启动 Bridge', tone: 'primary' },
        { tab: 'chat', label: '查看聊天区', tone: 'secondary' },
      ],
    }
  }

  if (state === 'starting') {
    return {
      title: '等待 Bridge 就绪',
      summary: '状态切换完成后即可进入聊天；如果长时间无变化，再手动刷新。',
      actions: [
        { action: 'refresh-status', label: '刷新状态', tone: 'secondary' },
      ],
    }
  }

  if (state === 'error') {
    return {
      title: '修复后再继续',
      summary: summarizeText(readiness?.message || '检测到 Bridge 异常，可先重新启动后再继续。'),
      actions: [
        { action: 'start-bridge', label: '重新启动 Bridge', tone: 'primary' },
        { action: 'refresh-status', label: '刷新状态', tone: 'secondary' },
      ],
    }
  }

  return {
    title: '当前环境不可用',
    summary: summarizeText(readiness?.message || '当前环境暂不支持 Prospect-Research。'),
    actions: [],
  }
}

export function summarizeEvoscientistTimelineEntry(entry = {}) {
  const kind = String(entry.kind || '')

  if (kind === 'tool_call') {
    return {
      title: `工具调用 · ${entry.name || '未命名工具'}`,
      summary: summarizeValue(entry.args || {}, 140) || '等待执行参数',
    }
  }

  if (kind === 'tool_result') {
    return {
      title: `工具结果 · ${entry.name || '未命名工具'}`,
      summary: summarizeValue(entry.content || '', 140) || (entry.success ? '已返回结果' : '未返回内容'),
    }
  }

  if (kind === 'interrupt') {
    const count = Array.isArray(entry.payload?.action_requests) ? entry.payload.action_requests.length : 1
    return {
      title: '等待人工确认',
      summary: `当前有 ${count} 个待确认操作。`,
    }
  }

  if (kind === 'ask_user') {
    const count = Array.isArray(entry.payload?.questions) ? entry.payload.questions.length : 1
    return {
      title: '需要补充信息',
      summary: `当前有 ${count} 个待回答问题。`,
    }
  }

  if (kind === 'usage') {
    return {
      title: '用量统计',
      summary: `输入 ${entry.inputTokens ?? 0} tokens，输出 ${entry.outputTokens ?? 0} tokens。`,
    }
  }

  if (kind === 'system') {
    return {
      title: '系统提示',
      summary: summarizeText(entry.content || '', 140),
    }
  }

  return {
    title: '',
    summary: summarizeValue(entry.content || entry.payload || '', 140),
  }
}
