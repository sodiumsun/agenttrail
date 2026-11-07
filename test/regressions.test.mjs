// Defects found in review of the Herdr branch, each pinned by the scenario that showed it.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { afterEach, describe, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { ClaudeLogReader } from '../bin/lib/claude.mjs'
import { CodexLogReader } from '../bin/lib/codex.mjs'
import { MAX_CANDIDATES, META_BYTES } from '../bin/lib/logtail.mjs'
import { Feed } from '../herdr/agenttrail/mods/agenttrail/feed.js'
import { BIN, cleanEnv, freePortBase, request, startMap, stopAll, tempDir, tempWorld, until } from './helpers.mjs'

let world
afterEach(async () => { await stopAll(); world?.cleanup(); world = null })
const boot = async (plan, env) => {
  world = tempWorld(plan)
  return startMap({ repo: world.repo, home: world.home, base: await freePortBase(), env })
}
const iso = ms => new Date(ms).toISOString()

describe('a plan cannot run script in the Map page', () => {
  const plan = url => `# p\n\n## Part {#part}\nurl: ${url}\n- [ ] t {#t}\n`
  const urlOf = async map => (await map.model()).plan.find(n => n.id === 'part').url
  test('only a plain web address becomes a card link', async () => {
    const map = await boot(plan('http://localhost:3000/console?a=1'))
    assert.equal(await urlOf(map), 'http://localhost:3000/console?a=1')
    for (const bad of [`x"><img/src='x'/onerror=alert(1)>`, 'javascript:alert(1)', `http://x"><img/src='x'/onerror=alert(1)>`, 'data:text/html,x']) {
      fs.writeFileSync(path.join(world.repo, 'PLAN.md'), plan(bad))
      await until(async () => (await urlOf(map)) === '', `dropping ${bad}`)
    }
  })
  test('the page never builds the link inside a script attribute', () => {
    const page = fs.readFileSync(path.join(path.dirname(BIN), '..', 'public', 'index.html'), 'utf8')
    assert.ok(!page.includes('JSON.stringify(p.url)'))
    assert.ok(page.includes('data-url="${esc(p.url)}"'))
  })
})

