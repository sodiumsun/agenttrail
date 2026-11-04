import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { BIN, cleanEnv, freePortBase, startMap, stopAll, tempWorld, until } from './helpers.mjs'

const PLAN = '# demo\n\n## Build it {#build}\nfiles: [src/**]\n- [ ] First {#first}\n\n## decisions\n'

describe('Map request boundary', () => {
  let world, sibling, map, other
  const repoSetUp = dir => fs.existsSync(path.join(dir, '.claude', 'settings.local.json'))

  before(async () => {
    world = tempWorld(PLAN)
    sibling = path.join(world.root, 'sibling')
    fs.mkdirSync(sibling)
    const base = await freePortBase()
    other = await startMap({ repo: sibling, home: world.home, base, port: base + 1 })
    map = await startMap({ repo: world.repo, home: world.home, base })
    await until(async () => (await map.model()).boards.some(b => b.port === other.port), 'sibling discovery')
  })
  after(async () => { await stopAll(); world.cleanup() })

  test('a foreign Host is rejected on every route', async () => {
    for (const route of ['/', '/model', '/panel', '/whoami', '/events', '/board-lite']) {
      const r = await map.get(route, { host: 'evil.example' })
      assert.equal(r.status, 403, route)
      assert.ok(!r.body.includes(world.repo), route)
    }
    assert.equal((await map.get('/model', { host: `evil.example:${map.port}` })).status, 403)
    assert.equal((await map.get('/model', { host: `127.0.0.1:${map.port + 7}` })).status, 403)
  })

  test('a foreign Origin is rejected on reads, setup and hooks', async () => {
    const token = await map.token()
    for (const origin of ['http://evil.example', `https://127.0.0.1:${map.port}`, 'null', `http://localhost:${map.port + 7}`]) {
      assert.equal((await map.get('/model', { origin })).status, 403, origin)
      assert.equal((await map.get('/panel', { origin })).status, 403, origin)
      assert.equal((await map.post('/hook', { cwd: world.repo, session_id: 'foreign', hook_event_name: 'SessionStart' }, { origin })).status, 403, origin)
      assert.equal((await map.post('/setup', '{}', { origin, 'x-agenttrail-token': token })).status, 403, origin)
    }
    assert.ok(!(await map.model()).runs.some(r => r.id === 'foreign'))
    assert.ok(!repoSetUp(world.repo))
  })

  test('writes without the right token change nothing', async () => {
    for (const headers of [{}, { 'x-agenttrail-token': 'wrong' }]) {
      assert.equal((await map.post('/setup', '{}', headers)).status, 403)
      assert.equal((await map.post('/spawn', { path: world.root }, headers)).status, 403)
      assert.equal((await map.post('/setup-board', { port: other.port }, headers)).status, 403)
    }
    assert.ok(!repoSetUp(world.repo))
    assert.ok(!repoSetUp(sibling))
  })

  test('the page carries a token only for its own daemon', async () => {
    const page = await map.get('/')
    assert.equal(page.status, 200)
    assert.equal(page.headers['cache-control'], 'no-store')
    assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/)
    const [mine, theirs] = await Promise.all([map.token(), other.token()])
    assert.match(mine, /^[0-9a-f]{48}$/)
    assert.notEqual(mine, theirs)
    assert.equal((await map.post('/setup', '{}', { 'x-agenttrail-token': theirs })).status, 403)
    const file = path.join(world.home, '.agenttrail', 'tokens', `${map.port}.token`)
    assert.equal(fs.statSync(file).mode & 0o777, 0o600)
    assert.equal(fs.readFileSync(file, 'utf8'), mine)
  })

  test('proxy actions reach registered boards only', async () => {
    const token = await map.token()
    const stray = other.port + 3
    assert.equal((await map.get(`/tree-of?port=${stray}`)).status, 403)
    assert.equal((await map.post('/setup-board', { port: stray }, { 'x-agenttrail-token': token })).status, 403)
    assert.equal((await map.get(`/tree-of?port=${other.port}`)).status, 200)
  })

  test('sibling polling keeps working', async () => {
    const fleet = JSON.parse((await map.get('/fleet')).body)
    assert.deepEqual(fleet.map(b => b.port).sort(), [map.port, other.port].sort())
    const world_ = JSON.parse((await map.get('/world')).body)
    assert.ok(world_.some(b => b.port === other.port && b.project === 'sibling'))
    assert.equal((await other.get('/whoami')).status, 200)
  })

  test('the page can act through a sibling board', async () => {
    const token = await map.token()
    const origin = `http://localhost:${map.port}`
    const r = await map.post('/setup-board', { port: other.port }, { origin, 'x-agenttrail-token': token })
    assert.equal(r.status, 200)
    assert.equal(JSON.parse(r.body).ok, true)
    assert.ok(repoSetUp(sibling))
  })

  test('the page can set up its own repo and find an existing board', async () => {
    const token = await map.token()
    const origin = `http://127.0.0.1:${map.port}`
    const setup = await map.post('/setup', '{}', { origin, 'x-agenttrail-token': token })
    assert.equal(JSON.parse(setup.body).ok, true)
    assert.ok(repoSetUp(world.repo))
    const spawned = await map.post('/spawn', { path: sibling }, { origin, 'x-agenttrail-token': token })
    assert.deepEqual(JSON.parse(spawned.body), { ok: true, already: other.port })
  })

  test('an installed relay posts with no token or Origin', async () => {
    const event = { hook_event_name: 'SessionStart', session_id: 'relay', cwd: world.repo }
    const run = spawnSync(process.execPath, [BIN, 'hook'], {
      input: JSON.stringify(event),
      env: cleanEnv(world.home, { AGENTTRAIL_PORT: String(map.port) }),
    })
    assert.equal(run.status, 0)
    await until(async () => (await map.model()).runs.some(r => r.id === 'relay'), 'the relayed run')
  })

  test('the token file goes away with its daemon', async () => {
    const file = path.join(world.home, '.agenttrail', 'tokens', `${other.port}.token`)
    assert.ok(fs.existsSync(file))
    await other.stop()
    assert.ok(!fs.existsSync(file))
  })
})
