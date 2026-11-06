// Superpowers (github.com/obra/superpowers) keeps its own plan trail:
//   docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md   brainstorming's design spec
//   docs/superpowers/plans/YYYY-MM-DD-<feature>.md        writing-plans' task-by-task plan
//   .superpowers/sdd/<plan>/progress.md                   the executor's ledger: "Task N: complete"
// A ledger names its plan ("# SDD ledger — plan: <path>", or a plan-path file beside it),
// so a plan kept anywhere in the repo is found through its ledger. A ledger committed
// next to the plans (…-ledger.md) is read as a ledger, not as another plan.
//
// Each feature (a plan, its spec, or both) becomes one card on the map. Tasks come
// from the plan's `### Task N:` headings; a task is done when a ledger says so or
// every one of its step boxes is ticked. Most executors tick nothing and drop the
// ledger when the work ends, so a plan with neither says its progress is not
// recorded rather than claiming nothing was done. A plan trail grows for months,
// so only features whose files changed recently are shown. Read-only, like the rest of Map.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export const SP_DOCS = 'docs/superpowers'
export const SP_LEDGERS = '.superpowers/sdd'
const MAX_FILES = 400 // per folder: a plan trail, not an archive
const MAX_BYTES = 1_000_000
export const RECENT_DAYS = 14 // a feature whose plan, spec and ledger are all older than this leaves the map
const MAX_CARDS = 12 // newest first, even within the window

