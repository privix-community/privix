export function resolveSelectedThreadId({
  selectedThreadId = '',
  threadSelectionLocked = false,
} = {}, status = null) {
  const currentSelection = String(selectedThreadId || '').trim()
  if (threadSelectionLocked || currentSelection) return currentSelection

  const statusThreadId = String(status?.currentThreadId || '').trim()
  return statusThreadId
}

export function getEvoscientistRuntimePaths(status = null) {
  const runtime = status?.workspaceRuntime && typeof status.workspaceRuntime === 'object'
    ? status.workspaceRuntime
    : {}

  return {
    workspaceRoot: String(status?.workspaceRoot || runtime.workspaceRoot || '').trim(),
    runsDir: String(status?.runsDir || runtime.runsDir || '').trim(),
    memoryDir: String(status?.memoryDir || runtime.memoryDir || '').trim(),
    skillsDir: String(status?.skillsDir || runtime.skillsDir || '').trim(),
    mediaDir: String(status?.mediaDir || runtime.mediaDir || '').trim(),
  }
}
