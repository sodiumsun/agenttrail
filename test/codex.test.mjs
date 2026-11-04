import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import { CodexLogReader, READ_LIMIT, codexEffects } from '../bin/lib/codex.mjs'
import { freePortBase, startMap, stopAll, tempDir, tempWorld, until } from './helpers.mjs'

// Synthetic logs in the shapes Codex writes. Nothing here comes from a real session.
const T0 = Date.now() - 60_000
const at = n => new Date(T0 + n * 1000).toISOString()
const row = (n, type, payload) => ({ timestamp: at(n), type, payload })
const meta = (id, cwd, extra = {}) => row(0, 'session_meta', { id, session_id: id, cwd, timestamp: at(0), source: 'cli', ...extra })
const started = n => row(n, 'event_msg', { type: 'task_started', turn_id: 't' })
const complete = n => row(n, 'event_msg', { type: 'task_complete', turn_id: 't' })
const aborted = n => row(n, 'event_msg', { type: 'turn_aborted', turn_id: 't' })
const planCall = (n, id, plan) => row(n, 'response_item', { type: 'function_call', name: 'update_plan', call_id: id, arguments: JSON.stringify({ explanation: 'PRIVATE', plan }) })
const output = (n, id, out) => row(n, 'response_item', { type: 'function_call_output', call_id: id, output: out })
const patchCall = (n, id, files) => row(n, 'response_item', { type: 'custom_tool_call', name: 'apply_patch', call_id: id, input: `*** Begin Patch\n${files.map(f => `*** Update File: ${f}\n@@\n+PRIVATE BODY`).join('\n')}\n*** End Patch` })
const patchOutput = (n, id, out) => row(n, 'response_item', { type: 'custom_tool_call_output', call_id: id, output: out })
const item = (n, body) => row(n, 'event_msg', { type: 'item_completed', thread_id: 'codex-1', item: { id: `item-${n}`, ...body } })
const steps = (...status) => status.map((s, i) => ({ step: `Step ${i + 1}`, status: s }))

const replay = (...rows) => {
  const cursor = {}, m = { id: 'codex-1', cwd: '/repo' }
  return rows.flatMap(r => codexEffects(r, m, cursor))
}
const plans = effects => effects.filter(e => e.kind === 'tasks').map(e => e.list)
const tools = effects => effects.filter(e => e.kind === 'tool-end' && e.record)

describe('update_plan commits on success only', () => {
  const list = steps('completed', 'in_progress')
  test('success, as a string or as text blocks', () => {
    const expected = [[{ content: 'Step 1', status: 'completed' }, { content: 'Step 2', status: 'in_progress' }]]
    assert.deepEqual(plans(replay(planCall(1, 'a', list), output(2, 'a', 'Plan updated'))), expected)
    assert.deepEqual(plans(replay(planCall(1, 'a', list), output(2, 'a', [{ type: 'input_text', text: 'Plan updated' }]))), expected)
  })
  test('no effect before the result arrives', () => {
    assert.deepEqual(plans(replay(planCall(1, 'a', list))), [])
  })
  test('failure, unknown results and a missing plan change nothing', () => {
    for (const out of ['failed to parse function arguments', 'Exit code: 1\nOutput:\nPlan updated', '{"success":false}', 'something new', '', undefined]) {
      assert.deepEqual(plans(replay(planCall(1, 'a', list), output(2, 'a', out))), [], String(out))
    }
    assert.deepEqual(plans(replay(row(1, 'response_item', { type: 'function_call', name: 'update_plan', call_id: 'a', arguments: 'not json' }), output(2, 'a', 'Plan updated'))), [])
  })
  test('an interrupted call cannot commit late', () => {
    assert.deepEqual(plans(replay(planCall(1, 'a', list), aborted(2), output(3, 'a', 'Plan updated'))), [])
    assert.deepEqual(plans(replay(planCall(1, 'a', list), complete(2), output(3, 'a', 'Plan updated'))), [])
  })
  test('a result matches its own call', () => {
    assert.deepEqual(plans(replay(planCall(1, 'a', list), output(2, 'b', 'Plan updated'))), [])
  })
  test('no explanation survives', () => {
    assert.ok(!JSON.stringify(replay(planCall(1, 'a', list), output(2, 'a', 'Plan updated'))).includes('PRIVATE'))
  })
})

