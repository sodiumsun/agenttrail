// Reads local Claude Code transcripts, so a session shows up with no hooks
// installed. Strictly read-only, with the bounds of logtail.mjs. Sub-agents write
// their own transcripts in a folder beside these; those are not read, so a
// sub-agent is a row on its parent's run, never a run of its own.
import fs from 'node:fs/promises'
import path from 'node:path'
import { DISCOVER_MS, LogTailReader, MAX_CANDIDATES, MAX_WATCHED, META_BYTES, RECENT_MS, entries, hold, remember } from './logtail.mjs'
import { claudeTaskEffect, clean, taskList } from './tasks.mjs'

export { DISCOVER_MS }
const DETAIL = 90
const TASK_TOOLS = /^(TaskCreate|TaskUpdate|TaskGet|TaskList|TodoWrite)$/
const WRITE_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])
export const SUBAGENT_TOOL = /^(Agent|Task)$/ // Claude Code renamed Task to Agent
const INTERRUPTED = /^\[Request interrupted by user/
const NOT_A_TURN = /^<(local-command-[a-z]+|command-name|command-message)>/
const NOTIFICATION = /^<task-notification>/
const FINISHED = /<status>(?:completed|failed|killed)<\/status>/
const NOTIFIED_CALL = /<tool-use-id>([^<]+)<\/tool-use-id>/
const LAUNCHED = new Set(['async_launched', 'teammate_spawned'])
const LAUNCH_TEXT = /async agent launched|teammate|^\s*spawned/i

export function toolDetail(input, rel = () => null) {
  input ||= {}
  const p = input.file_path || input.notebook_path
  const d = input.command || (p ? (rel(p) ?? p) : '') || input.description || input.pattern || input.url || input.query || input.prompt || ''
  return String(d).replace(/\s+/g, ' ').slice(0, DETAIL)
}
export const subagentName = input => String(input?.description || input?.name || input?.subagent_type || 'sub-agent').slice(0, 60)

function startCall(block, row, at, cursor, rel) {
  if (remember(cursor, block.id)) return []
  const input = block.input && typeof block.input === 'object' ? block.input : {}
  const name = clean(block.name, DETAIL)
  const call = { name, at, detail: toolDetail(input, rel) }
  // Only what the result needs survives into the saved cursor: no prompts or bodies.
  if (TASK_TOOLS.test(block.name)) call.task = { taskId: input.taskId, subject: clean(input.subject), status: input.status, merge: input.merge, todos: taskList(input.todos) ?? undefined }
  const file = input.file_path || input.notebook_path
  if (WRITE_TOOLS.has(block.name) && typeof file === 'string') call.file = path.resolve(row.cwd, file)
  const subagent = SUBAGENT_TOOL.test(block.name)
  if (subagent) call.subagent = true
  hold(cursor, block.id, call)
  return [
    { kind: 'tool-start', at, callId: block.id, name, detail: call.detail },
    ...(subagent ? [{ kind: 'subagent-start', at, callId: block.id, name: subagentName(input) }] : []),
  ]
}

const blockText = content => typeof content === 'string' ? content
  : Array.isArray(content) ? content.map(b => b?.text ?? '').join('\n') : ''

// A launch result means the sub-agent started, not that it finished.
function wasLaunched(result, block) {
  if (typeof result?.status === 'string') return LAUNCHED.has(result.status)
  return LAUNCH_TEXT.test(blockText(block.content).slice(0, 200))
}

function finishCall(block, result, at, cursor) {
  const call = cursor.pending?.[block.tool_use_id]
  if (!call) return [] // its start lies outside what was read: nothing is known about it
  delete cursor.pending[block.tool_use_id]
  const error = !!block.is_error
  const callId = block.tool_use_id
  const effects = [{ kind: 'tool-end', at, callId, name: call.name, detail: call.detail, ms: Math.max(0, at - call.at), error, record: true, files: call.file && !error ? [call.file] : [] }]
  if (call.subagent) effects.push({ kind: !error && wasLaunched(result, block) ? 'subagent-detached' : 'subagent-end', at, callId })
  if (call.task && !error) {
    const effect = claudeTaskEffect(call.name, call.task, result ?? block.content)
    if (effect) effects.push({ kind: 'tasks', at, effect })
  }
  return effects
}

const endTurn = (kind, at, cursor) => {
  cursor.pending = {}
  return [{ kind, at }]
}

// Turns one transcript row into run effects. As with Codex, a proposal waits in
// cursor.pending for its result, and a turn that ends first abandons it.
export function claudeEffects(row, meta, cursor, rel) {
  if (!row || row.isSidechain || row.sessionId !== meta.id) return []
  const at = Date.parse(row.timestamp)
  if (!Number.isFinite(at)) return []
  if (row.type === 'system') return row.subtype === 'turn_duration' ? endTurn('turn-end', at, cursor) : []
  const content = row.message?.content
  if (row.type === 'assistant') {
    const calls = Array.isArray(content) ? content.filter(b => b?.type === 'tool_use' && b.id) : []
    const effects = calls.flatMap(b => startCall(b, row, at, cursor, rel))
    return row.message?.stop_reason === 'end_turn' ? [...effects, ...endTurn('turn-end', at, cursor)] : effects
  }
  if (row.type !== 'user' || row.isMeta || row.isCompactSummary) return []
  const results = Array.isArray(content) ? content.filter(b => b?.type === 'tool_result') : []
  if (results.length) {
    const result = results.length === 1 && row.toolUseResult && typeof row.toolUseResult === 'object' ? row.toolUseResult : undefined
    return results.flatMap(b => finishCall(b, result, at, cursor))
  }
  const text = blockText(content).trimStart()
  if (!text && !Array.isArray(content)) return []
  if (INTERRUPTED.test(text)) return endTurn('interrupted', at, cursor)
  if (NOT_A_TURN.test(text)) return []
  if (!NOTIFICATION.test(text)) return [{ kind: 'turn-start', at }]
  const callId = FINISHED.test(text) ? NOTIFIED_CALL.exec(text)?.[1] : null
  return [{ kind: 'turn-start', at }, ...(callId ? [{ kind: 'subagent-end', at, callId }] : [])]
}

const lines = buffer => buffer.toString('utf8').split('\n')
function parsed(line) {
  try { return JSON.parse(line) } catch { return null }
}
async function readSlice(file, start, length) {
  const handle = await fs.open(file, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, start)
    return buffer.subarray(0, bytesRead)
  } finally { await handle.close() }
}

