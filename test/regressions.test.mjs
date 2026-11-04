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
import { Poller } from '../herdr/agenttrail/mods/agenttrail/feed.js'
import { buildView } from '../herdr/agenttrail/mods/agenttrail/view.js'
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
    const blocker = net.createServer()
    await new Promise(r => blocker.listen(base, '127.0.0.1', r))
    const child = spawn(process.execPath, [BIN, world.repo, '--no-open'], { env: cleanEnv(world.home, { AGENTTRAIL_PORT_BASE: String(base) }), stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', c => out += c)
    await until(() => out.includes('localhost:'), 'the banner')
    await new Promise(r => setTimeout(r, 300))
    child.kill()
    blocker.close()
    assert.equal(out.match(/agenttrail ·/g).length, 1, out)
  })
  test('the page sets up a repo without waiting on the terminal', { skip: spawnSync('python3', ['-V']).status !== 0 }, async () => {
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
  test('saved state and its folder are private to this user', async () => {
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