describe('tool activity', () => {
  const patchFiles = effects => effects.flatMap(e => e.files || [])
  test('apply_patch claims files only after it succeeded', () => {
    assert.deepEqual(patchFiles(replay(patchCall(1, 'p', ['src/a.js']), patchOutput(2, 'p', 'Success. Updated the following files:\nM src/a.js'))), ['src/a.js'])
    assert.deepEqual(patchFiles(replay(patchCall(1, 'p', ['src/a.js']), patchOutput(2, 'p', '{"output":"done","metadata":{"exit_code":0}}'))), ['src/a.js'])
    for (const out of ['apply_patch verification failed', '{"output":"no","metadata":{"exit_code":1}}', 'Exit code: 1', 'unknown']) {
      assert.deepEqual(patchFiles(replay(patchCall(1, 'p', ['src/a.js']), patchOutput(2, 'p', out))), [], out)
    }
    assert.ok(!JSON.stringify(replay(patchCall(1, 'p', ['src/a.js']))).includes('PRIVATE'))
  })
  test('FileChange items: path-keyed and listed forms, completed only', () => {
    assert.deepEqual(patchFiles(replay(item(1, { type: 'FileChange', status: 'completed', changes: { '/repo/a.js': { type: 'update' } } }))), ['/repo/a.js'])
    assert.deepEqual(patchFiles(replay(item(1, { type: 'FileChange', status: 'completed', changes: [{ path: 'a.js' }] }))), ['a.js'])
    assert.deepEqual(patchFiles(replay(item(1, { type: 'FileChange', status: 'failed', changes: { '/repo/a.js': {} } }))), [])
    assert.deepEqual(patchFiles(replay(item(1, { type: 'FileChange', changes: { '/repo/a.js': {} } }))), [])
  })
  test('commands report name, shortened detail, duration and failure', () => {
    const [ok] = tools(replay(item(1, { type: 'CommandExecution', status: 'completed', exit_code: 0, command: ['/bin/zsh', '-lc', 'npm test'], duration: { secs: 2, nanos: 5e8 } })))
    assert.deepEqual([ok.name, ok.detail, ok.ms, ok.error], ['Shell', 'npm test', 2500, false])
    const [read] = tools(replay(item(1, { type: 'CommandExecution', status: 'completed', exit_code: 0, command: ['cat', 'a'], parsed_cmd: [{ type: 'read', cmd: 'cat a' }] })))
    assert.deepEqual([read.name, read.detail], ['Read', 'cat a'])
    assert.equal(tools(replay(item(1, { type: 'CommandExecution', status: 'failed', exit_code: 2, command: ['false'] })))[0].error, true)
    assert.ok(tools(replay(item(1, { type: 'CommandExecution', status: 'completed', exit_code: 0, command: ['/bin/sh', '-c', 'x'.repeat(500)] })))[0].detail.length <= 90)
  })
  test('the exec wrapper shows as running but not as finished work', () => {
    const effects = replay(row(1, 'response_item', { type: 'custom_tool_call', name: 'exec', call_id: 'w', input: 'PRIVATE CODE' }), patchOutput(2, 'w', 'done'))
    assert.equal(effects[0].kind, 'tool-start')
    assert.equal(effects[0].detail, '')
    assert.deepEqual(tools(effects), [])
    assert.ok(!JSON.stringify(effects).includes('PRIVATE'))
  })
  test('a call and its item are one piece of work, in either order', () => {
    const call = row(1, 'response_item', { type: 'function_call', namespace: 'mcp__x', name: 'js', call_id: 'item-2', arguments: '{}' })
    const done = item(2, { type: 'McpToolCall', server: 'x', tool: 'js', status: 'completed', result: {} })
    assert.equal(tools(replay(call, done, output(3, 'item-2', 'ok'))).length, 1)
    assert.equal(tools(replay(call, output(3, 'item-2', 'ok'), done)).length, 1)
  })
  test('other threads, unknown rows and rows with no time are ignored', () => {
    assert.deepEqual(replay(row(1, 'event_msg', { type: 'item_completed', thread_id: 'someone-else', item: { id: 'x', type: 'FileChange', status: 'completed', changes: {} } })), [])
    assert.deepEqual(replay(row(1, 'future_kind', {}), { type: 'event_msg', payload: { type: 'task_started' } }, row(1, 'event_msg', { type: 'token_count' }), item(1, { type: 'Reasoning' }), output(1, 'never-started', 'Plan updated')), [])
  })
})

