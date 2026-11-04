import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import { ClaudeLogReader, claudeEffects } from '../bin/lib/claude.mjs'
import { READ_LIMIT } from '../bin/lib/logtail.mjs'
import { freePortBase, startMap, stopAll, tempDir, tempWorld, until } from './helpers.mjs'

// Synthetic rows in the shapes Claude Code writes. Nothing here comes from a real session.
const SESSION = 'claude-1'
const T0 = Date.now() - 60_000
const at = n => new Date(T0 + n * 1000).toISOString()
let uuid = 0
const base = (n, type, cwd = '/repo', sessionId = SESSION) => ({ type, uuid: `u${++uuid}`, parentUuid: null, isSidechain: false, sessionId, cwd, timestamp: at(n) })
const prompt = (n, text = 'PRIVATE PROMPT', extra = {}, cwd) => ({ ...base(n, 'user', cwd), message: { role: 'user', content: text }, ...extra })
const assistant = (n, content, stop_reason = 'tool_use', cwd) => ({ ...base(n, 'assistant', cwd), message: { role: 'assistant', stop_reason, content } })
const say = (n, cwd) => assistant(n, [{ type: 'text', text: 'PRIVATE REPLY' }], 'end_turn', cwd)
const use = (n, id, name, input, cwd) => assistant(n, [{ type: 'tool_use', id, name, input }], 'tool_use', cwd)
const result = (n, id, content = 'ok', extra = {}, cwd) => {
  const { is_error, ...rest } = extra
  return { ...base(n, 'user', cwd), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, ...(is_error ? { is_error } : {}) }] }, ...rest }
}
const duration = n => ({ ...base(n, 'system'), subtype: 'turn_duration', durationMs: 1000 })
const notify = (n, id, status = 'completed') => prompt(n, `<task-notification>\n<task-id>a1</task-id>\n<tool-use-id>${id}</tool-use-id>\n<status>${status}</status>\n<summary>PRIVATE</summary>\n</task-notification>`)
const noise = n => ({ type: 'last-prompt', sessionId: SESSION, lastPrompt: 'PRIVATE' })

const replay = (...rows) => {
  const cursor = {}, m = { id: SESSION, cwd: '/repo' }
  const effects = rows.flatMap(r => claudeEffects(r, m, cursor))
  return Object.assign(effects, { cursor })
}
const kinds = effects => effects.map(e => e.kind)
const tasks = effects => effects.filter(e => e.kind === 'tasks').map(e => e.effect)

describe('turns', () => {
  test('a prompt starts a turn and end_turn or turn_duration ends it', () => {
    assert.deepEqual(kinds(replay(prompt(1), say(2), duration(3))), ['turn-start', 'turn-end', 'turn-end'])
    assert.deepEqual(kinds(replay({ ...base(1, 'user'), message: { role: 'user', content: [{ type: 'text', text: 'hello' }] } })), ['turn-start'])
  })
  test('an interruption says so, in either wording', () => {
    for (const text of ['[Request interrupted by user]', '[Request interrupted by user for tool use]']) {
      assert.deepEqual(kinds(replay({ ...base(1, 'user'), message: { role: 'user', content: [{ type: 'text', text }] } })), ['interrupted'])
    }
  })
  test('rows that are not a turn change nothing', () => {
    for (const r of [
      prompt(1, 'x', { isMeta: true }), prompt(1, 'x', { isCompactSummary: true }), prompt(1, '<local-command-stdout>x</local-command-stdout>'),
      prompt(1, '<command-name>/clear</command-name>'), prompt(1, 'x', { isSidechain: true }), prompt(1, 'x', { sessionId: 'someone-else' }),
      prompt(1, 'x', { timestamp: 'never' }), { ...base(1, 'system'), subtype: 'stop_hook_summary' }, noise(1),
    ]) assert.deepEqual(replay(r).slice(), [], JSON.stringify(r))
  })
})

