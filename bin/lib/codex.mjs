// Reads local Codex session logs. Strictly read-only: this file opens logs for
// reading and writes nothing under the Codex home. Real logs reach a gigabyte,
// so a poll only ever reads a bounded tail.
import fs from 'node:fs/promises'
import path from 'node:path'
import { clean, taskList } from './tasks.mjs'

export const READ_LIMIT = 2 * 1024 * 1024
export const RECENT_MS = 2 * 3600e3 // a Map run lives this long after its last event
const META_BYTES = 256 * 1024
const DISCOVER_MS = 10_000
const MAX_CANDIDATES = 10_000
const MAX_WATCHED = 120
const MAX_PENDING = 64
const MAX_SEEN = 64
const DETAIL = 90

// Recent Codex runs its tools inside this code wrapper and reports each real
// operation as an item, so the wrapper itself is never shown as finished work.
const WRAPPER_TOOLS = new Set(['exec'])
const PLAN_ACK = /^plan updated\.?$/i
const PATCH_ACK = /^Success\. Updated the following files/m
const PATCH_FILE = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm

function commandText(command) {
  if (typeof command === 'string') return command
  if (!Array.isArray(command)) return ''
  return command.length >= 3 && /^-l?c$/.test(command[1]) ? String(command.at(-1)) : command.join(' ')
}
const short = v => clean(v, DETAIL)
function parseArgs(text) {
  try {
    const args = JSON.parse(text || '{}')
    return args && typeof args === 'object' ? args : {}
  } catch { return {} }
}
function outputText(output) {
  if (typeof output === 'string') return output
  if (Array.isArray(output)) return output.map(block => block?.text ?? '').join('\n')
  return outputText(output?.content ?? '')
}
function exitCode(text) {
  try {
    const parsed = JSON.parse(text)
    const code = parsed?.metadata?.exit_code ?? parsed?.exit_code
    if (typeof code === 'number') return code
    if (parsed?.success === false) return 1
  } catch {}
  const m = /^Exit code: (-?\d+)/m.exec(text)
  return m ? Number(m[1]) : null
}
const remember = (cursor, id) => {
  if (!id) return false
  cursor.seen ||= []
  if (cursor.seen.includes(id)) return true
  cursor.seen.push(id)
  if (cursor.seen.length > MAX_SEEN) cursor.seen.shift()
  return false
}
const durationMs = (d, fallback) => d && typeof d.secs === 'number' ? Math.round(d.secs * 1000 + (d.nanos || 0) / 1e6) : fallback

function changedFiles(changes) {
  if (Array.isArray(changes)) return changes.map(c => c?.path).filter(f => typeof f === 'string')
  return changes && typeof changes === 'object' ? Object.keys(changes) : []
}

function itemEffect(item, at, ms) {
  const failed = item.status === 'failed'
  switch (item.type) {
    case 'CommandExecution': {
      const kind = Array.isArray(item.parsed_cmd) ? item.parsed_cmd.at(-1)?.type : null
      const name = { read: 'Read', search: 'Search', list_files: 'List' }[kind] || 'Shell'
      const error = failed || (typeof item.exit_code === 'number' && item.exit_code !== 0)
      return { name, detail: short(commandText(item.command)), ms: durationMs(item.duration, ms), error }
    }
    case 'FileChange': {
      const files = changedFiles(item.changes)
      return { name: 'Edit', detail: short(files.length === 1 ? files[0] : `${files.length} files`), ms, error: item.status !== 'completed', files: item.status === 'completed' ? files : [] }
    }
    case 'McpToolCall':
      return { name: short(`${item.server}.${item.tool}`), detail: '', ms: durationMs(item.duration, ms), error: failed || !!item.result?.isError }
    case 'WebSearch':
      return { name: 'WebSearch', detail: short(item.query), ms, error: false }
    case 'ImageView':
      return { name: 'ImageView', detail: short(item.path), ms, error: false }
    case 'Extension':
      return /web.?search/i.test(item.kind || '') ? { name: 'WebSearch', detail: short(item.query), ms, error: false } : null
    default:
      return null
  }
}

