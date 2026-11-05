// Lists a repo and chooses its areas on a worker thread, so a big repo never holds up
// Map's event loop. Reads only. Git is told not to take locks or run a repo's fsmonitor.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { parentPort, workerData } from 'node:worker_threads'
import { IGNORE, TMP_FILE, chooseAreas, describeAreas } from './areas.mjs'

const WALK_BUDGET = 50000
const WALK_DEPTH = 12
const MAX_IGNORED = 20000

function git(repo, args) {
  return execFileSync('git', ['-c', 'core.fsmonitor=false', ...args], {
    cwd: repo, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, timeout: 30000,
    stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  })
}
const nulList = (text) => text.split('\0').filter(Boolean)
const keep = (f) => !IGNORE.test(f) && !TMP_FILE.test(f)

function gitList(repo) {
  let files
  try { files = nulList(git(repo, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])) } catch { return null }
  let ignored = []
  try { ignored = nulList(git(repo, ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory'])).slice(0, MAX_IGNORED).map((p) => p.replace(/\/$/, '')) } catch {}
  return { source: 'git', files: [...new Set(files)].filter(keep), ignored, truncated: false }
}

function walkList(repo) {
  const files = []
  const queue = [{ dir: repo, rel: '', depth: 0 }]
  let truncated = false
  for (let i = 0; i < queue.length; i++) {
    const { dir, rel, depth } = queue[i]
    let entries = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (!keep(r)) continue
      if (files.length >= WALK_BUDGET) { truncated = true; break }
      if (e.isDirectory()) { if (depth < WALK_DEPTH) queue.push({ dir: path.join(dir, e.name), rel: r, depth: depth + 1 }); else truncated = true }
      else if (e.isFile()) files.push(r)
    }
  }
  return { source: 'folders', files, ignored: [], truncated }
}

const { repo, heat, current } = workerData
const listed = gitList(repo) ?? walkList(repo)
parentPort.postMessage({
  source: listed.source, files: listed.files.length, truncated: listed.truncated, ignored: listed.ignored,
  next: describeAreas(chooseAreas(listed.files, heat), listed.files, heat),
  current: describeAreas(current, listed.files, heat),
})