describe('tool calls', () => {
  test('report name, shortened detail and duration', () => {
    const effects = replay(use(1, 'a', 'Bash', { command: `npm   test ${'x'.repeat(200)}` }), result(4, 'a'))
    assert.deepEqual(kinds(effects), ['tool-start', 'tool-end'])
    assert.equal(effects[1].name, 'Bash')
    assert.equal(effects[1].ms, 3000)
    assert.equal(effects[1].error, false)
    assert.equal(effects[1].detail.length, 90)
    assert.ok(effects[1].detail.startsWith('npm test '))
  })
  test('a write claims its file only after it succeeded', () => {
    const edit = id => use(1, id, 'Edit', { file_path: 'src/a.js', old_string: 'PRIVATE', new_string: 'PRIVATE' })
    assert.deepEqual(replay(edit('a'), result(2, 'a')).at(-1).files, ['/repo/src/a.js'])
    assert.deepEqual(replay(edit('a')).at(-1).kind, 'tool-start')
    const failed = replay(edit('a'), result(2, 'a', 'String not found', { is_error: true })).at(-1)
    assert.deepEqual(failed.files, [])
    assert.equal(failed.error, true)
    assert.deepEqual(replay(use(1, 'a', 'Read', { file_path: 'src/a.js' }), result(2, 'a')).at(-1).files, [])
  })
  test('a result with no call in view is unknown, and a repeated row counts once', () => {
    assert.deepEqual(replay(result(2, 'gone')).slice(), [])
    const row = use(1, 'a', 'Bash', { command: 'ls' })
    assert.equal(replay(row, row, result(2, 'a'), result(3, 'a')).length, 2)
  })
  test('the saved cursor keeps no prompts or bodies', () => {
    const { cursor } = replay(
      use(1, 'a', 'Agent', { description: 'Check it', prompt: 'PRIVATE' }),
      use(1, 'b', 'TaskCreate', { subject: 'Ship', activeForm: 'PRIVATE' }),
      use(1, 'c', 'Write', { file_path: '/repo/a', content: 'PRIVATE' }),
    )
    assert.ok(Object.keys(cursor.pending).length === 3)
    assert.ok(!JSON.stringify(cursor).includes('PRIVATE'))
  })
})

describe('task lists commit on success only', () => {
  const create = (n, id) => use(n, id, 'TaskCreate', { subject: 'Ship it', description: 'PRIVATE' })
  test('the structured result wins, and plain text also counts', () => {
    assert.deepEqual(tasks(replay(create(1, 'a'), result(2, 'a', 'ignored', { toolUseResult: { task: { id: '7', subject: 'Ship it' } } }))), [{ change: { id: '7', content: 'Ship it', status: 'pending' } }])
    assert.deepEqual(tasks(replay(create(1, 'a'), result(2, 'a', 'Task #7 created successfully: Ship it'))), [{ change: { id: '7', content: 'Ship it', status: 'pending' } }])
  })
  test('updates and legacy lists', () => {
    const update = use(1, 'a', 'TaskUpdate', { taskId: '7', status: 'completed' })
    assert.deepEqual(tasks(replay(update, result(2, 'a', 'Updated task #7 status', { toolUseResult: { success: true, taskId: '7', updatedFields: ['status'], statusChange: { from: 'pending', to: 'completed' } } }))), [{ change: { id: '7', status: 'completed' } }])
    const todos = [{ content: 'One', status: 'in_progress', activeForm: 'PRIVATE' }]
    assert.deepEqual(tasks(replay(use(1, 'b', 'TodoWrite', { todos }), result(2, 'b', 'Todos have been modified successfully'))), [{ replace: [{ content: 'One', status: 'in_progress' }], partial: false }])
  })
  test('failure, unknown results and an ended turn change nothing', () => {
    assert.deepEqual(tasks(replay(create(1, 'a'), result(2, 'a', 'Task #7 created successfully: Ship it', { is_error: true }))), [])
    assert.deepEqual(tasks(replay(create(1, 'a'), result(2, 'a', 'something new'))), [])
    assert.deepEqual(tasks(replay(create(1, 'a'), say(2), result(3, 'a', 'Task #7 created successfully: Ship it'))), [])
    assert.deepEqual(tasks(replay(create(1, 'a'), { ...base(2, 'user'), message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } }, result(3, 'a', 'Task #7 created successfully: Ship it'))), [])
  })
})