describe('starting up', () => {
  test('a Map that moves off a busy port starts once', async () => {
    world = tempWorld('# p\n')
    const base = await freePortBase()
    // The daemon probes its whole port range for sibling boards, so it will connect
    // here; a fetch it abandons resets that socket, and an unhandled error on the
    // accepted socket fails this test on Windows.
    const blocker = net.createServer(s => s.on('error', () => {}))
    await new Promise(r => blocker.listen(base, '127.0.0.1', r))
    const child = spawn(process.execPath, [BIN, world.repo, '--no-open'], { env: cleanEnv(world.home, { AGENTTRAIL_PORT_BASE: String(base) }), stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', c => out += c)
    // A force-killed child's pipe can report ECONNRESET on Windows; the test
    // only cares about the banner, so an error on either pipe must not fail it.
    child.stdout.on('error', () => {})
    child.stderr.on('error', () => {})
    await until(() => out.includes('localhost:'), 'the banner')
    await new Promise(r => setTimeout(r, 300))
    await new Promise(r => { child.once('exit', r); child.kill() })
    blocker.close()
    assert.equal(out.match(/agenttrail ·/g).length, 1, out)
  })
  test('the page sets up a repo without waiting on the terminal', { skip: process.platform === 'win32' ? "python3's pty module is POSIX-only" : spawnSync('python3', ['-V']).status !== 0 }, async () => {
    world = tempWorld()
    const base = await freePortBase()
    // A pty, as in a terminal or a Herdr tab: stdin is a TTY and nobody answers it.
    const child = spawn('python3', ['-c', 'import pty,sys;pty.spawn(sys.argv[1:])', process.execPath, BIN, world.repo, '--no-open'], {
      env: cleanEnv(world.home, { AGENTTRAIL_PORT_BASE: String(base), AGENTTRAIL_PORT: String(base) }), stdio: ['pipe', 'pipe', 'ignore'],
    })
    let out = ''
    child.stdout.on('data', c => out += c)
    try {
      await until(() => out.includes('localhost:'), 'the banner')
      const token = (await request(base, '/')).body.match(/name="agenttrail-token" content="([^"]*)"/)[1]
      const res = await request(base, '/setup', { method: 'POST', headers: { 'x-agenttrail-token': token } })
      assert.equal(JSON.parse(res.body).ok, true)
      assert.ok(fs.existsSync(path.join(world.repo, '.claude', 'settings.local.json')))
    } finally {
      child.stdin.write('\x03')
      child.kill('SIGKILL')
      await request(base, '/whoami').catch(() => {})
      spawnSync('pkill', ['-f', world.repo])
    }
  })
  test('saved state and its folder are private to this user', { skip: process.platform === 'win32' ? 'Windows force-terminates on SIGTERM, so the daemon never saves state' : false }, async () => {
    const map = await boot('# p\n')
    await map.stop()
    const dir = path.join(world.home, '.agenttrail')
    const file = fs.readdirSync(dir).find(f => f.endsWith('.json'))
    assert.equal(fs.statSync(path.join(dir, file)).mode & 0o077, 0)
    fs.chmodSync(path.join(dir, file), 0o644) // as an earlier version left it
    const again = await startMap({ repo: world.repo, home: world.home, base: await freePortBase() })
    await again.stop()
    assert.equal(fs.statSync(path.join(dir, file)).mode & 0o077, 0)
  })
})

describe('hooks from an earlier install', () => {
  test('init points a stale relay at this version and adds no second one', () => {
    world = tempWorld()
    const stale = 'node "/gone/_npx/old/node_modules/agenttrail/bin/agenttrail.mjs" hook'
    const other = { matcher: '*', hooks: [{ type: 'command', command: 'echo mine' }] }
    const sp = path.join(world.repo, '.claude', 'settings.local.json')
    fs.mkdirSync(path.dirname(sp))
    fs.writeFileSync(sp, JSON.stringify({ hooks: { Stop: [other, { matcher: '*', hooks: [{ type: 'command', command: stale }] }], PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'agenttrail hook' }] }] } }))
    spawnSync(process.execPath, [BIN, 'init', '--hooks-only'], { cwd: world.repo, env: cleanEnv(world.home) })
    const { hooks } = JSON.parse(fs.readFileSync(sp, 'utf8'))
    const commands = ev => hooks[ev].flatMap(e => e.hooks.map(h => h.command))
    assert.deepEqual(commands('Stop'), ['echo mine', `node ${JSON.stringify(BIN)} hook`])
    assert.deepEqual(commands('PreToolUse'), ['agenttrail hook'], 'a command on PATH has no stale path')
  })
})