function startCall(p, at, cursor) {
  const args = p.type === 'function_call' ? parseArgs(p.arguments) : {}
  const name = short(p.namespace ? `${p.namespace}.${p.name}` : p.name)
  const patch = typeof p.input === 'string' ? p.input : typeof args.input === 'string' ? args.input : ''
  const isPatch = /apply_patch$/.test(p.name || '')
  const call = {
    name, at,
    detail: WRAPPER_TOOLS.has(p.name) ? '' : short(commandText(args.command ?? args.cmd) || args.file_path || args.path || args.query || ''),
    ...(/update_plan$/.test(p.name || '') ? { plan: taskList(args.plan) } : {}),
    ...(isPatch ? { files: [...patch.matchAll(PATCH_FILE)].map(m => m[1].trim()) } : {}),
  }
  cursor.pending ||= {}
  cursor.pending[p.call_id] = call
  const ids = Object.keys(cursor.pending)
  if (ids.length > MAX_PENDING) delete cursor.pending[ids[0]]
  return [{ kind: 'tool-start', at, callId: p.call_id, name, detail: call.detail }]
}

function finishCall(p, at, cursor) {
  const call = cursor.pending?.[p.call_id]
  if (!call) return [] // its start lies outside what was read: nothing is known about it
  delete cursor.pending[p.call_id]
  const text = outputText(p.output)
  const code = exitCode(text)
  const error = p.output?.success === false || (code !== null && code !== 0)
  const duplicate = remember(cursor, p.call_id)
  const effects = [{
    kind: 'tool-end', at, callId: p.call_id, name: call.name, detail: call.detail, ms: Math.max(0, at - call.at), error,
    record: !WRAPPER_TOOLS.has(call.name) && !duplicate,
    files: call.files && !error && (code === 0 || PATCH_ACK.test(text)) ? call.files : [],
  }]
  if (call.plan && !error && PLAN_ACK.test(text.trim())) effects.push({ kind: 'tasks', at, list: call.plan })
  return effects
}

// Turns one log row into run effects. A proposal waits in cursor.pending for its
// result; a turn that ends first abandons it, so a late result cannot commit it.
export function codexEffects(row, meta, cursor) {
  const at = Date.parse(row?.timestamp)
  if (!Number.isFinite(at)) return []
  const p = row.payload || {}
  if (row.type === 'event_msg') {
    if (p.type === 'task_started') return [{ kind: 'turn-start', at }]
    if (p.type === 'task_complete' || p.type === 'turn_aborted') {
      cursor.pending = {}
      return [{ kind: p.type === 'task_complete' ? 'turn-end' : 'interrupted', at }]
    }
    if (p.type === 'item_completed') {
      if (typeof p.item?.id !== 'string' || (p.thread_id && p.thread_id !== meta.id)) return []
      const when = Number(p.completed_at_ms) || at
      const tool = itemEffect(p.item, when, Number(p.completed_at_ms) && Number(p.started_at_ms) ? p.completed_at_ms - p.started_at_ms : 0)
      if (!tool || remember(cursor, p.item.id)) return []
      return [{ kind: 'tool-end', at: when, record: true, files: [], ...tool }]
    }
    return []
  }
  if (row.type === 'response_item') {
    if (['function_call', 'custom_tool_call'].includes(p.type) && p.call_id) return startCall(p, at, cursor)
    if (['function_call_output', 'custom_tool_call_output'].includes(p.type)) return finishCall(p, at, cursor)
  }
  return []
}

async function entries(dir) {
  try { return await fs.readdir(dir, { withFileTypes: true }) } catch { return [] }
}
const numberedDirs = async (dir, digits) => (await entries(dir)).filter(e => e.isDirectory() && new RegExp(`^\\d{${digits}}$`).test(e.name)).map(e => path.join(dir, e.name))

export class CodexLogReader {
  // wants(cwd) decides which sessions belong to this repo. apply(meta, effects)
  // receives a file's effects. cursors is shared by reference so the caller can
  // save it atomically with the runs those effects produced.
  constructor({ codexHome, wants, apply, cursors = {} }) {
    Object.assign(this, { codexHome, wants, apply, cursors })
    this.meta = new Map()
    this.watched = []
    this.lastDiscovery = 0
    this.busy = false
    this.limited = false
  }

