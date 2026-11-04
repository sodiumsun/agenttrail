import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { panelFeed, panelRun, recentPath } from '../bin/lib/panel.mjs'
import { freePortBase, request, startMap, stopAll, tempWorld, until } from './helpers.mjs'

const titles = new Map([['watch', 'Watch repo'], ['hooks', 'Hooks'], ['panel', 'Panel']])
const run = (extra = {}) => ({ id: 's', agent: 'claude', provider: 'claude', source: 'hook', status: 'active', cwd: '/r', startedAt: 1, lastEventAt: 2, todos: [], todosUpdatedAt: null, currentTool: null, recentTools: [], ...extra })

describe('panel feed shape', () => {
  test('the path keeps each component once, at its latest visit, oldest first', () => {
    const trail = [{ c: 'watch', at: 1 }, { c: 'hooks', at: 2 }, { c: 'watch', at: 3 }, { c: 'panel', at: 4 }]
    assert.deepEqual(recentPath(trail, titles).map(s => s.title), ['Hooks', 'Watch repo', 'Panel'])
  })
  test('the path is bounded and leaves out components the plan no longer has', () => {
    const names = new Map(Array.from({ length: 9 }, (_, i) => [`c${i}`, `C${i}`]))
    const trail = Array.from({ length: 9 }, (_, i) => ({ c: `c${i}`, at: i }))
    assert.deepEqual(recentPath(trail, names).map(s => s.id), ['c4', 'c5', 'c6', 'c7', 'c8'])
    assert.deepEqual(recentPath([{ c: 'gone', at: 1 }], titles), [])
    assert.deepEqual(recentPath(undefined, titles), [])
  })
  test('a task shows only from a confirmed list: in progress first, then pending', () => {
    const todos = [{ content: 'a', status: 'completed' }, { content: 'b', status: 'pending' }, { content: 'c', status: 'in_progress' }]
    assert.deepEqual(panelRun(run({ todos, todosUpdatedAt: 5 }), titles).task, { text: 'c', state: 'in_progress' })
    assert.deepEqual(panelRun(run({ todos: todos.slice(0, 2), todosUpdatedAt: 5 }), titles).task, { text: 'b', state: 'pending' })
    assert.equal(panelRun(run({ todos }), titles).task, null)
  })
  test('unknown stays unknown, and an empty report is not unknown', () => {
    const silent = panelRun(run(), titles)
    assert.deepEqual(silent.evidence, { status: 'reported', task: 'unknown', tool: 'unknown', path: 'unknown', partial: false })
    assert.equal(silent.terminalId, null)
    assert.equal(silent.parentId, null)
    const reported = panelRun(run({ todos: [{ content: 'a', status: 'completed' }], todosUpdatedAt: 5 }), titles)
    assert.equal(reported.task, null)
    assert.equal(reported.evidence.task, 'reported')
  })
  test('a path is labelled inferred, a tool observed, a limited history partial', () => {
    const r = panelRun(run({ path: [{ c: 'hooks', at: 1 }], recentTools: [{ name: 'Read', detail: 'a.js' }], historyLimited: true }), titles)
    assert.equal(r.evidence.path, 'inferred')
    assert.equal(r.evidence.tool, 'observed')
    assert.equal(r.evidence.partial, true)
    assert.deepEqual(r.tool, { name: 'Read', detail: 'a.js', running: false })
    const current = { name: 'Edit', detail: 'b.js' }
    assert.equal(panelRun(run({ currentTool: current, recentTools: [{ name: 'Read' }] }), titles).tool.running, true)
  })
  test('only the agreed fields leave Map', () => {
    const r = panelRun(run({ todos: [{ content: 'x', status: 'pending' }], recentTools: [{ name: 'Read', detail: 'secret-history' }, { name: 'Read', detail: 'older' }], subagents: [{ name: 'h' }], hookAt: 3 }), titles)
    assert.deepEqual(Object.keys(r).sort(), ['agent', 'cwd', 'evidence', 'id', 'lastEventAt', 'parentId', 'path', 'provider', 'source', 'startedAt', 'status', 'task', 'terminalId', 'tool'])
    assert.ok(!JSON.stringify(r).includes('older'))
  })
  test('newest run first, and the feed names itself', () => {
    const f = panelFeed({ project: 'p', repoPath: '/r', port: 5330, hasPlan: true, components: [], sources: {}, now: 9, runs: [run({ id: 'old', lastEventAt: 1 }), run({ id: 'new', lastEventAt: 5 })] })
    assert.deepEqual(f.runs.map(r => r.id), ['new', 'old'])
    assert.equal(f.app, 'agenttrail')
    assert.equal(f.schema, 1)
    assert.equal(f.url, 'http://localhost:5330')
  })
})

