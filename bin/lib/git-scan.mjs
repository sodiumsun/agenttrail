// Reads a repo's history on a worker thread, so a big repo never holds up Map's event loop.
// Read-only, and it must stay that way: only the commands below ever run, git is told to
// take no optional locks and not to run a repo's fsmonitor, and nothing touches the network.
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import { parentPort, workerData } from 'node:worker_threads'
import { ENOUGH_COMMITS, LOG_FORMAT, MAX_COMMITS, MAX_SHAPE, WINDOWS, parseLog, parseRefs, parseWorktrees, readHistory } from './workstreams.mjs'

const MAX_IGNORED = 20000
const DAY = 86400e3

function git(cwd, args, timeout = 30000) {
  return execFileSync('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.quotePath=false', ...args], {
    cwd, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, timeout,
    stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  })
}
const attempt = (fn, fallback = null) => { try { return fn() } catch { return fallback } }

function history(repo, detached, prefix, now) {
  const log = (extra) => parseLog(git(repo, ['log', '--branches', '--remotes', ...detached, `--max-count=${MAX_COMMITS}`, `--format=${LOG_FORMAT}`, '--name-only', '--no-renames', ...extra]), prefix)
  for (const days of WINDOWS) {
    const commits = log([`--since=${Math.floor((now - days * DAY) / 1000)}`])
    if (commits.filter((c) => c.parents.length < 2).length >= ENOUGH_COMMITS) return { commits, days }
  }
  return { commits: log([]), days: null } // a repo this quiet shows what it has, however old
}

function scan({ repo, live, keep, print, ignoredDue }) {
  const prefix = attempt(() => git(repo, ['rev-parse', '--show-prefix']).trim())
  if (prefix === null) return { git: false }
  const refsText = git(repo, ['for-each-ref', '--format=%(objectname)%00%(refname)', 'refs/heads', 'refs/remotes'])
  const worktreesText = git(repo, ['worktree', 'list', '--porcelain'])
  const seen = crypto.createHash('sha1').update(`${refsText}\0${worktreesText}\0${live.join('\0')}`).digest('hex')
  if (seen === print) return { same: true }
  const refs = parseRefs(refsText), worktrees = parseWorktrees(worktreesText)
  const ignored = ignoredDue ? attempt(() => git(repo, ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory']).split('\0').filter(Boolean).slice(0, MAX_IGNORED).map((p) => p.replace(/\/$/, ''))) : null
  if (!refs.length) return { git: true, empty: true, print: seen, ignored }
  const now = Date.now()
  const branchTips = new Set(refs.map((r) => r.sha))
  const detached = [...new Set(worktrees.filter((w) => !w.branch && w.head && !branchTips.has(w.head)).map((w) => w.head))]
  const { commits, days } = history(repo, detached, prefix, now)
  const originHead = attempt(() => git(repo, ['symbolic-ref', '-q', 'refs/remotes/origin/HEAD']).trim())
  // Under a subfolder a branch is only the commits that reached it, so the window is all to go on.
  const shape = prefix ? null : attempt(() => parseLog(git(repo, ['log', '--branches', '--remotes', ...detached, `--max-count=${MAX_SHAPE}`, `--format=${LOG_FORMAT}`])))
  const seenHistory = readHistory({ refs, worktrees, commits, shape, originHead, live, keep, days })
  // Only for the handful on cards: a walk of every worktree is what this must never do.
  for (const s of seenHistory.streams) {
    if (s.worktree) s.dirty = attempt(() => git(s.worktree, ['status', '--porcelain', '--ignore-submodules=all'], 5000).split('\n').filter(Boolean).length)
    if (!s.commits && s.head) {
      const [ct, subject] = attempt(() => git(repo, ['log', '-1', '--format=%ct%x00%s', s.head]).trim().split('\0'), [])
      if (subject !== undefined) s.last = { s: subject, at: Number(ct) * 1000 }
    }
  }
  return { git: true, print: seen, ignored, ...seenHistory }
}

parentPort.postMessage(attempt(() => scan(workerData), { failed: true }))