export class ClaudeLogReader extends LogTailReader {
  // rel(path) shortens a path inside the repo for display.
  constructor({ claudeHome, rel, ...rest }) {
    super(rest)
    Object.assign(this, { claudeHome, rel })
    this.tails = new Map()
  }

  rowEffects(row, meta, cursor) {
    // A session can move between folders: like a hook, each row counts only where it happened.
    return typeof row?.cwd === 'string' && this.wants(row.cwd) ? claudeEffects(row, meta, cursor, this.rel) : []
  }

  // The first rows hold no fixed header, so take the first that names a session.
  async metadata(file) {
    if (this.meta.has(file)) return this.meta.get(file)
    try {
      const rows = lines(await readSlice(file, 0, META_BYTES)).slice(0, -1)
      for (const line of rows) {
        const row = parsed(line)
        if (typeof row?.sessionId !== 'string' || typeof row.cwd !== 'string') continue
        const meta = { id: row.sessionId, cwd: row.cwd, startedAt: Date.parse(row.timestamp) || null }
        this.meta.set(file, meta)
        return meta
      }
    } catch {}
    return null // still being written, or not a session: look again later
  }

  // Where a session is now: a third of real sessions leave the folder they began in.
  async latestCwd(file, size, mtimeMs) {
    const known = this.tails.get(file)
    if (known?.mtimeMs === mtimeMs) return known.cwd
    let cwd = null
    try {
      const rows = lines(await readSlice(file, Math.max(0, size - META_BYTES), META_BYTES))
      for (let i = rows.length - 1; i >= 0 && !cwd; i--) {
        const row = rows[i].includes('"cwd"') ? parsed(rows[i]) : null
        if (typeof row?.cwd === 'string') cwd = row.cwd
      }
    } catch {}
    this.tails.set(file, { mtimeMs, cwd })
    return cwd
  }

  async discover(now) {
    const base = path.join(this.claudeHome, 'projects')
    const seen = new Set()
    const recent = []
    this.limited = false
    for (const project of await entries(base)) {
      if (!project.isDirectory()) continue
      for (const e of await entries(path.join(base, project.name))) {
        if (!e.isFile() || !e.name.endsWith('.jsonl')) continue
        if (seen.size >= MAX_CANDIDATES) { this.limited = true; break }
        const file = path.join(base, project.name, e.name)
        seen.add(file)
        try {
          const { mtimeMs, size } = await fs.stat(file)
          if (now - mtimeMs < RECENT_MS) recent.push({ file, mtimeMs, size })
        } catch {}
      }
    }
    const watched = []
    for (const { file, mtimeMs, size } of recent.sort((a, b) => b.mtimeMs - a.mtimeMs)) {
      if (watched.length >= MAX_WATCHED) break
      const meta = await this.metadata(file)
      if (!meta) continue
      if (this.wants(meta.cwd)) { watched.push(file); continue }
      const cwd = await this.latestCwd(file, size, mtimeMs)
      if (cwd && this.wants(cwd)) watched.push(file)
    }
    this.watched = watched
    for (const file of this.tails.keys()) if (!seen.has(file)) this.tails.delete(file)
    if (!this.limited) for (const file of Object.keys(this.cursors)) if (!seen.has(file)) delete this.cursors[file]
  }
}