describe('sub-agents', () => {
  const spawn = (input = {}) => use(1, 'a', 'Agent', { description: 'Check the docs', prompt: 'PRIVATE', ...input })
  const subs = effects => effects.filter(e => e.kind.startsWith('subagent')).map(e => e.kind)
  test('Agent and the older Task both start one, named by description', () => {
    for (const tool of ['Agent', 'Task']) {
      const start = replay(use(1, 'a', tool, { description: 'Check the docs', prompt: 'PRIVATE' })).find(e => e.kind === 'subagent-start')
      assert.equal(start.name, 'Check the docs')
    }
    assert.equal(replay(use(1, 'a', 'Agent', { name: 'worker', prompt: 'PRIVATE' })).find(e => e.kind === 'subagent-start').name, 'worker')
    assert.deepEqual(subs(replay(use(1, 'a', 'TaskCreate', { subject: 'x' }))), [])
  })
  test('a finished or failed call ends it', () => {
    assert.deepEqual(subs(replay(spawn(), result(2, 'a', [{ type: 'text', text: 'done' }], { toolUseResult: { status: 'completed' } }))), ['subagent-start', 'subagent-end'])
    assert.deepEqual(subs(replay(spawn(), result(2, 'a', 'failed', { is_error: true }))), ['subagent-start', 'subagent-end'])
  })
  test('a launch is not an end, however it was reported', () => {
    for (const status of ['async_launched', 'teammate_spawned']) {
      assert.deepEqual(subs(replay(spawn(), result(2, 'a', [{ type: 'text', text: 'x' }], { toolUseResult: { status } }))), ['subagent-start', 'subagent-detached'], status)
    }
    assert.deepEqual(subs(replay(spawn(), result(2, 'a', [{ type: 'text', text: 'Async agent launched successfully.' }]))), ['subagent-start', 'subagent-detached'])
    assert.deepEqual(subs(replay(spawn(), result(2, 'a', [{ type: 'text', text: 'Spawned successfully.' }]))), ['subagent-start', 'subagent-detached'])
  })
  test('a notification ends it only when it finished', () => {
    const end = replay(notify(5, 'a'))
    assert.deepEqual(kinds(end), ['turn-start', 'subagent-end'])
    assert.equal(end[1].callId, 'a')
    assert.deepEqual(kinds(replay(notify(5, 'a', 'failed'))), ['turn-start', 'subagent-end'])
    assert.deepEqual(kinds(replay(notify(5, 'a', 'running'))), ['turn-start'])
  })
})