describe('run status', () => {
  const session = 'status-1'
  const logWorld = async () => {
    world = tempWorld()
    const claude = path.join(world.home, '.claude')
    const dir = path.join(claude, 'projects', 'p')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `${session}.jsonl`)
    fs.writeFileSync(file, `${JSON.stringify({ type: 'last-prompt', sessionId: session, cwd: world.repo })}\n`) // found at boot, so a test waits two seconds, not ten
    const map = await startMap({ repo: world.repo, home: world.home, base: await freePortBase(), env: { CLAUDE_CONFIG_DIR: claude } })
    const write = (...rows) => fs.appendFileSync(file, rows.map(r => JSON.stringify({ sessionId: session, cwd: world.repo, isSidechain: false, ...r }) + '\n').join(''))
    const hook = ev => map.post('/hook', { cwd: world.repo, session_id: session, ...ev })
    const run = async () => (await map.model()).runs.find(r => r.id === session)
    return { map, write, hook, run }
  }
  const user = (at, text) => ({ type: 'user', timestamp: iso(at), message: { role: 'user', content: text } })

  test('a session that only opened is waiting, not working', async () => {
    const map = await boot('# p\n')
    const start = source => map.post('/hook', { cwd: world.repo, session_id: source, hook_event_name: 'SessionStart', source })
    const status = async id => (await map.model()).runs.find(r => r.id === id).status
    for (const source of ['startup', 'resume', 'clear']) { await start(source); assert.equal(await status(source), 'idle', source) }
    await start('compact') // compaction happens inside a working turn
    assert.equal(await status('compact'), 'active')
  })
  test('an interruption is seen even though its tool hook lands just after the row', async () => {
    const { write, hook, run } = await logWorld()
    await hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'sleep' } })
    const stopped = Date.now()
    await hook({ hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: 'sleep' } })
    write(user(stopped, '[Request interrupted by user for tool use]'))
    assert.equal(await until(async () => (await run()).status === 'interrupted' && 'ok', 'the interruption', 15_000), 'ok')
  })
  test('a first prompt is seen even though SessionStart lands just after it', async () => {
    const { write, hook, run } = await logWorld()
    const asked = Date.now()
    await hook({ hook_event_name: 'SessionStart', source: 'startup' })
    write(user(asked, 'do the thing'))
    assert.equal(await until(async () => (await run()).status === 'active' && 'ok', 'the prompt', 15_000), 'ok')
  })
  test('an old interruption does not end a turn that has moved on', async () => {
    const { write, hook, run } = await logWorld()
    await hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } })
    write(user(Date.now() - 60_000, '[Request interrupted by user]'), user(Date.now() - 59_000, 'next'))
    await new Promise(r => setTimeout(r, 3000))
    assert.equal((await run()).status, 'active')
  })
  test('activity after a silence is not called idle', async () => {
    const claude = 'silent-1'
    world = tempWorld()
    const dir = path.join(world.home, '.agenttrail')
    fs.mkdirSync(dir)
    const now = Date.now()
    const base = await freePortBase()
    const stateName = (await import('node:crypto')).createHash('sha1').update(world.repo).digest('hex').slice(0, 12) + '.json'
    const old = { id: claude, agent: 'claude', provider: 'claude', source: 'hook', cwd: world.repo, startedAt: now - 2e6, lastEventAt: now - 20 * 60e3, todos: [], todosUpdatedAt: null, currentTool: { name: 'Bash', detail: 'long', at: now - 20 * 60e3 }, recentTools: [], componentId: null, ended: false }
    fs.writeFileSync(path.join(dir, stateName), JSON.stringify({ repoPath: world.repo, port: base, runs: { [claude]: old } }))
    const map = await startMap({ repo: world.repo, home: world.home, base })
    const run = async () => (await map.model()).runs.find(r => r.id === claude)
    assert.equal((await run()).status, 'unknown')
    await map.post('/hook', { cwd: world.repo, session_id: claude, hook_event_name: 'SubagentStop' })
    assert.equal((await run()).status, 'active')
  })
})