  async metadata(file) {
    if (this.meta.has(file)) return this.meta.get(file)
    let handle
    try {
      handle = await fs.open(file, 'r')
      const buffer = Buffer.alloc(META_BYTES)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      const end = buffer.subarray(0, bytesRead).indexOf(10)
      if (end < 0) return null // still being written: look again later
      const row = JSON.parse(buffer.toString('utf8', 0, end))
      const p = row.type === 'session_meta' ? row.payload : null
      const id = p?.session_id || p?.sessionId || p?.id
      const meta = typeof p?.cwd === 'string' && typeof id === 'string'
        ? { id: clean(id, 200), cwd: p.cwd, startedAt: Date.parse(p.timestamp || row.timestamp) || null, parentId: p.source?.subagent?.thread_spawn?.parent_thread_id || null }
        : null
      this.meta.set(file, meta)
      return meta
    } catch {
      return null
    } finally {
      await handle?.close()
    }
  }

  async discover(now) {
    const base = path.join(this.codexHome, 'sessions')
    const seen = new Set()
    const recent = []
    this.limited = false
    // Resumed sessions stay in the folder of the day they began, so every day is walked.
    for (const year of await numberedDirs(base, 4)) for (const month of await numberedDirs(year, 2)) for (const day of await numberedDirs(month, 2)) {
      for (const e of await entries(day)) {
        if (!e.isFile() || !e.name.endsWith('.jsonl')) continue
        if (seen.size >= MAX_CANDIDATES) { this.limited = true; break }
        const file = path.join(day, e.name)
        seen.add(file)
        try {
          const { mtimeMs } = await fs.stat(file)
          if (now - mtimeMs < RECENT_MS) recent.push({ file, mtimeMs })
        } catch {}
      }
    }
    const watched = []
    for (const { file } of recent.sort((a, b) => b.mtimeMs - a.mtimeMs)) {
      const meta = await this.metadata(file)
      if (meta && this.wants(meta.cwd) && watched.length < MAX_WATCHED) watched.push(file)
    }
    this.watched = watched
    if (!this.limited) for (const file of Object.keys(this.cursors)) if (!seen.has(file)) delete this.cursors[file]
  }

  // Reads what is new in one file. The cursor stops at the last complete line,
  // so a row still being written, or split by a read, is read whole next time.
  async readNew(file) {
    const { size } = await fs.stat(file)
    let cursor = this.cursors[file] ||= { offset: 0 }
    if (size < cursor.offset) cursor = this.cursors[file] = { offset: 0 }
    if (size === cursor.offset) return false
    let start = cursor.offset
    let dropFirst = !!cursor.dropFirst
    if (size - start > READ_LIMIT) {
      start = size - READ_LIMIT
      dropFirst = true
      cursor.limited = true
    }
    const buffer = Buffer.alloc(size - start)
    const handle = await fs.open(file, 'r')
    try { await handle.read(buffer, 0, buffer.length, start) } finally { await handle.close() }
    const last = buffer.lastIndexOf(10)
    if (last < 0) {
      if (buffer.length >= READ_LIMIT) { cursor.offset = size; cursor.dropFirst = true }
      return false
    }
    const first = dropFirst ? buffer.indexOf(10) + 1 : 0
    cursor.offset = start + last + 1
    cursor.dropFirst = false
    const meta = { ...this.meta.get(file), limited: !!cursor.limited }
    const effects = []
    for (const line of buffer.toString('utf8', first, last + 1).split('\n')) {
      if (!line) continue
      let row
      try { row = JSON.parse(line) } catch { continue }
      effects.push(...codexEffects(row, meta, cursor))
    }
    if (effects.length) this.apply(meta, effects)
    return effects.length > 0
  }

  async poll(now = Date.now()) {
    if (this.busy) return false
    this.busy = true
    let changed = false
    try {
      if (now - this.lastDiscovery >= DISCOVER_MS) {
        this.lastDiscovery = now
        await this.discover(now)
      }
      for (const file of this.watched) {
        try { changed = await this.readNew(file) || changed } catch {} // a log that vanished is simply gone
      }
    } finally {
      this.busy = false
    }
    return changed
  }
}