describe('reading transcripts', () => {
  let home
  const write = (project, name, rows) => {
    const dir = path.join(home, 'projects', project)
    fs.mkdirSync(dir, { recursive: true })
    const target = path.join(dir, `${name}.jsonl`)
    fs.writeFileSync(target, rows.map(r => JSON.stringify(r) + '\n').join(''))
    return target
  }
  const reader = (wants = c => c.startsWith('/repo')) => {
    const seen = []
    const r = new ClaudeLogReader({ claudeHome: home, wants, apply: (m, effects) => seen.push(...effects.map(e => ({ ...e, session: m.id, limited: m.limited }))) })
    return { r, seen }
  }
  beforeEach(() => { home = tempDir('claude') })
  afterEach(() => fs.rmSync(home, { recursive: true, force: true }))

  test('missing logs are quiet', async () => {
    const { r, seen } = reader()
    fs.rmSync(home, { recursive: true })
    assert.equal(await r.poll(), false)
    assert.deepEqual(seen, [])
    fs.mkdirSync(home)
  })
  test('only sessions in the repo are read, and the first rows may be anything', async () => {
    write('-repo', SESSION, [noise(0), noise(0), prompt(1)])
    write('-elsewhere', 'other', [{ ...prompt(1, 'x', { sessionId: 'other' }), cwd: '/elsewhere' }])
    const { r, seen } = reader()
    await r.poll()
    assert.deepEqual(seen.map(e => [e.kind, e.session]), [['turn-start', SESSION]])
  })
  test('a session that moved in is found, and only rows in the repo count', async () => {
    write('-elsewhere', SESSION, [
      prompt(1, 'x', {}, '/elsewhere'),
      use(2, 'a', 'Bash', { command: 'outside' }, '/elsewhere'),
      use(3, 'b', 'Bash', { command: 'inside' }, '/repo/sub'),
    ])
    const { r, seen } = reader()
    await r.poll()
    assert.deepEqual(seen.map(e => e.detail), ['inside'])
  })
  test('sub-agent transcripts stay out of the run list', async () => {
    const dir = path.join(home, 'projects', '-repo', SESSION, 'subagents')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'agent-1.jsonl'), JSON.stringify(prompt(1)) + '\n')
    const { r, seen } = reader()
    await r.poll()
    assert.deepEqual(seen, [])
  })
  test('a row still being written waits for its newline, and is read once', async () => {
    const file = write('-repo', SESSION, [prompt(1)])
    const line = JSON.stringify(say(2))
    fs.appendFileSync(file, line.slice(0, 40))
    const { r, seen } = reader()
    await r.poll()
    assert.deepEqual(kinds(seen), ['turn-start'])
    fs.appendFileSync(file, line.slice(40) + '\n')
    await r.readNew(file)
    await r.readNew(file)
    assert.deepEqual(kinds(seen), ['turn-start', 'turn-end'])
  })
  test('a huge log is read from its tail and marked partial', async () => {
    const pad = { ...noise(0), pad: 'x'.repeat(1024) }
    const file = write('-repo', SESSION, [prompt(1), ...Array.from({ length: Math.ceil(READ_LIMIT / 1024) + 200 }, () => pad), say(2)])
    const { r, seen } = reader()
    await r.poll()
    assert.deepEqual(seen.map(e => [e.kind, e.limited]), [['turn-end', true]])
    assert.ok(r.cursors[file].offset === fs.statSync(file).size)
  })
  test('old logs are left alone', async () => {
    const file = write('-repo', SESSION, [prompt(1)])
    const old = new Date(Date.now() - 3 * 3600e3)
    fs.utimesSync(file, old, old)
    const { r, seen } = reader()
    await r.poll()
    assert.deepEqual(seen, [])
  })
})

