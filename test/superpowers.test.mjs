// Superpowers specs, plans and ledgers drawn as cards. Fixtures are synthetic and small.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, test } from 'node:test'
import { parseLedger, parseSpPlan, readSuperpowers } from '../bin/lib/superpowers.mjs'
import { freePortBase, startMap, stopAll, tempDir, tempWorld, until } from './helpers.mjs'

const NO_RECURSIVE = new URL('./no-recursive-watch.mjs', import.meta.url).href

const PLAN = `# Tide Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Warn the harbor before a high tide.

**Spec:** \`docs/superpowers/specs/2026-01-02-tide-alerts-design.md\`

---

### Task 1: Read the tide table

**Files:**
- Create: \`src/tides/read.js\`
- Test: \`test/tides/read.test.js:10-40\`

- [x] **Step 1: Write the failing test**

\`\`\`js
// - [ ] not a step, it is inside a code sample
### Task 9: not a task either
\`\`\`

- [x] **Step 2: Implement it**

### Task 2: Send the alert

**Files:**
- Modify: \`src/alerts/send.js\`

- [x] **Step 1: Write the failing test**
- [ ] **Step 2: Implement it**

### Task 3: Schedule the check

- [ ] **Step 1: Write the failing test**

## Self-review

- [ ] a checklist after the tasks is not a task
`
const SPEC = '# Tide Alerts Design\n\nProse about the harbor.\n'
const LONE_SPEC = '# Design: Night Mode\n\nNot planned yet.\n'

function writeTrail(repo, { plan = PLAN, ledger } = {}) {
  const sp = path.join(repo, 'docs', 'superpowers')
  fs.mkdirSync(path.join(sp, 'plans'), { recursive: true })
  fs.mkdirSync(path.join(sp, 'specs'), { recursive: true })
  fs.writeFileSync(path.join(sp, 'plans', '2026-01-03-tide-alerts.md'), plan)
  fs.writeFileSync(path.join(sp, 'specs', '2026-01-02-tide-alerts-design.md'), SPEC)
  fs.writeFileSync(path.join(sp, 'specs', '2026-01-04-night-mode-design.md'), LONE_SPEC)
  if (ledger) {
    const dir = path.join(repo, '.superpowers', 'sdd', '2026-01-03-tide-alerts')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'plan-path'), 'docs/superpowers/plans/2026-01-03-tide-alerts.md\n')
    fs.writeFileSync(path.join(dir, 'progress.md'), ledger)
  }
}

describe('reading a Superpowers plan', () => {
  test('tasks, steps and files come from prose, not from code samples or later sections', () => {
    const p = parseSpPlan(PLAN)
    assert.equal(p.title, 'Tide Alerts')
    assert.equal(p.goal, 'Warn the harbor before a high tide.')
    assert.equal(p.spec, 'docs/superpowers/specs/2026-01-02-tide-alerts-design.md')
    assert.deepEqual(p.tasks.map(t => [t.n, t.title, t.steps, t.ticked]), [['1', 'Read the tide table', 2, 2], ['2', 'Send the alert', 2, 1], ['3', 'Schedule the check', 1, 0]])
    assert.deepEqual(p.tasks[0].files, ['src/tides/read.js', 'test/tides/read.test.js'])
  })
  test('a ledger names its plan, near the top, and the tasks it closed', () => {
    const l = parseLedger('# Plan 3: ledger\n\nKept when the workspace was removed.\n\n```\n# SDD ledger — plan: docs/superpowers/plans/x.md\nTask 1: complete (commits a..b)\nTask 4b: complete\n```\n')
    assert.equal(l.plan, 'docs/superpowers/plans/x.md')
    assert.deepEqual([...l.done].sort(), ['1', '4b'])
    assert.equal(parseLedger('# Some plan\n\n### Task 1: complete the parser\n'), null)
  })
  test('a title loses a dangling dash', () => {
    assert.equal(parseSpPlan('# SP-12b — Initial setup wizard —\n').title, 'SP-12b — Initial setup wizard')
  })
})

const DAY = 86400e3
const age = (file, days) => { const t = new Date(Date.now() - days * DAY); fs.utimesSync(file, t, t) }
const cardIds = nodes => nodes.filter(n => n.level === 'component').map(n => n.id).sort()