describe('reading log files', () => {
  let home, file
  const write = (name, rows) => {
    const dir = path.join(home, 'sessions', '2026', '11', '04')
    fs.mkdirSync(dir, { recursive: true })
    const target = path.join(dir, name)
    fs.writeFileSync(target, rows.map(r => JSON.stringify(r) + '\n').join(''))
    return target
  }
  const reader = (wants = () => true) => {
    const seen = []
    const r = new CodexLogReader({ codexHome: home, wants, apply: (m, effects) => seen.push(...effects.map(e => ({ ...e, session: m.id, limited: m.limited }))) })
    return { r, seen }
  }
  beforeEach(() => {
    home = tempDir('codex')
    file = null
  })
  afterEach(() => fs.rmSync(home, { recursive: true, force: true }))

  test('missing logs are quiet', async () => {
    const r = new CodexLogReader({ codexHome: path.join(home, 'absent'), wants: () => true, apply: () => assert.fail('nothing to apply') })
    assert.equal(await r.poll(), false)
  })

  test('only wanted sessions are read', async () => {
    write('mine.jsonl', [meta('mine', '/repo'), started(1)])
    write('other.jsonl', [meta('other', '/elsewhere'), started(1)])
    const { r, seen } = reader(cwd => cwd === '/repo')
    await r.poll()
    assert.deepEqual([...new Set(seen.map(e => e.session))], ['mine'])
  })

  test('a row still being written waits for its newline, and is read once', async () => {
    file = write('a.jsonl', [meta('a', '/repo'), started(1)])
    const { r, seen } = reader()
    await r.poll()
    assert.equal(seen.length, 1)
    const line = JSON.stringify(complete(2))
    fs.appendFileSync(file, line.slice(0, 10))
    await r.poll()
    assert.equal(seen.length, 1)
    fs.appendFileSync(file, line.slice(10) + '\n')
    await r.poll()
    assert.deepEqual(seen.map(e => e.kind), ['turn-start', 'turn-end'])
    await r.poll()
    assert.equal(seen.length, 2)
  })

  test('a corrupt line is skipped and a truncated log starts over', async () => {
    file = write('a.jsonl', [meta('a', '/repo'), started(1)])
    fs.appendFileSync(file, '{broken\n' + JSON.stringify(complete(2)) + '\n')
    const { r, seen } = reader()
    await r.poll()
    assert.equal(seen.length, 2)
    fs.writeFileSync(file, JSON.stringify(meta('a', '/repo')) + '\n')
    await r.poll()
    fs.appendFileSync(file, JSON.stringify(started(3)) + '\n')
    await r.poll()
    assert.equal(seen.length, 3)
  })

  test('a huge log is read from its tail and marked partial', async () => {
    file = write('big.jsonl', [meta('big', '/repo'), planCall(1, 'lost', steps('pending')), output(2, 'lost', 'Plan updated')])
    const filler = JSON.stringify(row(3, 'event_msg', { type: 'token_count', pad: 'x'.repeat(1000) })) + '\n'
    fs.appendFileSync(file, filler.repeat(Math.ceil(READ_LIMIT * 1.5 / filler.length)))
    fs.appendFileSync(file, JSON.stringify(started(4)) + '\n')
    const { r, seen } = reader()
    await r.poll()
    assert.deepEqual(seen.map(e => e.kind), ['turn-start'])
    assert.equal(seen[0].limited, true)
  })

  test('one line longer than the limit cannot stall the reader', async () => {
    file = write('wide.jsonl', [meta('wide', '/repo')])
    fs.appendFileSync(file, 'x'.repeat(READ_LIMIT + 10))
    const { r, seen } = reader()
    await r.poll()
    fs.appendFileSync(file, '\n' + JSON.stringify(started(4)) + '\n')
    await r.poll()
    assert.deepEqual(seen.map(e => e.kind), ['turn-start'])
  })

  test('old logs are left alone', async () => {
    file = write('old.jsonl', [meta('old', '/repo'), started(1)])
    const stale = new Date(Date.now() - 3 * 3600e3)
    fs.utimesSync(file, stale, stale)
    const { r, seen } = reader()
    await r.poll()
    assert.deepEqual(seen, [])
  })
})

