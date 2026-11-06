// Superpowers (github.com/obra/superpowers) keeps its own plan trail:
//   docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md   brainstorming's design spec
//   docs/superpowers/plans/YYYY-MM-DD-<feature>.md        writing-plans' task-by-task plan
//   .superpowers/sdd/<plan>/progress.md                   the executor's ledger: "Task N: complete"
// Each feature (a plan, its spec, or both) becomes one card on the map. Tasks
// come from the plan's `### Task N:` headings; a task is done when the ledger
// says so or every one of its step checkboxes is ticked. Read-only, like the rest of Map.
import fs from 'node:fs'
import path from 'node:path'

export const SP_DOCS = 'docs/superpowers'
export const SP_LEDGERS = '.superpowers/sdd'
const MAX_FILES = 200 // per folder: a plan trail, not an archive
const MAX_BYTES = 1_000_000
const DONE_SHOWN = 3 // finished features beyond this many (newest first) leave the map

const DATED = /^(\d{4}-\d{2}-\d{2})-(.+)$/
const TASK_HEAD = /^#{2,4}\s+Task\s+(\d+)\s*[:.\-—]\s*(.+?)\s*$/i
const STEP = /^\s*[-*]\s+\[( |x|X)\]\s+/
const FILE_ITEM = /^\s*[-*]\s+(?:Create|Modify|Test|Update|Delete|Edit|Add)\s*:\s*`([^`]+)`/i
const SPEC_LINE = /^\s*\*\*Spec:\*\*\s*`?([^`\s]+\.md)`?/i
const GOAL_LINE = /^\s*\*\*Goal:\*\*\s*(.+?)\s*$/i
const LEDGER_DONE = /^\s*Task\s+(\d+)\s*:\s*complete\b/i

const slugId = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'feature'
const posix = p => p.split(path.sep).join('/')

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
// "2026-11-06-live-map.md" -> { date, slug: "live-map" }; a spec drops its "-design" tail.
function nameParts(file, spec) {
  const base = path.basename(file, path.extname(file))
  const m = base.match(DATED)
  let slug = m ? m[2] : base
  if (spec) slug = slug.replace(/-(design|spec)$/i, '')
  return { date: m ? m[1] : '', slug }
}

export function parseSpPlan(text) {
  const lines = prose(text)
  const title = heading(lines).replace(/\s+implementation\s+plan\s*$/i, '').trim()
  let goal = '', spec = '', cur = null, inFiles = false
  const tasks = []
  for (const line of lines) {
    let m
    if (!goal && (m = line.match(GOAL_LINE))) { goal = m[1]; continue }
    if (!spec && (m = line.match(SPEC_LINE))) { spec = m[1]; continue }
    if ((m = line.match(TASK_HEAD))) {
      cur = { n: Number(m[1]), title: m[2].replace(/\*\*/g, ''), files: [], steps: 0, ticked: 0 }
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

// The ledger names its plan on line one: "# SDD ledger — plan: <path>".
export function parseLedger(text) {
  const lines = text.split('\n')
  const m = (lines[0] || '').match(/plan:\s*(.+?)\s*$/i)
  const done = new Set()
  for (const l of lines) { const d = l.match(LEDGER_DONE); if (d) done.add(Number(d[1])) }
  return { plan: m ? m[1] : '', done }
}

function readLedgers(repo) {
  const base = path.join(repo, SP_LEDGERS)
  const out = []
  let dirs = []
  try { dirs = fs.readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory()).slice(0, MAX_FILES) } catch { return out }
  for (const d of dirs) {
    const got = readSmall(path.join(base, d.name, 'progress.md'))
    if (!got) continue
    const marker = readSmall(path.join(base, d.name, 'plan-path'))
    const led = parseLedger(got.text)
    out.push({ dir: d.name, plan: (marker?.text.trim() || led.plan), done: led.done, mtime: got.mtime })
  }
  return out
}
// A ledger path may be repo-relative, absolute or Git-Bash shaped; compare on the tail under docs/superpowers.
function samePlan(ledgerPlan, rel) {
  if (!ledgerPlan) return false
  const a = posix(ledgerPlan).replace(/^\.\//, '')
  return a === rel || a.endsWith('/' + rel)
}

// Everything Superpowers has written in this repo, as Map plan nodes.
// Returns { nodes, mtime, found } — found is false when the repo has no Superpowers trail.
export function readSuperpowers(repo) {
  const specDir = path.join(repo, SP_DOCS, 'specs'), planDir = path.join(repo, SP_DOCS, 'plans')
  const specNames = listMd(specDir), planNames = listMd(planDir)
  if (!specNames.length && !planNames.length) return { nodes: [], mtime: null, found: false }
  const ledgers = readLedgers(repo)
  let mtime = 0
  const specs = new Map() // rel path -> spec
  for (const name of specNames) {
    const got = readSmall(path.join(specDir, name))
    if (!got) continue
    mtime = Math.max(mtime, got.mtime)
    const rel = `${SP_DOCS}/specs/${name}`
    const title = heading(prose(got.text)).replace(/^design\s*[:—-]\s*/i, '').replace(/\s*[:—-]?\s*design(\s+(doc|spec))?\s*$/i, '').trim()
    specs.set(rel, { rel, title, ...nameParts(name, true), used: false })
  }
  const features = []
  for (const name of planNames) {
    const got = readSmall(path.join(planDir, name))
    if (!got) continue
    mtime = Math.max(mtime, got.mtime)
    const rel = `${SP_DOCS}/plans/${name}`
    const plan = parseSpPlan(got.text)
    const parts = nameParts(name, false)
    const named = plan.spec && [...specs.values()].find(s => samePlan(plan.spec, s.rel))
    const spec = named || [...specs.values()].find(s => !s.used && s.slug === parts.slug)
    if (spec) spec.used = true
    const ledger = ledgers.filter(l => samePlan(l.plan, rel)).sort((a, b) => b.mtime - a.mtime)[0] ||
      ledgers.find(l => !l.plan && l.dir === path.basename(name, '.md'))
    features.push({ rel, plan, parts, spec, ledger })
  }
  for (const spec of specs.values()) if (!spec.used) features.push({ rel: null, plan: null, parts: { date: spec.date, slug: spec.slug }, spec, ledger: null })

  const cards = []
  const seen = new Set()
  for (const f of features) {
    let id = 'sp-' + slugId(f.parts.slug)
    for (let i = 2; seen.has(id); i++) id = `sp-${slugId(f.parts.slug)}-${i}`
    seen.add(id)
    const title = f.plan?.title || f.spec?.title || f.parts.slug.replace(/-/g, ' ')
    // Only what Superpowers recorded: the plan's own tasks, ticked steps, ledger lines. A spec with no plan has no tasks yet.
    const tasks = []
    for (const t of f.plan?.tasks || []) {
      const ledgered = f.ledger?.done.has(t.n)
      const status = ledgered || (t.steps > 0 && t.ticked === t.steps) ? 'done' : t.ticked > 0 ? 'active' : 'pending'
      tasks.push({ id: `${id}-t${t.n}`, title: `Task ${t.n}: ${t.title}`, tech: t.files.slice(0, 3).join(', '), status })
    }
    const files = [...new Set([f.rel, f.spec?.rel, ...(f.plan?.tasks || []).flatMap(t => t.files)].filter(Boolean))]
    const status = tasks.some(t => t.status === 'active') ? 'active' : tasks.length && tasks.every(t => t.status === 'done') ? 'done' : 'pending'
    const tech = `superpowers ${f.plan ? 'plan' : 'spec'}${f.parts.date ? ' · ' + f.parts.date : ''}`
    cards.push({ id, title, tech, goal: f.plan?.goal || '', date: f.parts.date, status, files, tasks })
  }
  // Newest first; every unfinished feature stays, finished ones only while recent.
  cards.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  let doneKept = 0
  const shown = cards.filter(c => c.status !== 'done' || doneKept++ < DONE_SHOWN)

  const nodes = []
  for (const c of shown) {
    nodes.push({ id: c.id, title: c.title, level: 'component', parent: null, needs: [], links: [], files: c.files, tech: c.tech, by: '', kind: '', url: '', status: c.status, source: 'superpowers' })
    for (const t of c.tasks) nodes.push({ id: t.id, title: t.title, level: 'task', parent: c.id, needs: [], links: [], tech: t.tech, by: '', src: '', status: t.status, source: 'superpowers' })
  }
  return { nodes, mtime: mtime || null, found: true }
}

// Writes under these paths change what readSuperpowers returns.
export const isSuperpowersPath = rel => rel === SP_DOCS || rel.startsWith(SP_DOCS + '/') || rel === SP_LEDGERS || rel.startsWith(SP_LEDGERS + '/')