describe('Superpowers features as cards', () => {
  let dir
  afterEach(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); dir = null })
  test('a repo with no trail adds nothing', () => {
    dir = tempDir('sp-none')
    assert.deepEqual(readSuperpowers(dir), { nodes: [], files: [], found: false })
  })
  test('a plan pairs with the spec it names; a spec with no plan stands alone with no tasks', () => {
    dir = tempDir('sp-cards')
    writeTrail(dir)
    const { nodes, found } = readSuperpowers(dir)
    assert.ok(found)
    assert.deepEqual(cardIds(nodes), ['sp-night-mode', 'sp-tide-alerts'])
    const tide = nodes.find(n => n.id === 'sp-tide-alerts')
    assert.deepEqual([tide.title, tide.status, tide.progress], ['Tide Alerts', 'active', ''])
    assert.equal(nodes.find(n => n.id === 'sp-night-mode').title, 'Night Mode')
    assert.equal(nodes.filter(n => n.parent === 'sp-night-mode').length, 0, 'no invented tasks')
    assert.ok(tide.files.includes('docs/superpowers/specs/2026-01-02-tide-alerts-design.md'))
    assert.ok(tide.files.includes('src/alerts/send.js'))
    assert.deepEqual(nodes.filter(n => n.parent === 'sp-tide-alerts').map(t => t.status), ['done', 'active', 'pending'])
  })
  test('the ledger closes a task whose boxes were never ticked', () => {
    dir = tempDir('sp-ledger')
    writeTrail(dir, { ledger: '# SDD ledger — plan: docs/superpowers/plans/2026-01-03-tide-alerts.md\nTask 2: complete\nTask 3: complete\n' })
    const { nodes } = readSuperpowers(dir)
    assert.deepEqual(nodes.filter(n => n.parent === 'sp-tide-alerts').map(t => t.status), ['done', 'done', 'done'])
    assert.equal(nodes.find(n => n.id === 'sp-tide-alerts').status, 'done')
  })
  test('a plan with no ticked box and no ledger says its progress is not recorded', () => {
    dir = tempDir('sp-unrecorded')
    writeTrail(dir, { plan: PLAN.replace(/- \[x\]/g, '- [ ]') })
    const tide = readSuperpowers(dir).nodes.find(n => n.id === 'sp-tide-alerts')
    assert.deepEqual([tide.status, tide.progress], ['pending', 'unrecorded'])
  })
  test('a ledger committed beside the plans is read as a ledger, not as another plan', () => {
    dir = tempDir('sp-committed-ledger')
    writeTrail(dir, { plan: PLAN.replace(/- \[x\]/g, '- [ ]') })
    fs.writeFileSync(path.join(dir, 'docs', 'superpowers', 'plans', '2026-01-03-tide-alerts-ledger.md'), '# Tide alerts: ledger\n\n```\n# SDD ledger — plan: docs/superpowers/plans/2026-01-03-tide-alerts.md\nTask 1: complete\n```\n')
    const { nodes } = readSuperpowers(dir)
    assert.deepEqual(cardIds(nodes), ['sp-night-mode', 'sp-tide-alerts'])
    const tide = nodes.find(n => n.id === 'sp-tide-alerts')
    assert.equal(tide.progress, '')
    assert.deepEqual(nodes.filter(n => n.parent === 'sp-tide-alerts').map(t => t.status), ['done', 'pending', 'pending'])
  })
  test('notes kept beside the plans, with no tasks, are not plans', () => {
    dir = tempDir('sp-notes')
    writeTrail(dir)
    fs.writeFileSync(path.join(dir, 'docs', 'superpowers', 'plans', '2026-01-05-world-findings.md'), '# World findings\n\n- [ ] a loose checklist\n')
    assert.deepEqual(cardIds(readSuperpowers(dir).nodes), ['sp-night-mode', 'sp-tide-alerts'])
  })
  test('a plan kept outside docs/superpowers is found through its ledger, and other docs are not', () => {
    dir = tempDir('sp-elsewhere')
    fs.mkdirSync(path.join(dir, 'docs', 'specs'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'docs', 'specs', '2026-01-01-blp.md'), '# BLP file format\n')
    fs.writeFileSync(path.join(dir, 'docs', '2026-01-03-viewer-plan.md'), '# Viewer Implementation Plan\n\n### Task 1: Draw\n\n- [ ] **Step 1: test**\n\n### Task 2: Pan\n\n- [ ] **Step 1: test**\n')
    const led = path.join(dir, '.superpowers', 'sdd', '2026-01-03-viewer-plan')
    fs.mkdirSync(led, { recursive: true })
    fs.writeFileSync(path.join(led, 'plan-path'), 'docs/2026-01-03-viewer-plan.md\n')
    fs.writeFileSync(path.join(led, 'progress.md'), '# SDD ledger — plan: docs/2026-01-03-viewer-plan.md\nTask 1: complete\n')
    const outside = path.join(dir, '.superpowers', 'sdd', 'escape')
    fs.mkdirSync(outside, { recursive: true })
    fs.writeFileSync(path.join(outside, 'plan-path'), '../outside.md\n')
    const { nodes, files } = readSuperpowers(dir)
    assert.deepEqual(cardIds(nodes), ['sp-viewer'])
    assert.deepEqual(nodes.filter(n => n.parent === 'sp-viewer').map(t => t.status), ['done', 'pending'])
    assert.ok(files.includes('docs/2026-01-03-viewer-plan.md'))
  })
  test('a feature whose files have been quiet for two weeks leaves the map', () => {
    dir = tempDir('sp-quiet')
    writeTrail(dir)
    const sp = path.join(dir, 'docs', 'superpowers')
    age(path.join(sp, 'plans', '2026-01-03-tide-alerts.md'), 20)
    age(path.join(sp, 'specs', '2026-01-02-tide-alerts-design.md'), 20)
    assert.deepEqual(cardIds(readSuperpowers(dir).nodes), ['sp-night-mode'])
    age(path.join(sp, 'specs', '2026-01-04-night-mode-design.md'), 15)
    const quiet = readSuperpowers(dir)
    assert.deepEqual([quiet.nodes.length, quiet.found], [0, true])
  })
  test('in git, a committed plan counts from its last commit, not its time on disk', { skip: spawnSync('git', ['--version']).status !== 0 }, () => {
    dir = tempDir('sp-git')
    writeTrail(dir)
    const old = new Date(Date.now() - 30 * DAY).toISOString()
    const git = (...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, env: { ...process.env, GIT_AUTHOR_DATE: old, GIT_COMMITTER_DATE: old } })
    git('init', '-q'); git('add', '.'); git('commit', '-qm', 'old')
    assert.deepEqual(cardIds(readSuperpowers(dir).nodes), [], 'a fresh checkout is not recent work')
    fs.appendFileSync(path.join(dir, 'docs', 'superpowers', 'plans', '2026-01-03-tide-alerts.md'), '\n')
    assert.deepEqual(cardIds(readSuperpowers(dir).nodes), ['sp-tide-alerts'], 'an edit not yet committed is')
  })
  test('no more than twelve features, newest first', () => {
    dir = tempDir('sp-many')
    const plans = path.join(dir, 'docs', 'superpowers', 'plans')
    fs.mkdirSync(plans, { recursive: true })
    for (let d = 1; d <= 15; d++) {
      const f = path.join(plans, `2026-02-${String(d).padStart(2, '0')}-f${d}.md`)
      fs.writeFileSync(f, `# F${d} Implementation Plan\n\n### Task 1: Do it\n\n- [ ] **Step 1: not yet**\n`)
      age(f, (15 - d) / 10)
    }
    const ids = readSuperpowers(dir).nodes.filter(n => n.level === 'component').map(n => n.id)
    assert.deepEqual(ids, Array.from({ length: 12 }, (_, i) => `sp-f${15 - i}`))
  })
})

