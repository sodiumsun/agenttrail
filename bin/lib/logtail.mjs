// The bounded, restart-safe log reading shared by the provider adapters. Strictly
// read-only: this file opens logs for reading and writes nothing beside them. Real
// logs reach a gigabyte, so a poll only ever reads a bounded tail.
import fs from 'node:fs/promises'

export const READ_LIMIT = 2 * 1024 * 1024
export const RECENT_MS = 2 * 3600e3 // a Map run lives this long after its last event
export const META_BYTES = 256 * 1024
export const DISCOVER_MS = 10_000
export const MAX_CANDIDATES = 10_000
export const MAX_WATCHED = 120
export const MAX_PENDING = 64
const MAX_SEEN = 64

export async function entries(dir) {
  try { return await fs.readdir(dir, { withFileTypes: true }) } catch { return [] }
}
export const remember = (cursor, id) => {
  if (!id) return false
  cursor.seen ||= []
  if (cursor.seen.includes(id)) return true
  cursor.seen.push(id)
  if (cursor.seen.length > MAX_SEEN) cursor.seen.shift()
  return false
}
// Holds a proposal until its result arrives, dropping the oldest past the limit.
export function hold(cursor, id, call) {
  cursor.pending ||= {}
  cursor.pending[id] = call
  const ids = Object.keys(cursor.pending)
  if (ids.length > MAX_PENDING) delete cursor.pending[ids[0]]
}

export class LogTailReader {
  // wants(cwd) decides which sessions belong to this repo. apply(meta, effects)
  // receives a file's effects. cursors is shared by reference so the caller can
  // save it atomically with the runs those effects produced. A subclass supplies
  // discover(now), which fills this.watched, and rowEffects(row, meta, cursor).
  constructor({ wants, apply, cursors = {} }) {
    Object.assign(this, { wants, apply, cursors })
    this.meta = new Map()
    this.watched = []
    this.lastDiscovery = 0
    this.busy = false
    this.limited = false
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
      effects.push(...this.rowEffects(row, meta, cursor))
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