describe('Codex runs on the map', () => {
  const PLAN = '# demo\n\n## Build the api {#api}\nfiles: [src/api/**]\n- [ ] One {#one}\n\n## Build the ui {#ui}\nfiles: [src/ui/**]\n- [ ] Two {#two}\n\n## decisions\n'
  let world, base, map, codexDir, session
  const snapshot = dir => fs.readdirSync(dir, { recursive: true }).sort().map(f => {
    const s = fs.statSync(path.join(dir, f))
    return `${f}:${s.size}:${s.mtimeMs}`
  })
  const run = async id => (await map.model()).runs.find(r => r.id === id)
  const logRows = (id, cwd, rows) => {
    const target = path.join(codexDir, `${id}.jsonl`)
    fs.writeFileSync(target, [meta(id, cwd), ...rows].map(r => JSON.stringify(r) + '\n').join(''))
    return target
  }

  before(async () => {
    world = tempWorld(PLAN)
    base = await freePortBase()
    codexDir = path.join(world.home, '.codex', 'sessions', '2026', '11', '04')
    fs.mkdirSync(codexDir, { recursive: true })
    fs.mkdirSync(path.join(world.repo, 'src', 'api'), { recursive: true })
    const api = path.join(world.repo, 'src', 'api', 'a.js'), ui = path.join(world.repo, 'src', 'ui', 'b.js')
    session = logRows('codex-1', world.repo, [
      started(1),
      planCall(2, 'plan-1', steps('in_progress', 'pending')),
      output(3, 'plan-1', 'Plan updated'),
      patchCall(4, 'patch-1', ['src/api/a.js']),
      patchOutput(5, 'patch-1', 'Success. Updated the following files:\nM src/api/a.js'),
      item(6, { type: 'CommandExecution', status: 'completed', exit_code: 0, command: ['/bin/sh', '-lc', 'npm test'] }),
      item(7, { type: 'FileChange', status: 'completed', changes: { [ui]: { type: 'update', unified_diff: 'PRIVATE DIFF' } } }),
      planCall(8, 'plan-2', steps('completed', 'completed')),
      output(9, 'plan-2', 'failed to parse function arguments'),
      complete(10),
    ])
    logRows('codex-sub', path.join(world.repo, 'src'), [started(1)])
    logRows('codex-away', world.root, [started(1)])
    fs.writeFileSync(path.join(codexDir, 'not-a-session.jsonl'), '{"type":"something_else"}\n')
    map = await startMap({ repo: world.repo, home: world.home, base })
    await until(() => run('codex-1'), 'the Codex run')
  })
  after(async () => { await stopAll(); world.cleanup() })

  test('a session becomes a run with honest labels', async () => {
    const r = await until(async () => { const x = await run('codex-1'); return x?.status === 'idle' && x }, 'the finished turn')
    assert.equal(r.provider, 'codex')
    assert.equal(r.agent, 'codex')
    assert.equal(r.source, 'codex-log')
    assert.deepEqual(r.evidence, { lifecycle: 'reported', todos: 'reported', tools: 'observed', component: 'inferred' })
    assert.ok(!('terminalId' in r))
    assert.equal(r.startedAt, Date.parse(at(0)))
    assert.equal(r.lastEventAt, Date.parse(at(10)))
  })

  test('the plan is the last confirmed one', async () => {
    const r = await run('codex-1')
    assert.deepEqual(r.todos, [{ content: 'Step 1', status: 'in_progress' }, { content: 'Step 2', status: 'pending' }])
    assert.equal(r.todosUpdatedAt, Date.parse(at(3)))
  })

  test('tool activity and the path trail are recorded', async () => {
    const r = await run('codex-1')
    assert.deepEqual(r.recentTools.map(t => t.name), ['update_plan', 'Edit', 'Shell', 'apply_patch', 'update_plan'])
    assert.deepEqual(r.path, [{ c: 'api', at: Date.parse(at(5)) }, { c: 'ui', at: Date.parse(at(7)) }])
    assert.equal(r.componentId, 'ui')
    assert.ok(!JSON.stringify(await map.model()).includes('PRIVATE'))
  })

  test('a session in a subfolder counts; one elsewhere does not', async () => {
    const m = await map.model()
    assert.ok(m.runs.some(r => r.id === 'codex-sub'))
    assert.equal(m.runs.find(r => r.id === 'codex-sub').evidence.todos, 'unknown')
    assert.ok(!m.runs.some(r => r.id === 'codex-away'))
  })

  test('the board summary carries the identity fields', async () => {
    const summary = JSON.parse((await map.get('/summary')).body)
    const r = summary.runs.find(x => x.id === 'codex-1')
    assert.deepEqual([r.provider, r.status, r.componentId, r.todos], ['codex', 'idle', 'ui', 2])
  })

  test('new lines arrive live', async () => {
    fs.appendFileSync(session, [started(20), planCall(21, 'plan-3', steps('completed', 'in_progress')), output(22, 'plan-3', [{ type: 'input_text', text: 'Plan updated' }])].map(r => JSON.stringify(r) + '\n').join(''))
    const r = await until(async () => { const x = await run('codex-1'); return x.todos[0].status === 'completed' && x }, 'the new plan')
    assert.equal(r.status, 'active')
  })

  test('an interrupted turn says so and keeps its plan', async () => {
    fs.appendFileSync(session, [planCall(23, 'plan-4', steps('completed', 'completed')), aborted(24)].map(r => JSON.stringify(r) + '\n').join(''))
    const r = await until(async () => { const x = await run('codex-1'); return x.status === 'interrupted' && x }, 'the interruption')
    assert.equal(r.todos[1].status, 'in_progress')
  })

  test('a restart neither repeats events nor loses them', async () => {
    const before_ = await run('codex-1')
    await map.stop()
    fs.appendFileSync(session, [output(25, 'plan-4', 'Plan updated'), started(26), item(27, { type: 'CommandExecution', status: 'completed', exit_code: 0, command: ['ls'] })].map(r => JSON.stringify(r) + '\n').join(''))
    map = await startMap({ repo: world.repo, home: world.home, base })
    const r = await until(async () => { const x = await run('codex-1'); return x?.recentTools[0].detail === 'ls' && x }, 'the line written during the restart')
    assert.deepEqual(r.recentTools.slice(1), before_.recentTools.slice(0, 7))
    assert.equal(r.todos[1].status, 'in_progress') // the abandoned proposal stayed abandoned
    assert.deepEqual(r.path, before_.path)
  })

  test('the Codex home is only ever read', async () => {
    const codexHome = path.join(world.home, '.codex')
    const beforeLogs = snapshot(codexHome)
    await new Promise(r => setTimeout(r, 2300))
    assert.deepEqual(snapshot(codexHome), beforeLogs)
    assert.deepEqual(fs.readdirSync(codexHome), ['sessions'])
  })
})

test('CODEX_HOME moves the logs, and a machine with none is fine', async t => {
  const world = tempWorld()
  t.after(async () => { await stopAll(); world.cleanup() })
  const base = await freePortBase()
  const dir = path.join(world.root, 'elsewhere', 'sessions', '2026', '01', '02')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'x.jsonl'), [meta('moved', world.repo), started(1)].map(r => JSON.stringify(r) + '\n').join(''))
  const empty = await startMap({ repo: world.repo, home: world.home, base })
  assert.deepEqual((await empty.model()).runs, [])
  await empty.stop()
  const map = await startMap({ repo: world.repo, home: world.home, base, env: { CODEX_HOME: path.join(world.root, 'elsewhere') } })
  await until(async () => (await map.model()).runs.some(r => r.id === 'moved'), 'the moved log')
})