describe('the Map daemon', () => {
  let world
  afterEach(async () => { await stopAll(); world?.cleanup(); world = null })
  const boot = async plan => { world = tempWorld(plan); return world }
  const start = async () => startMap({ repo: world.repo, home: world.home, base: await freePortBase() })

  test('Superpowers plans alone draw the map instead of git inference', async () => {
    await boot('')
    writeTrail(world.repo)
    const map = await start()
    const m = await map.model()
    assert.equal(m.hasPlan, true)
    assert.equal(m.derived, undefined)
    assert.ok(m.plan.some(n => n.id === 'sp-tide-alerts'))
  })
  test('they sit beside PLAN.md cards, stay out of its lints, and follow edits live', async () => {
    await boot('# p\n\n## Part {#part}\nfiles: [src/**]\n- [ ] t {#t}\n')
    writeTrail(world.repo)
    const map = await start()
    let m = await map.model()
    assert.deepEqual(m.plan.filter(n => n.level === 'component').map(n => n.id).sort(), ['part', 'sp-night-mode', 'sp-tide-alerts'])
    assert.ok(!m.lints.some(l => l.includes('sp-')), m.lints.join('\n'))
    writeTrail(world.repo, { plan: PLAN.replace('- [ ] **Step 2: Implement it**', '- [x] **Step 2: Implement it**') })
    await until(async () => (await map.model()).plan.find(n => n.id === 'sp-tide-alerts-t2').status === 'done', 'the ticked step')
  })
  test('where the repo cannot be watched recursively, Superpowers edits still arrive', async () => {
    await boot('# p\n\n## Part {#part}\nfiles: [src/**]\n- [ ] t {#t}\n')
    writeTrail(world.repo)
    const map = await startMap({ repo: world.repo, home: world.home, base: await freePortBase(), env: { NODE_OPTIONS: `--import=${NO_RECURSIVE}`, AGENTTRAIL_SP_POLL_MS: '100' } })
    const status = async id => (await map.model()).plan.find(n => n.id === id).status
    assert.equal(await status('sp-tide-alerts-t2'), 'active')
    writeTrail(world.repo, { plan: PLAN.replace('- [ ] **Step 2: Implement it**', '- [x] **Step 2: Implement it**') })
    await until(async () => (await status('sp-tide-alerts-t2')) === 'done', 'the ticked step, through the fallback watcher')
    writeTrail(world.repo, { plan: PLAN.replace('- [ ] **Step 2: Implement it**', '- [x] **Step 2: Implement it**'), ledger: '# SDD ledger — plan: docs/superpowers/plans/2026-01-03-tide-alerts.md\nTask 3: complete\n' })
    await until(async () => (await status('sp-tide-alerts-t3')) === 'done', 'the ledger line, through the fallback watcher')
  })
})
