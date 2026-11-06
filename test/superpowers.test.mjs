// Superpowers specs, plans and ledgers drawn as cards. Fixtures are synthetic and small.
import assert from 'node:assert/strict'
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
    assert.deepEqual(p.tasks.map(t => [t.n, t.title, t.steps, t.ticked]), [[1, 'Read the tide table', 2, 2], [2, 'Send the alert', 2, 1], [3, 'Schedule the check', 1, 0]])
    assert.deepEqual(p.tasks[0].files, ['src/tides/read.js', 'test/tides/read.test.js'])
  })
  test('a ledger names its plan and the tasks it closed', () => {
    const l = parseLedger('# SDD ledger — plan: docs/superpowers/plans/x.md\nTask 1: complete (commits a..b)\nTask 3: complete\n')
    assert.equal(l.plan, 'docs/superpowers/plans/x.md')
    assert.deepEqual([...l.done].sort(), [1, 3])
  })
})

describe('Superpowers features as cards', () => {
  let dir
  afterEach(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); dir = null })
  test('a repo with no trail adds nothing', () => {
    dir = tempDir('sp-none')
    assert.deepEqual(readSuperpowers(dir), { nodes: [], mtime: null, found: false })
  })
  test('a plan pairs with the spec it names; a spec with no plan stands alone with no tasks', () => {
    dir = tempDir('sp-cards')
    writeTrail(dir)
    const { nodes, found } = readSuperpowers(dir)
    assert.ok(found)
    const cards = nodes.filter(n => n.level === 'component')
    assert.deepEqual(cards.map(c => [c.id, c.title, c.status]), [['sp-night-mode', 'Night Mode', 'pending'], ['sp-tide-alerts', 'Tide Alerts', 'active']])
    assert.equal(nodes.filter(n => n.parent === 'sp-night-mode').length, 0, 'no invented tasks')
    const tide = cards[1]
    assert.ok(tide.files.includes('docs/superpowers/specs/2026-01-02-tide-alerts-design.md'))
    assert.ok(tide.files.includes('src/alerts/send.js'))
    assert.deepEqual(nodes.filter(n => n.parent === 'sp-tide-alerts').map(t => t.status), ['done', 'active', 'pending'])
  })
  test('the ledger closes a task whose boxes were never ticked', () => {
    dir = tempDir('sp-ledger')
    writeTrail(dir, { ledger: '# SDD ledger — plan: docs/superpowers/plans/2026-01-03-tide-alerts.md\nTask 2: complete\nTask 3: complete\n' })
    const tide = readSuperpowers(dir).nodes.filter(n => n.parent === 'sp-tide-alerts')
    assert.deepEqual(tide.map(t => t.status), ['done', 'done', 'done'])
    assert.equal(readSuperpowers(dir).nodes.find(n => n.id === 'sp-tide-alerts').status, 'done')
  })
  test('only the newest finished features stay on the map', () => {
    dir = tempDir('sp-done')
    const plans = path.join(dir, 'docs', 'superpowers', 'plans')
    fs.mkdirSync(plans, { recursive: true })
    for (let d = 1; d <= 5; d++) fs.writeFileSync(path.join(plans, `2026-02-0${d}-f${d}.md`), `# F${d} Implementation Plan\n\n### Task 1: Do it\n\n- [x] **Step 1: done**\n`)
    fs.writeFileSync(path.join(plans, '2026-01-01-open.md'), '# Open Implementation Plan\n\n### Task 1: Do it\n\n- [ ] **Step 1: not yet**\n')
    const ids = readSuperpowers(dir).nodes.filter(n => n.level === 'component').map(n => n.id)
    assert.deepEqual(ids, ['sp-f5', 'sp-f4', 'sp-f3', 'sp-open'])
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
    assert.deepEqual(m.plan.filter(n => n.level === 'component').map(n => n.id), ['part', 'sp-night-mode', 'sp-tide-alerts'])
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