describe('finding logs', () => {
  const recent = at => fs.utimesSync(at, new Date(), new Date())
  test('a Claude session whose first row is huge is still followed', async () => {
    const home = tempDir('claude-big')
    const dir = path.join(home, 'projects', 'p')
    fs.mkdirSync(dir, { recursive: true })
    const row = extra => JSON.stringify({ type: 'user', sessionId: 'big', cwd: '/repo', isSidechain: false, timestamp: iso(Date.now()), message: { role: 'user', content: 'hi' }, ...extra })
    // A pasted screenshot sits in the session's first row.
    fs.writeFileSync(path.join(dir, 'big.jsonl'), `${row({ image: 'x'.repeat(META_BYTES + 10) })}\n${row()}\n`)
    const seen = []
    const reader = new ClaudeLogReader({ claudeHome: home, wants: c => c === '/repo', rel: () => null, apply: (meta, effects) => seen.push([meta, effects]) })
    await reader.poll()
    fs.rmSync(home, { recursive: true, force: true })
    assert.equal(seen[0]?.[0].id, 'big')
  })
  test('past the candidate limit, the newest Codex sessions are the ones kept', async () => {
    const home = tempDir('codex-many')
    const day = d => path.join(home, 'sessions', ...d.split('/'))
    fs.mkdirSync(day('2024/01/01'), { recursive: true })
    fs.mkdirSync(day('2026/11/04'), { recursive: true })
    for (let i = 0; i < MAX_CANDIDATES + 1; i++) fs.closeSync(fs.openSync(path.join(day('2024/01/01'), `rollout-${i}.jsonl`), 'w'))
    const live = path.join(day('2026/11/04'), 'rollout-live.jsonl')
    fs.writeFileSync(live, `${JSON.stringify({ timestamp: iso(Date.now()), type: 'session_meta', payload: { id: 'live', cwd: '/repo' } })}\n`)
    recent(live)
    const reader = new CodexLogReader({ codexHome: home, wants: c => c === '/repo', apply: () => {} })
    await reader.poll()
    const watched = reader.watched
    fs.rmSync(home, { recursive: true, force: true })
    assert.deepEqual(watched, [live])
  })
  test('past the candidate limit, a Claude project with new sessions is kept', async () => {
    const home = tempDir('claude-many')
    const old = path.join(home, 'projects', 'a-old'), live = path.join(home, 'projects', 'z-live')
    fs.mkdirSync(old, { recursive: true }); fs.mkdirSync(live)
    for (let i = 0; i < MAX_CANDIDATES + 1; i++) fs.closeSync(fs.openSync(path.join(old, `s${i}.jsonl`), 'w'))
    fs.utimesSync(old, new Date(Date.now() - 86400e3), new Date(Date.now() - 86400e3))
    const file = path.join(live, 'live.jsonl')
    fs.writeFileSync(file, `${JSON.stringify({ type: 'user', sessionId: 'live', cwd: '/repo', timestamp: iso(Date.now()) })}\n`)
    const reader = new ClaudeLogReader({ claudeHome: home, wants: c => c === '/repo', rel: () => null, apply: () => {} })
    await reader.poll()
    const watched = reader.watched
    fs.rmSync(home, { recursive: true, force: true })
    assert.deepEqual(watched, [file])
  })
})

describe('the Map mod', () => {
  test('a port that never answers gets one fetch, not one per round', async () => {
    const calls = []
    const feed = new Feed({
      fetch: url => { calls.push(url); return url.includes(':5331/') ? new Promise(() => {}) : Promise.reject(new Error('refused')) },
      sleep: () => Promise.resolve(), base: 5330,
    })
    for (let i = 0; i < 6; i++) await feed.scan()
    assert.equal(calls.filter(u => u.includes(':5331/')).length, 1)
    assert.equal(calls.filter(u => u.includes(':5330/')).length, 6)
  })
  test('Start Map here can be pressed again when no Map appears', async () => {
    const dir = tempDir('mod')
    const mod = path.join(path.dirname(BIN), '..', 'herdr', 'agenttrail', 'mods', 'agenttrail')
    fs.writeFileSync(path.join(dir, 'stub.mjs'), `
      export class View {}
      export const div = 0, image = 0, svg = 0, PathBuilder = 0, v_flex = 0, h_flex = 0, appHome = 0, focused = 0, home = 0, layout = 0, nextCommand = 0, panes = 0, setShared = 0, settings = 0, shared = () => null, spaces = 0
      export const props = () => ({})
      export const exec = async () => ({ code: 1, stdout: '' })
      export const run = () => {}
    `)
    const stub = pathToFileURL(path.join(dir, 'stub.mjs')).href
    const source = fs.readFileSync(path.join(mod, 'main.js'), 'utf8')
      .replace(/from "(gpui-kit|gpui-base|herdr)"/g, `from "${stub}"`)
      .replace(/from "\.\/(.+?)"/g, (_, f) => `from "${pathToFileURL(path.join(mod, f)).href}"`)
    fs.writeFileSync(path.join(dir, 'main.mjs'), source)
    const { default: MapView } = await import(pathToFileURL(path.join(dir, 'main.mjs')).href)
    fs.rmSync(dir, { recursive: true, force: true })
    const view = new MapView()
    view.init({}, { spawn() {} })
    const tasks = []
    const cx = { notify() {}, sleep: async () => {}, spawn: fn => tasks.push(fn(cx)) }
    view.startMap('/w/app', cx)
    assert.ok(view.starting.has('/w/app'))
    await Promise.all(tasks)
    assert.ok(!view.starting.has('/w/app'), 'npx failed and no Map came: the button must come back')
  })
})