const DATED = /^(\d{4}-\d{2}-\d{2})-(.+)$/
const TASK_HEAD = /^#{2,4}\s+Task\s+(\d+[a-z]?)\s*[:.\-—]\s*(.+?)\s*$/i
const STEP = /^\s*[-*]\s+\[( |x|X)\]\s+/
const FILE_ITEM = /^\s*[-*]\s+(?:Create|Modify|Test|Update|Delete|Edit|Add)\s*:\s*`([^`]+)`/i
const SPEC_LINE = /^\s*\*\*Spec:\*\*\s*`?([^`\s]+\.md)`?/i
const GOAL_LINE = /^\s*\*\*Goal:\*\*\s*(.+?)\s*$/i
const LEDGER_HEAD = /^#\s*SDD ledger\s*[—–-]+\s*plan:\s*(.+?)\s*$/i
const LEDGER_DONE = /^\s*Task\s+(\d+[a-z]?)\s*:\s*complete\b/i

const slugId = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'feature'
const posix = p => p.split(path.sep).join('/')
const tidy = s => s.replace(/\*\*/g, '').replace(/[\s—–:\-]+$/, '').trim()

function readSmall(file) {
  try {
    const st = fs.statSync(file)
    if (!st.isFile() || st.size > MAX_BYTES) return null
    return { text: fs.readFileSync(file, 'utf8'), mtime: st.mtimeMs }
  } catch { return null }
}
function listMd(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isFile() && d.name.toLowerCase().endsWith('.md'))
      .map(d => d.name).sort().reverse().slice(0, MAX_FILES)
  } catch { return [] }
}
// A path a document names, as repo-relative posix — or null when it leaves the repo or is not markdown.
function inRepo(repo, p) {
  if (!p || !/\.md$/i.test(p)) return null
  const abs = path.resolve(repo, p)
  const rel = path.relative(repo, abs)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null
  return posix(rel)
}
// Lines outside ``` / ~~~ fences: a plan's code samples are full of checkboxes and headings.
function prose(text) {
  const out = []
  let fence = null
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '')
    const m = line.match(/^\s*(`{3,}|~{3,})/)
    if (m) {
      if (!fence) fence = m[1][0]
      else if (m[1][0] === fence) fence = null
      continue
    }
    if (!fence) out.push(line)
  }
  return out
}
function heading(lines) {
  const h = lines.find(l => /^#\s+/.test(l))
  return h ? h.replace(/^#\s+/, '').trim() : ''
}
// "2026-11-06-live-map.md" -> { date, slug: "live-map" }; a spec drops its "-design" tail, a plan its "-plan".
function nameParts(file, spec) {
  const base = path.basename(file, path.extname(file))
  const m = base.match(DATED)
  let slug = m ? m[2] : base
  slug = spec ? slug.replace(/-(design|spec)$/i, '') : slug.replace(/-plan$/i, '')
  return { date: m ? m[1] : '', slug }
}

export function parseSpPlan(text) {
  const lines = prose(text)
  const title = tidy(heading(lines).replace(/\s+implementation\s+plan\s*$/i, ''))
  let goal = '', spec = '', cur = null, inFiles = false
  const tasks = []
  for (const line of lines) {
    let m
    if (!goal && (m = line.match(GOAL_LINE))) { goal = m[1]; continue }
    if (!spec && (m = line.match(SPEC_LINE))) { spec = m[1]; continue }
    if ((m = line.match(TASK_HEAD))) {
      cur = { n: m[1].toLowerCase(), title: tidy(m[2]), files: [], steps: 0, ticked: 0 }
      tasks.push(cur)
      inFiles = false
      continue
    }
    if (/^#{1,3}\s+/.test(line)) { cur = null; continue } // a later section (e.g. "## Self-review") ends the task list
    if (!cur) continue
    if (/^\s*\*\*Files:?\*\*:?\s*$/i.test(line)) { inFiles = true; continue }
    if (inFiles && (m = line.match(FILE_ITEM))) { cur.files.push(m[1].replace(/:\d+(?:-\d+)?$/, '').trim()); continue }
    if (inFiles && line.trim() && !FILE_ITEM.test(line)) inFiles = false
    if ((m = line.match(STEP))) { cur.steps++; if (m[1] !== ' ') cur.ticked++ }
  }
  return { title, goal, spec, tasks }
}

// A ledger names its plan in its "# SDD ledger — plan: <path>" line, near the top. null when the text is no ledger.
export function parseLedger(text) {
  const lines = text.split('\n')
  let plan = null
  for (const l of lines.slice(0, 15)) { const m = l.replace(/\r$/, '').match(LEDGER_HEAD); if (m) { plan = m[1].replace(/^`|`$/g, ''); break } }
  if (plan === null) return null
  const done = new Set()
  for (const l of lines) { const d = l.match(LEDGER_DONE); if (d) done.add(d[1].toLowerCase()) }
  return { plan, done }
}

// When each file last changed: its last commit, or its time on disk while it is new or edited.
// One bounded, read-only git call for the window; outside git, times on disk.
function changeTimes(repo, rels, sinceMs) {
  const out = new Map()
  const disk = rel => { try { return fs.statSync(path.join(repo, rel)).mtimeMs } catch { return 0 } }
  const git = args => execFileSync('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.quotePath=false', ...args], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 8 << 20, timeout: 4000 })
  let tracked = null, dirty = null
  const committed = new Map()
  try {
    const dirs = [...new Set(rels.map(r => path.posix.dirname(r)))]
    const prefix = git(['rev-parse', '--show-prefix']).trim() // status and log name paths from the git root; Map's repo may sit below it
    const own = p => p.startsWith(prefix) ? p.slice(prefix.length) : null
    tracked = new Set(git(['ls-files', '-z', '--', ...dirs]).split('\0').filter(Boolean))
    // -z status entries: "XY path"; a rename carries its old path as the next entry, which is skipped
    const entries = git(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', ...dirs]).split('\0')
    dirty = new Set()
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]
      if (!e) continue
      const p = own(e.slice(3))
      if (p) dirty.add(p)
      if (e[0] === 'R' || e[0] === 'C') i++
    }
    let at = 0
    for (const line of git(['log', `--since=${Math.floor(sinceMs / 1000)}`, '--format=%x01%ct', '--name-only', '--', ...dirs]).split('\n')) {
      if (line.startsWith('\x01')) { at = Number(line.slice(1)) * 1000; continue }
      const p = line && own(line)
      if (p && !committed.has(p)) committed.set(p, at)
    }
  } catch { tracked = null }
  for (const rel of rels) {
    if (!tracked || !tracked.has(rel) || dirty.has(rel)) out.set(rel, Math.max(disk(rel), committed.get(rel) || 0)) // new, edited, ignored or no git
    else out.set(rel, committed.get(rel) || 0) // committed and clean: only a commit in the window counts
  }
  return out
}

function readLedgers(repo, read) {
  const base = path.join(repo, SP_LEDGERS)
  const out = []
  let dirs = []
  try { dirs = fs.readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory()).slice(0, MAX_FILES) } catch { return out }
  for (const d of dirs) {
    const marker = readSmall(path.join(base, d.name, 'plan-path'))
    const got = readSmall(path.join(base, d.name, 'progress.md'))
    const led = got && parseLedger(got.text)
    const plan = inRepo(repo, marker?.text.trim() || led?.plan || '')
    if (!plan) continue
    const rel = `${SP_LEDGERS}/${d.name}/${got ? 'progress.md' : 'plan-path'}`
    read.push(rel)
    out.push({ rel, plan, done: led?.done || new Set() })
  }
  return out
}

// Everything Superpowers has written in this repo, as Map plan nodes.
// Returns { nodes, files, found }: files are what was read (repo-relative), found is false with no trail at all.
export function readSuperpowers(repo, { now = Date.now(), days = RECENT_DAYS } = {}) {
  const read = []
  const ledgers = readLedgers(repo, read)
  const plans = new Map() // rel -> { rel, text }
  const specs = new Map() // rel -> spec
  const planDir = `${SP_DOCS}/plans`, specDir = `${SP_DOCS}/specs`
  for (const name of listMd(path.join(repo, planDir))) {
    const rel = `${planDir}/${name}`
    const got = readSmall(path.join(repo, rel))
    if (!got) continue
    read.push(rel)
    const led = parseLedger(got.text)
    if (led) { const plan = inRepo(repo, led.plan); if (plan) ledgers.push({ rel, plan, done: led.done }); continue }
    plans.set(rel, { rel, text: got.text })
  }
  for (const l of ledgers) { // a plan kept outside docs/superpowers is found through its ledger
    if (plans.has(l.plan)) continue
    const got = readSmall(path.join(repo, l.plan))
    if (got) { read.push(l.plan); plans.set(l.plan, { rel: l.plan, text: got.text }) }
  }
  const addSpec = (rel, text) => {
    read.push(rel)
    specs.set(rel, { rel, title: tidy(heading(prose(text)).replace(/^design\s*[:—-]\s*/i, '').replace(/\s*[:—-]?\s*design(\s+(doc|spec))?\s*$/i, '')), ...nameParts(rel, true), used: false })
  }
  for (const name of listMd(path.join(repo, specDir))) {
    const got = readSmall(path.join(repo, specDir, name))
    if (got) addSpec(`${specDir}/${name}`, got.text)
  }
  if (!plans.size && !specs.size) return { nodes: [], files: read, found: false }

  const features = []
  for (const p of plans.values()) {
    const plan = parseSpPlan(p.text)
    const own = ledgers.filter(l => l.plan === p.rel)
    if (!plan.tasks.length && !own.length) continue // findings, rulings, roadmaps: kept beside the plans, but not plans
    const parts = nameParts(p.rel, false)
    let spec = null
    const named = inRepo(repo, plan.spec)
    if (named && !specs.has(named)) { const got = readSmall(path.join(repo, named)); if (got) addSpec(named, got.text) } // a spec kept elsewhere, named by its plan
    if (named) spec = specs.get(named) || null
    if (!spec) spec = [...specs.values()].find(s => !s.used && s.slug === parts.slug && s.rel.startsWith(specDir + '/')) || null
    if (spec) spec.used = true
    const done = new Set(own.flatMap(l => [...l.done]))
    features.push({ rel: p.rel, plan, parts, spec, ledgers: own, done })
  }
  for (const spec of specs.values()) if (!spec.used && spec.rel.startsWith(specDir + '/')) features.push({ rel: null, plan: null, parts: { date: spec.date, slug: spec.slug }, spec, ledgers: [], done: new Set() })

  const since = now - days * 86400e3
  const times = changeTimes(repo, [...new Set(features.flatMap(f => [f.rel, f.spec?.rel, ...f.ledgers.map(l => l.rel)]).filter(Boolean))], since)
  const cards = []
  const seen = new Set()
  for (const f of features) {
    const changedAt = Math.max(0, ...[f.rel, f.spec?.rel, ...f.ledgers.map(l => l.rel)].filter(Boolean).map(r => times.get(r) || 0))
    if (changedAt < since) continue
    let id = 'sp-' + slugId(f.parts.slug)
    for (let i = 2; seen.has(id); i++) id = `sp-${slugId(f.parts.slug)}-${i}`
    seen.add(id)
    const title = f.plan?.title || f.spec?.title || f.parts.slug.replace(/-/g, ' ')
    // Only what Superpowers recorded: the plan's own tasks, ticked steps, ledger lines. A spec with no plan has no tasks yet.
    const tasks = []
    for (const t of f.plan?.tasks || []) {
      const status = f.done.has(t.n) || (t.steps > 0 && t.ticked === t.steps) ? 'done' : t.ticked > 0 ? 'active' : 'pending'
      tasks.push({ id: `${id}-t${slugId(t.n)}`, title: `Task ${t.n}: ${t.title}`, tech: t.files.slice(0, 3).join(', '), status })
    }
    const recorded = f.ledgers.length > 0 || (f.plan?.tasks || []).some(t => t.ticked > 0)
    const files = [...new Set([f.rel, f.spec?.rel, ...(f.plan?.tasks || []).flatMap(t => t.files)].filter(Boolean))]
    const status = tasks.some(t => t.status === 'active') ? 'active' : tasks.length && tasks.every(t => t.status === 'done') ? 'done' : 'pending'
    const tech = `superpowers ${f.plan ? 'plan' : 'spec'}${f.parts.date ? ' · ' + f.parts.date : ''}`
    cards.push({ id, title, tech, changedAt, status, files, tasks, progress: tasks.length && !recorded ? 'unrecorded' : '' })
  }
  cards.sort((a, b) => b.changedAt - a.changedAt)

  const nodes = []
  for (const c of cards.slice(0, MAX_CARDS)) {
    nodes.push({ id: c.id, title: c.title, level: 'component', parent: null, needs: [], links: [], files: c.files, tech: c.tech, by: '', kind: '', url: '', status: c.status, progress: c.progress, source: 'superpowers' })
    for (const t of c.tasks) nodes.push({ id: t.id, title: t.title, level: 'task', parent: c.id, needs: [], links: [], tech: t.tech, by: '', src: '', status: t.status, source: 'superpowers' })
  }
  return { nodes, files: [...new Set(read)], found: true }
}

// A cheap fingerprint of what readSuperpowers reads: names, sizes and times only.
// Where the repo cannot be watched recursively, Map polls this instead of the folders.
export function superpowersStamp(repo, known = []) {
  const parts = []
  const add = rel => { try { const st = fs.statSync(path.join(repo, rel)); parts.push(`${rel}:${st.size}:${st.mtimeMs}`) } catch { parts.push(`${rel}:-`) } }
  for (const sub of ['specs', 'plans']) for (const name of listMd(path.join(repo, SP_DOCS, sub))) add(`${SP_DOCS}/${sub}/${name}`)
  try {
    for (const d of fs.readdirSync(path.join(repo, SP_LEDGERS), { withFileTypes: true }).filter(d => d.isDirectory()).slice(0, MAX_FILES)) {
      add(`${SP_LEDGERS}/${d.name}/progress.md`)
      add(`${SP_LEDGERS}/${d.name}/plan-path`)
    }
  } catch {}
  for (const rel of known) add(rel)
  return parts.join('\n')
}

// Writes under these paths change what readSuperpowers returns. Plans and specs kept elsewhere are passed in.
export const isSuperpowersPath = (rel, known = []) => rel === SP_DOCS || rel.startsWith(SP_DOCS + '/') || rel === SP_LEDGERS || rel.startsWith(SP_LEDGERS + '/') || known.includes(rel)
