// Agenttrail relay for pi (https://pi.dev): reports this session to the local
// Agenttrail Map boards through the ingest events in docs/INGEST.md.
// Never blocks pi: 400ms cap per post, failures are silent, nothing leaves 127.0.0.1.
// Sends tool names, paths, commands and search patterns; never file contents or prompts.

const WRITES = new Set(['write', 'edit'])
const ports = () => {
  const one = parseInt(process.env.AGENTTRAIL_PORT, 10)
  if (one) return [one]
  const base = parseInt(process.env.AGENTTRAIL_PORT_BASE, 10) || 5330
  return Array.from({ length: 15 }, (_, i) => base + i)
}
// Only short, descriptive fields survive: a write's content or an edit's text never does.
function input(args = {}) {
  const out = {}
  if (typeof args.command === 'string') out.command = args.command
  if (typeof args.pattern === 'string') out.pattern = args.pattern
  if (typeof args.path === 'string') out.description = args.path
  return out
}
// The example todo extension keeps its list in details.todos as { id, text, done }.
function todos(result) {
  const list = result?.details?.todos
  if (!Array.isArray(list)) return null
  return list.map(t => ({ id: t?.id == null ? undefined : String(t.id), content: t?.text ?? t?.content ?? t?.title, status: t?.status ?? (t?.done ? 'completed' : 'pending') }))
}

export default function agenttrail(pi) {
  const send = (ctx, ev) => {
    let body
    try { body = JSON.stringify({ agent: 'pi', session_id: ctx.sessionManager.getSessionId(), cwd: ctx.cwd, ...ev }) } catch { return Promise.resolve() }
    return Promise.allSettled(ports().map(p => fetch(`http://127.0.0.1:${p}/hook`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(400),
    }))).then(() => {})
  }
  pi.on('session_start', (e, ctx) => { send(ctx, { hook_event_name: 'SessionStart', source: e?.reason === 'resume' ? 'resume' : 'startup' }) })
  pi.on('tool_execution_start', (e, ctx) => {
    send(ctx, { hook_event_name: 'PreToolUse', tool_name: e.toolName, tool_use_id: e.toolCallId, tool_input: input(e.args) })
  })
  pi.on('tool_execution_end', (e, ctx) => {
    const ev = { hook_event_name: e.isError ? 'PostToolUseFailure' : 'PostToolUse', tool_name: e.toolName, tool_use_id: e.toolCallId, tool_input: input(e.args) }
    if (!e.isError && WRITES.has(e.toolName) && typeof e.args?.path === 'string') ev.files_written = [e.args.path]
    send(ctx, ev).then(() => {
      const list = !e.isError && e.toolName === 'todo' ? todos(e.result) : null
      if (list) return send(ctx, { hook_event_name: 'TodoUpdate', todos: list })
    })
  })
  pi.on('agent_settled', (_e, ctx) => { send(ctx, { hook_event_name: 'Stop' }) })
  // Returned so pi waits for it: this one fires as the process is leaving.
  pi.on('session_shutdown', (_e, ctx) => send(ctx, { hook_event_name: 'SessionEnd' }))
}