describe('Claude runs on the map', () => {
  const PLAN = '# demo\n\n## Build the api {#api}\nfiles: [src/api/**]\n- [ ] One {#one}\n\n## decisions\n'
  let world, port, map, projects
  const hook = ev => map.post('/hook', ev)
  const run = async id => (await map.model()).runs.find(r => r.id === id)
  const runsFor = async id => (await map.model()).runs.filter(r => r.id === id)
  const log = (id, rows) => {
    const target = path.join(projects, `${id}.jsonl`)
    fs.writeFileSync(target, rows.map(r => JSON.stringify({ ...r, sessionId: id, cwd: world.repo }) + '\n').join(''))
    return target
  }
  const append = (file, id, rows) => fs.appendFileSync(file, rows.map(r => JSON.stringify({ ...r, sessionId: id, cwd: world.repo }) + '\n').join(''))
  const now = () => Date.now() + 2000 // a row written after the hook just heard
  const fresh = (r, when = now()) => ({ ...r, timestamp: new Date(when).toISOString() })

  before(async () => {
    world = tempWorld(PLAN)
    port = await freePortBase()
    projects = path.join(world.home, '.claude', 'projects', '-repo')
    fs.mkdirSync(projects, { recursive: true })
    fs.mkdirSync(path.join(world.repo, 'src', 'api'), { recursive: true })
    log('no-hooks', [
      prompt(1),
      use(2, 't1', 'TaskCreate', { subject: 'Build it' }),
      result(3, 't1', 'Task #1 created successfully: Build it'),
      use(4, 't2', 'TaskUpdate', { taskId: '1', status: 'in_progress' }),
      result(5, 't2', 'Updated task #1 status'),
      use(6, 'e1', 'Edit', { file_path: path.join(world.repo, 'src', 'api', 'a.js') }),
      result(7, 'e1'),
      use(8, 'g1', 'Agent', { description: 'Check the docs' }),
      result(9, 'g1', 'x', { toolUseResult: { status: 'completed' } }),
      use(10, 'g2', 'Agent', { description: 'Watch the build', name: 'worker' }),
      result(11, 'g2', 'x', { toolUseResult: { status: 'teammate_spawned' } }),
      say(12),
    ])
    // Discovery runs every ten seconds, so these exist from the start, holding one row with no effect.
    for (const id of ['hook-first', 'log-first', 'interrupted']) log(id, [base(0, 'attachment')])
    map = await startMap({ repo: world.repo, home: world.home, base: port })
    await until(() => run('no-hooks'), 'the Claude run')
  })
  after(async () => { await stopAll(); world.cleanup() })

  test('a session with no hooks becomes a run with honest labels', async () => {
    const r = await run('no-hooks')
    assert.equal(r.provider, 'claude')
    assert.equal(r.agent, 'claude')
    assert.equal(r.source, 'claude-log')
    assert.equal(r.status, 'idle')
    assert.equal('terminalId' in r, false)
    assert.deepEqual(r.todos, [{ id: '1', content: 'Build it', status: 'in_progress' }])
    assert.deepEqual(r.evidence, { lifecycle: 'reported', todos: 'reported', tools: 'observed', component: 'inferred' })
    assert.equal(r.componentId, 'api')
    assert.equal(r.startedAt, Date.parse(at(1)))
    assert.equal(r.lastEventAt, Date.parse(at(12)))
  })
  test('tools, sub-agents and the trail are recorded', async () => {
    const r = await run('no-hooks')
    assert.deepEqual(r.recentTools.map(t => t.name).slice(0, 3), ['Agent', 'Agent', 'Edit'])
    assert.deepEqual(r.path.map(p => p.c), ['api'])
    assert.deepEqual(r.subagents.map(s => [s.name, s.ended, !!s.detached]), [['Check the docs', true, false], ['Watch the build', false, true]])
    assert.ok(!JSON.stringify(await map.model()).includes('PRIVATE'))
  })
  test('a later notification closes a detached sub-agent', async () => {
    const file = path.join(projects, 'no-hooks.jsonl')
    append(file, 'no-hooks', [fresh(notify(13, 'g2'), Date.now())])
    await until(async () => (await run('no-hooks')).subagents[1].ended, 'the closed sub-agent')
    assert.equal('detached' in (await run('no-hooks')).subagents[1], false)
  })
  test('hook first, then log: one run, terminal id kept, no call counted twice', async () => {
    const id = 'hook-first'
    await hook({ hook_event_name: 'PreToolUse', session_id: id, cwd: world.repo, hc_terminal_id: 'term-1', tool_name: 'Bash', tool_use_id: 'b1', tool_input: { command: 'npm test' } })
    await hook({ hook_event_name: 'PostToolUse', session_id: id, cwd: world.repo, tool_name: 'Bash', tool_use_id: 'b1', tool_input: { command: 'npm test' }, tool_response: {} })
    // Every row here was already heard by hook, except the last.
    append(path.join(projects, `${id}.jsonl`), id, [
      fresh(prompt(0), Date.now() - 5000), fresh(use(0, 'b1', 'Bash', { command: 'npm test' }), Date.now() - 4000), fresh(result(0, 'b1'), Date.now() - 3000),
      fresh(use(0, 'b2', 'Read', { file_path: '/x' })), fresh(result(0, 'b2'), now() + 1),
    ])
    await until(async () => (await run(id))?.recentTools.length === 2, 'the newer log call')
    const [r, ...others] = await runsFor(id)
    assert.deepEqual(others, [])
    assert.equal(r.terminalId, 'term-1')
    assert.equal(r.source, 'hook+claude-log')
    assert.deepEqual(r.recentTools.map(t => t.name), ['Read', 'Bash'])
  })
  test('log first, then hook: the same call is not counted twice, with or without a hook id', async () => {
    const id = 'log-first'
    append(path.join(projects, `${id}.jsonl`), id, [fresh(prompt(0), Date.now()), fresh(use(0, 'c1', 'Bash', { command: 'ls' }), Date.now()), fresh(result(0, 'c1'), Date.now()), fresh(use(0, 'c2', 'Bash', { command: 'pwd' }), Date.now()), fresh(result(0, 'c2'), Date.now())])
    await until(async () => (await run(id))?.recentTools.length === 2, 'the log calls')
    await hook({ hook_event_name: 'PostToolUse', session_id: id, cwd: world.repo, hc_terminal_id: 'term-2', tool_name: 'Bash', tool_use_id: 'c1', tool_input: { command: 'ls' }, tool_response: {} })
    await hook({ hook_event_name: 'PostToolUse', session_id: id, cwd: world.repo, tool_name: 'Bash', tool_input: { command: 'pwd' }, tool_response: {} })
    const [r, ...others] = await runsFor(id)
    assert.deepEqual(others, [])
    assert.equal(r.terminalId, 'term-2')
    assert.equal(r.source, 'hook+claude-log')
    assert.equal(r.recentTools.length, 2)
  })
  test('a hook after an interruption clears it', async () => {
    const id = 'interrupted'
    append(path.join(projects, `${id}.jsonl`), id, [fresh(prompt(0), Date.now()), fresh({ ...base(0, 'user'), message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } }, Date.now())])
    await until(async () => (await run(id))?.status === 'interrupted', 'the interrupted run')
    await hook({ hook_event_name: 'PreToolUse', session_id: id, cwd: world.repo, tool_name: 'Bash', tool_input: { command: 'ls' } })
    await hook({ hook_event_name: 'Stop', session_id: id, cwd: world.repo })
    assert.equal((await run(id)).status, 'idle')
  })
  test('a restart neither repeats events nor loses them', async () => {
    const file = path.join(projects, 'no-hooks.jsonl')
    const before = (await run('no-hooks')).recentTools.length
    await map.stop()
    append(file, 'no-hooks', [fresh(use(20, 'r1', 'Bash', { command: 'while it was down' }), Date.now()), fresh(result(21, 'r1'), Date.now())])
    map = await startMap({ repo: world.repo, home: world.home, base: port })
    await until(async () => (await run('no-hooks'))?.recentTools.some(t => t.detail === 'while it was down'), 'the missed call')
    const r = await run('no-hooks')
    assert.equal(r.recentTools.length, Math.min(8, before + 1))
    assert.equal(r.recentTools.filter(t => t.detail === 'while it was down').length, 1)
  })
  test('the Claude home is only ever read', async () => {
    const snapshot = () => fs.readdirSync(projects, { recursive: true }).sort().map(f => {
      const s = fs.statSync(path.join(projects, f))
      return `${f}:${s.size}:${s.mtimeMs}`
    })
    const first = snapshot()
    await new Promise(resolve => setTimeout(resolve, 2500))
    assert.deepEqual(snapshot(), first)
    assert.deepEqual(fs.readdirSync(path.join(world.home, '.claude')), ['projects'])
  })
})

test('CLAUDE_CONFIG_DIR moves the logs, and a machine with none is fine', async t => {
  const world = tempWorld()
  t.after(async () => { await stopAll(); world.cleanup() })
  const custom = path.join(world.root, 'custom', 'projects', '-repo')
  fs.mkdirSync(custom, { recursive: true })
  fs.writeFileSync(path.join(custom, 'moved.jsonl'), JSON.stringify({ ...prompt(1), sessionId: 'moved', cwd: world.repo }) + '\n')
  const base2 = await freePortBase()
  const map = await startMap({ repo: world.repo, home: world.home, base: base2, env: { CLAUDE_CONFIG_DIR: path.join(world.root, 'custom') } })
  await until(async () => (await map.model()).runs.some(r => r.id === 'moved'), 'the moved log')
  const lonely = tempWorld()
  t.after(() => lonely.cleanup())
  const other = await startMap({ repo: lonely.repo, home: lonely.home, base: await freePortBase() })
  assert.deepEqual((await other.model()).runs, [])
})