describe('GET /panel', () => {
  const PLAN = '# demo\n\n## Watch the repo {#watch}\nfiles: [src/**]\n- [ ] One {#one}\n\n## Ship it {#ship}\nfiles: [ship/**]\n- [ ] Two {#two}\n\n## decisions\n'
  let world, map
  const panel = async () => JSON.parse((await map.get('/panel')).body)
  const hook = ev => map.post('/hook', { cwd: world.repo, session_id: 'p1', ...ev })
  const wrote = (file, id) => hook({ hook_event_name: 'PostToolUse', tool_name: 'Write', tool_use_id: id, tool_input: { file_path: path.join(world.repo, file) }, tool_response: {} })

  before(async () => {
    world = tempWorld(PLAN)
    map = await startMap({ repo: world.repo, home: world.home, base: await freePortBase() })
  })
  after(async () => { await stopAll(); world.cleanup() })

  test('an idle board says what it has and has not seen', async () => {
    const f = await panel()
    assert.equal(f.schema, 1)
    assert.equal(f.repoPath, world.repo)
    assert.equal(f.port, map.port)
    assert.equal(f.hasPlan, true)
    assert.deepEqual(f.sources, { hooks: false, claudeLogs: false, codexLogs: false })
    assert.deepEqual(f.runs, [])
  })
  test('a run carries its terminal id, source and path through to the feed', async () => {
    await hook({ hook_event_name: 'SessionStart', hc_terminal_id: 't7' })
    await wrote('src/a.js', 'c1')
    await wrote('ship/b.js', 'c2')
    await hook({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_use_id: 'c3', tool_input: { file_path: path.join(world.repo, 'src/c.js') } })
    const f = await until(async () => { const p = await panel(); return p.runs[0]?.path.length === 2 && p }, 'the path')
    const r = f.runs[0]
    assert.equal(r.terminalId, 't7')
    assert.equal(r.source, 'hook')
    assert.equal(r.status, 'active')
    assert.deepEqual(r.path.map(s => s.title), ['Watch the repo', 'Ship it'])
    assert.equal(r.evidence.path, 'inferred')
    assert.deepEqual(r.tool, { name: 'Edit', detail: 'src/c.js', running: true })
  })
  test('the feed is read-only', async () => {
    const before = fs.readFileSync(path.join(world.repo, 'PLAN.md'), 'utf8')
    assert.equal((await map.post('/panel', '{}')).status, 404)
    assert.equal(fs.readFileSync(path.join(world.repo, 'PLAN.md'), 'utf8'), before)
    assert.ok(!fs.existsSync(path.join(world.repo, '.claude')))
  })
})

describe('a repo with no plan', () => {
  test('the feed says so and nothing is set up', async () => {
    const world = tempWorld()
    try {
      const map = await startMap({ repo: world.repo, home: world.home, base: await freePortBase() })
      const f = JSON.parse((await request(map.port, '/panel')).body)
      assert.equal(f.hasPlan, false)
      assert.ok(!fs.existsSync(path.join(world.repo, 'PLAN.md')))
      assert.ok(!fs.existsSync(path.join(world.repo, '.claude')))
    } finally { await stopAll(); world.cleanup() }
  })
})
