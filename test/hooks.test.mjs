import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { after, afterEach, before, describe, test } from 'node:test'
import { isMapRelayCommand } from '../bin/lib/hooks.mjs'
import { BIN, cleanEnv, freePortBase, request, startMap, stopAll, tempWorld, until } from './helpers.mjs'

const MAP_EVENTS = ['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'SessionStart', 'SubagentStop']
const KITCHEN_EVENTS = ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'Notification', 'Stop', 'SubagentStart', 'SubagentStop']
const KITCHEN = `'/usr/local/bin/node' '/opt/agenttrail/packages/kitchen/bin/relay.mjs' claude '/home/me/.agent-office'`
const SIMILAR = 'node /opt/tools/agenttrail-audit.mjs hook'
const settingsPath = repo => path.join(repo, '.claude', 'settings.local.json')
const read = repo => JSON.parse(fs.readFileSync(settingsPath(repo), 'utf8'))
const commands = (cfg, ev) => (cfg.hooks[ev] || []).flatMap(e => (e.hooks || []).map(h => h.command))
const mapRelays = (cfg, ev) => commands(cfg, ev).filter(c => c.includes('bin/agenttrail.mjs'))

function addHooks(repo, command, events) {
  fs.mkdirSync(path.dirname(settingsPath(repo)), { recursive: true })
  let cfg = {}
  try { cfg = read(repo) } catch {}
  cfg.hooks ||= {}
  for (const ev of events) (cfg.hooks[ev] ||= []).push({ hooks: [{ type: 'command', command, timeout: 2 }] })
  fs.writeFileSync(settingsPath(repo), JSON.stringify(cfg, null, 2))
}
const installMap = world => {
  const r = spawnSync(process.execPath, [BIN, 'init', '--hooks-only', world.repo], { env: cleanEnv(world.home), encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  return r
}

test('only Map relay commands are recognised', () => {
  for (const c of ['node "/a/bin/agenttrail.mjs" hook', 'node /a/agenttrail.mjs hook', '/usr/bin/node "/a b/agenttrail.mjs" hook', "'/usr/bin/node' '/a/agenttrail.mjs' hook", 'node "C:\\\\a\\\\agenttrail.mjs" hook', 'agenttrail hook']) {
    assert.equal(isMapRelayCommand(c), true, c)
  }
  for (const c of [KITCHEN, SIMILAR, 'node /a/agenttrail.mjs.bak hook', 'node /a/agenttrail.mjs hook --debug', 'node /a/agenttrail.mjs serve', 'bash /a/agenttrail.mjs hook', 'echo agenttrail', '', undefined]) {
    assert.equal(isMapRelayCommand(c), false, String(c))
  }
})

describe('hook installation', () => {
  let world
  afterEach(() => world?.cleanup())

  test('after Kitchen: Map still installs and Kitchen stays', () => {
    world = tempWorld()
    addHooks(world.repo, KITCHEN, KITCHEN_EVENTS)
    installMap(world)
    const cfg = read(world.repo)
    for (const ev of MAP_EVENTS) assert.equal(mapRelays(cfg, ev).length, 1, ev)
    for (const ev of KITCHEN_EVENTS) assert.ok(commands(cfg, ev).includes(KITCHEN), ev)
  })

  test('before Kitchen: a later Kitchen install coexists and repeat is stable', () => {
    world = tempWorld()
    installMap(world)
    addHooks(world.repo, KITCHEN, KITCHEN_EVENTS)
    installMap(world)
    const cfg = read(world.repo)
    for (const ev of MAP_EVENTS) assert.equal(mapRelays(cfg, ev).length, 1, ev)
    for (const ev of KITCHEN_EVENTS) assert.equal(commands(cfg, ev).filter(c => c === KITCHEN).length, 1, ev)
  })

  test('repeating the install changes nothing', () => {
    world = tempWorld()
    installMap(world)
    const first = fs.readFileSync(settingsPath(world.repo), 'utf8')
    const again = installMap(world)
    assert.equal(fs.readFileSync(settingsPath(world.repo), 'utf8'), first)
    assert.ok(!again.stdout.includes('wired'))
  })

  test('hooks with similar names and other settings are preserved', () => {
    world = tempWorld()
    addHooks(world.repo, SIMILAR, ['PostToolUse'])
    const cfg = read(world.repo)
    fs.writeFileSync(settingsPath(world.repo), JSON.stringify({ ...cfg, permissions: { allow: ['Read'] } }))
    installMap(world)
    const after = read(world.repo)
    assert.deepEqual(after.permissions, { allow: ['Read'] })
    assert.ok(commands(after, 'PostToolUse').includes(SIMILAR))
    assert.equal(mapRelays(after, 'PostToolUse').length, 1)
  })

  test('an install from before PostToolUseFailure gains only that event', () => {
    world = tempWorld()
    const command = `node ${JSON.stringify(BIN)} hook`
    addHooks(world.repo, command, MAP_EVENTS.filter(e => e !== 'PostToolUseFailure'))
    const r = installMap(world)
    assert.match(r.stdout, /wired 1 claude code hooks/)
    assert.equal(mapRelays(read(world.repo), 'PostToolUseFailure').length, 1)
  })

  test('a corrupt settings file is left alone', () => {
    world = tempWorld()
    fs.mkdirSync(path.dirname(settingsPath(world.repo)))
    fs.writeFileSync(settingsPath(world.repo), '{ broken')
    const r = installMap(world)
    assert.match(r.stderr, /not valid JSON/)
    assert.equal(fs.readFileSync(settingsPath(world.repo), 'utf8'), '{ broken')
  })
})

test('the board does not count Kitchen as Map hooks', async t => {
  const world = tempWorld()
  t.after(async () => { await stopAll(); world.cleanup() })
  addHooks(world.repo, KITCHEN, KITCHEN_EVENTS)
  const base = await freePortBase()
  const map = await startMap({ repo: world.repo, home: world.home, base })
  assert.equal((await map.model()).hooksInstalled, false)
})

describe('runs from hooks', () => {
  let world, map
  const hook = ev => map.post('/hook', { cwd: world.repo, session_id: 's', ...ev })
  const relay = (event, env) => spawnSync(process.execPath, [BIN, 'hook'], {
    input: JSON.stringify({ cwd: world.repo, ...event }),
    env: cleanEnv(world.home, { AGENTTRAIL_PORT: String(map.port), ...env }),
  })
  const run = async id => (await map.model()).runs.find(r => r.id === id)

  before(async () => {
    world = tempWorld()
    map = await startMap({ repo: world.repo, home: world.home, base: await freePortBase() })
  })
  after(async () => { await stopAll(); world.cleanup() })

  test('a modern task list follows successful tools only', async () => {
    const post = (tool_name, tool_input, tool_response) => hook({ hook_event_name: 'PostToolUse', tool_name, tool_input, tool_response })
    await hook({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'a' } })
    assert.equal((await run('s')).evidence.todos, 'unknown')
    assert.equal((await run('s')).todosUpdatedAt, null)
    await post('TaskCreate', { subject: 'Parse tasks' }, { task: { id: '1', subject: 'Parse tasks' } })
    await post('TaskUpdate', { taskId: '1', status: 'in_progress' }, { success: true, taskId: '1', updatedFields: ['status'], statusChange: { from: 'pending', to: 'in_progress' } })
    let r = await run('s')
    assert.deepEqual(r.todos, [{ id: '1', content: 'Parse tasks', status: 'in_progress' }])
    assert.equal(r.evidence.todos, 'reported')
    await post('TaskUpdate', { taskId: '1', status: 'completed' }, { success: false, taskId: '1', error: 'denied' })
    await post('TaskUpdate', { taskId: '1', status: 'completed' }, 'an unknown future format')
    await hook({ hook_event_name: 'PostToolUse', status: 'failed', tool_name: 'TaskUpdate', tool_input: { taskId: '1', status: 'completed' }, tool_response: 'Updated task #1 status' })
    await hook({ hook_event_name: 'PostToolUseFailure', tool_name: 'TaskUpdate', tool_input: { taskId: '1', status: 'completed' }, tool_response: 'Updated task #1 status' })
    r = await run('s')
    assert.equal(r.todos[0].status, 'in_progress')
    assert.equal(r.currentTool, null)
    assert.equal(r.recentTools[0].error, true)
    await post('TaskUpdate', { taskId: '1', status: 'completed' }, 'Updated task #1 status')
    assert.equal((await run('s')).todos[0].status, 'completed')
  })

  test('a run reports its provider and status', async () => {
    const r = await run('s')
    assert.equal(r.provider, 'claude')
    assert.equal(r.source, 'hook')
    assert.equal(r.status, 'active')
    await hook({ hook_event_name: 'Stop' })
    assert.equal((await run('s')).status, 'idle')
    await hook({ hook_event_name: 'SessionEnd' })
    assert.equal((await run('s')).status, 'ended')
  })

  test('HC_TERMINAL_ID tells two agents in one repo apart', async () => {
    assert.equal(relay({ hook_event_name: 'SessionStart', session_id: 'left' }, { HC_TERMINAL_ID: 'term-1' }).status, 0)
    assert.equal(relay({ hook_event_name: 'SessionStart', session_id: 'right' }, { HC_TERMINAL_ID: 'term-2' }).status, 0)
    await until(async () => (await run('left'))?.terminalId === 'term-1' && (await run('right'))?.terminalId === 'term-2', 'terminal ids')
    const summary = JSON.parse((await map.get('/summary')).body)
    assert.equal(summary.runs.find(r => r.id === 'left').terminalId, 'term-1')
  })

  test('a missing terminal id stays absent and never clears a known one', async () => {
    assert.equal(relay({ hook_event_name: 'SessionStart', session_id: 'plain' }).status, 0)
    const r = await until(() => run('plain'), 'the plain run')
    assert.ok(!('terminalId' in r))
    assert.equal(relay({ hook_event_name: 'PreToolUse', session_id: 'left', tool_name: 'Read', tool_input: {} }).status, 0)
    await until(async () => (await run('left')).currentTool, 'the tool event')
    assert.equal((await run('left')).terminalId, 'term-1')
  })

  test('the relay still forwards a payload it cannot parse', async () => {
    assert.equal(spawnSync(process.execPath, [BIN, 'hook'], { input: 'not json', env: cleanEnv(world.home, { AGENTTRAIL_PORT: String(map.port), HC_TERMINAL_ID: 't' }) }).status, 0)
    assert.equal((await request(map.port, '/whoami')).status, 200)
  })
})
