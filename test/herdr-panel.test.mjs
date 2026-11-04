// The Herdr mod's pure modules. They import nothing from Herdr, so they run here.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { MAX_DELAY_MS, POLL_MS, Poller, delayAfter, portsFrom, readBoard } from '../herdr/agenttrail/mods/agenttrail/feed.js'
import { linkRuns, repoOf } from '../herdr/agenttrail/mods/agenttrail/link.js'
import { SCENARIOS, sampleWorld } from '../herdr/agenttrail/mods/agenttrail/sample.js'
import { buildView, pathText } from '../herdr/agenttrail/mods/agenttrail/view.js'

const MOD = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'herdr', 'agenttrail', 'mods', 'agenttrail')
const NOW = 1_000_000_000
const REPO = '/work/shop'
const run = (id, extra = {}) => ({ id, agent: 'claude', provider: 'claude', status: 'active', terminalId: null, parentId: null, cwd: REPO, lastEventAt: NOW - 1000, task: null, tool: null, path: [], evidence: { task: 'unknown' }, ...extra })
const board = (runs, extra = {}) => ({ port: 5330, project: 'shop', repoPath: REPO, url: 'http://localhost:5330', hasPlan: true, sources: { hooks: true }, runs, ...extra })
const agent = (address, extra = {}) => ({ address, pane: `p-${address}`, status: 'working', tab_name: '1', title: 'x', space_name: 'shop', program: { key: 'claude', name: 'Claude Code' }, ...extra })
function world(boards, agents, cwd = REPO) {
  return { boards, agents, now: NOW, terminals: agents.map(a => ({ address: a.address, state: 'live' })), panes: agents.map(a => ({ pane: a.pane, cwd: a.cwd ?? cwd })) }
}
const linkOf = (w, id) => linkRuns(w).links.get(`5330:${id}`)

describe('linking runs to terminals', () => {
  test('a terminal id links exactly, even with other agents in the repo', () => {
    const w = world([board([run('a', { terminalId: 't2' })])], [agent('t1'), agent('t2')])
    assert.equal(linkOf(w, 'a').address, 't2')
    assert.equal(linkOf(w, 'a').how, 'terminal')
  })
  test('a terminal id that is gone never falls back to the repo', () => {
    const w = world([board([run('a', { terminalId: 't9' })])], [agent('t1')])
    assert.deepEqual(linkOf(w, 'a'), { address: null, why: 'closed' })
  })
  test('a live terminal with no agent status still links, for pane.focus', () => {
    const w = { ...world([board([run('a', { terminalId: 't5' })])], []), terminals: [{ address: 't5', state: 'live' }] }
    assert.deepEqual(linkOf(w, 'a'), { address: 't5', agent: null, how: 'terminal' })
  })
  test('with no id, one agent and one run in the repo link', () => {
    const w = world([board([run('a')])], [agent('t1')])
    assert.equal(linkOf(w, 'a').address, 't1')
    assert.equal(linkOf(w, 'a').how, 'repo')
  })
  test('with no id and two agents, the row stays unlinked', () => {
    const w = world([board([run('a')])], [agent('t1'), agent('t2')])
    assert.deepEqual(linkOf(w, 'a'), { address: null, why: 'ambiguous' })
  })
  test('two runs for one agent stay unlinked, both of them', () => {
    const w = world([board([run('a'), run('b')])], [agent('t1')])
    assert.equal(linkOf(w, 'a').why, 'ambiguous')
    assert.equal(linkOf(w, 'b').why, 'ambiguous')
  })
  test('an agent already claimed by id is not offered to a run without one', () => {
    const w = world([board([run('a', { terminalId: 't1' }), run('b')])], [agent('t1'), agent('t2')])
    assert.equal(linkOf(w, 'b').address, 't2')
  })
  test('a different program is not a match; an unknown one might be', () => {
    const codex = { key: 'codex', name: 'Codex' }
    assert.equal(linkOf(world([board([run('a')])], [agent('t1', { program: codex })]), 'a').why, 'none')
    assert.equal(linkOf(world([board([run('a')])], [agent('t1'), agent('t2', { program: codex })]), 'a').address, 't1')
    assert.equal(linkOf(world([board([run('a')])], [agent('t1'), agent('t2', { program: { key: 'program' } })]), 'a').why, 'ambiguous')
  })
  test('a finished or stale run never takes a live agent by repo', () => {
    for (const r of [run('a', { status: 'ended' }), run('a', { status: 'unknown' }), run('a', { status: 'idle', lastEventAt: NOW - 31 * 60e3 })]) {
      assert.deepEqual(linkOf(world([board([r])], [agent('t1')]), 'a'), { address: null, why: 'none' })
    }
  })
  test('an agent on another machine is never linked, even at the same path', () => {
    const w = world([board([run('a'), run('b', { terminalId: 'vps/t7' })])], [agent('vps/t7')])
    assert.equal(linkOf(w, 'a').why, 'none')
    assert.equal(linkOf(w, 'b').why, 'closed')
  })
  test('the newest session owns a terminal', () => {
    const w = world([board([run('old', { terminalId: 't1', lastEventAt: NOW - 9000 }), run('new', { terminalId: 't1' })])], [agent('t1')])
    assert.equal(linkOf(w, 'new').address, 't1')
    assert.equal(linkOf(w, 'old').why, 'replaced')
  })
  test('a folder belongs to the deepest watched repo, on a path boundary', () => {
    assert.equal(repoOf('/work/shop/api/src', ['/work/shop', '/work/shop/api']), '/work/shop/api')
    assert.equal(repoOf('/work/shop-2', ['/work/shop']), null)
    assert.equal(repoOf('/work/shop/', ['/work/shop']), '/work/shop')
    assert.equal(repoOf(null, ['/work/shop']), null)
  })
  test('a home-folder agent is not inside a repo below it', () => {
    assert.equal(linkOf(world([board([run('a')])], [agent('t1', { cwd: '/work' })]), 'a').why, 'none')
  })
})

describe('building the rows', () => {
  const rows = v => v.groups[0].rows
  test('a linked row takes its status from Herdr, an unlinked one from Map', () => {
    const v = buildView(world([board([run('a', { terminalId: 't1' }), run('b', { terminalId: 't9', status: 'idle' })])], [agent('t1', { status: 'blocked' })]))
    assert.equal(rows(v)[0].status, 'blocked')
    assert.equal(rows(v)[0].statusFrom, 'herdr')
    assert.equal(rows(v)[1].status, 'idle')
    assert.equal(rows(v)[1].statusFrom, 'map')
    assert.equal(rows(v)[1].unlinked, 'Terminal closed')
  })
  test('Map can never claim blocked or done', () => {
    for (const status of ['active', 'idle', 'ended', 'interrupted', 'unknown']) {
      const v = buildView(world([board([run('a', { status })])], []))
      assert.ok(!['blocked', 'done'].includes(rows(v)[0].status), status)
    }
  })
  test('rows that need you come first', () => {
    const v = buildView(world([board(['a', 'b', 'c', 'd'].map((id, i) => run(id, { terminalId: `t${i}` })))], [agent('t0', { status: 'idle' }), agent('t1', { status: 'working' }), agent('t2', { status: 'blocked' }), agent('t3', { status: 'done' })]))
    assert.deepEqual(rows(v).map(r => r.status), ['blocked', 'done', 'working', 'idle'])
  })
  test('each line carries its label, and unknown stays unknown', () => {
    const line = r => rows(buildView(world([board([r])], []))).at(0).line
    assert.deepEqual(line(run('a', { task: { text: 'Fix it' }, tool: { name: 'Edit' } })), { text: 'Fix it', label: 'reported' })
    assert.deepEqual(line(run('a', { tool: { name: 'Edit', detail: 'a.js' } })), { text: 'Edit a.js', label: 'observed' })
    assert.deepEqual(line(run('a', { evidence: { task: 'reported' } })), { text: 'No open tasks', label: 'reported' })
    assert.deepEqual(line(run('a')), { text: 'No task reported', label: null })
  })
  test('an ambiguous agent is not listed twice', () => {
    const v = buildView(world([board([run('a')])], [agent('t1'), agent('t2')]))
    assert.equal(rows(v).length, 1)
    assert.equal(rows(v)[0].unlinked, "Can't tell which terminal")
    assert.equal(rows(v)[0].address, null)
  })
  test('an agent in a watched repo with no run yet still shows, clickable', () => {
    const v = buildView(world([board([])], [agent('t1')]))
    assert.equal(rows(v)[0].address, 't1')
    assert.equal(rows(v)[0].line.text, 'Nothing seen from this agent yet')
    assert.equal(v.groups[0].note, null)
  })
  test('old unlinked runs fold into a count; sub-agents never get a row', () => {
    const v = buildView(world([board([run('old', { status: 'ended', lastEventAt: NOW - 40 * 60e3 }), run('kid', { parentId: 'x' }), run('now')])], []))
    assert.deepEqual(rows(v).map(r => r.key), ['5330:now'])
    assert.equal(v.groups[0].older, 1)
  })
  test('the notes say what is missing without inventing anything', () => {
    assert.match(buildView(world([board([run('a')], { hasPlan: false })], [])).groups[0].note, /No PLAN\.md/)
    assert.equal(rows(buildView(world([board([run('a')], { hasPlan: false })], [])))[0].pathEmpty, 'No path without a plan')
    assert.match(buildView(world([board([], { sources: {} })], [])).groups[0].note, /No hooks or agent logs/)
    assert.match(buildView(world([board([], { sources: { claudeLogs: true } })], [])).groups[0].note, /No agent sessions/)
    assert.match(buildView(world([board([], { tooOld: true })], [])).groups[0].note, /too old/)
    assert.match(buildView(world([board([], { tooNew: true })], [])).groups[0].note, /newer than the panel/)
  })
  test('off: agents outside a watched repo are offered by folder', () => {
    const v = buildView(world([], [agent('t1'), agent('t2'), agent('t3', { cwd: '/work/api' })]))
    assert.equal(v.off, true)
    assert.deepEqual(v.unwatched, [{ folder: REPO, count: 2 }, { folder: '/work/api', count: 1 }])
    assert.deepEqual(buildView({ ...world([], []), fallbackFolder: '/here' }).unwatched, [{ folder: '/here', count: 0 }])
  })
  test('agents on other machines are counted, not shown', () => {
    const v = buildView(world([board([])], [agent('vps/t1'), agent('vps/t2')]))
    assert.equal(v.remote, 2)
    assert.equal(rows(v).length, 0)
    assert.deepEqual(v.unwatched, [])
  })
  test('the path keeps its end', () => {
    assert.equal(pathText(['Watch repo', 'Hooks', 'Panel']), 'Watch repo → Hooks → Panel')
    assert.equal(pathText(['Watch repo', 'Hooks', 'Panel'], { keep: 2 }), '… → Hooks → Panel')
    assert.equal(pathText(['Watch repo', 'Hooks', 'Panel'], { max: 12 }), '… → Panel')
    assert.equal(pathText(['A long component title'], { max: 3 }), 'A long component title')
  })
})

describe('finding Maps', () => {
  const res = (status, body) => ({ status, ok: status < 400, json: async () => body })
  const feed = (port, extra = {}) => ({ app: 'agenttrail', schema: 1, project: `p${port}`, repoPath: `/r${port}`, url: `http://localhost:${port}`, now: 1, runs: [], ...extra })
  function host(answers) {
    const calls = []
    let clock = 0
    return {
      calls,
      advance: ms => { clock += ms },
      fetch: async url => {
        calls.push(url)
        const m = url.match(/:(\d+)(\/\w+)$/)
        const a = answers[m[1]]?.[m[2]]
        if (a === undefined) throw new Error('refused')
        return a
      },
      sleep: () => new Promise(() => {}),
      now: () => clock,
    }
  }
  const poller = (h, extra) => new Poller({ fetch: h.fetch, sleep: h.sleep, now: h.now, base: 5330, ...extra })

  test('the range is 5330 to 5344', () => {
    const ports = portsFrom(5330)
    assert.equal(ports.length, 15)
    assert.equal(ports.at(-1), 5344)
  })
  test('backoff doubles and stops at the cap', () => {
    assert.deepEqual([0, 1, 2, 3, 4, 9].map(delayAfter), [3000, 6000, 12000, 24000, 30000, 30000])
    assert.equal(delayAfter(0), POLL_MS)
    assert.equal(delayAfter(20), MAX_DELAY_MS)
  })
  test('every Map in the range is found, and strangers are ignored', async () => {
    const h = host({ 5331: { '/panel': res(200, feed(5331)) }, 5340: { '/panel': res(200, feed(5340)) }, 5333: { '/panel': res(200, { hello: 1 }) }, 5334: { '/panel': res(500, null) } })
    const p = poller(h)
    await p.round()
    assert.deepEqual(p.list().map(b => b.port), [5331, 5340])
  })
  test('a Map without the feed is reported as too old', async () => {
    const b = await readBoard(host({ 5330: { '/panel': res(404, null), '/whoami': res(200, { project: 'x', port: 5330, repoPath: '/x' }) } }).fetch, 5330)
    assert.equal(b.tooOld, true)
    assert.equal(b.url, 'http://localhost:5330')
    assert.equal(await readBoard(host({ 5330: { '/panel': res(404, null), '/whoami': res(404, null) } }).fetch, 5330), null)
  })
  test('a newer schema is not parsed as this one', async () => {
    const b = await readBoard(host({ 5330: { '/panel': res(200, feed(5330, { schema: 2, runs: [{ id: 'x' }] })) } }).fetch, 5330)
    assert.equal(b.tooNew, true)
    assert.deepEqual(b.runs, [])
  })
  test('nothing up: rounds back off, and wake looks again at once', async () => {
    const h = host({})
    const p = poller(h)
    await p.tick()
    assert.equal(p.next, 3000)
    h.advance(3000); await p.tick()
    assert.equal(p.next, 3000 + 6000)
    h.advance(1000); await p.tick()
    assert.equal(h.calls.length, 30)
    p.wake()
    await p.tick()
    assert.equal(h.calls.length, 45)
  })
  test('a board up: only its port is polled between scans', async () => {
    const h = host({ 5330: { '/panel': res(200, feed(5330)) } })
    const p = poller(h)
    await p.round()
    h.calls.length = 0
    await p.round()
    assert.equal(h.calls.length, 1)
    for (let i = 0; i < 3; i++) await p.round()
    h.calls.length = 0
    await p.round()
    assert.equal(h.calls.length, 15)
  })
  test('one miss keeps a board, two drop it', async () => {
    const answers = { 5330: { '/panel': res(200, feed(5330)) } }
    const p = poller(host(answers))
    await p.round()
    delete answers[5330]
    await p.round()
    assert.equal(p.list().length, 1)
    await p.round()
    assert.equal(p.list().length, 0)
  })
  test('a redraw happens only when something changed, not for the clock', async () => {
    let redraws = 0, n = 1
    const answers = { 5330: { get '/panel'() { return res(200, feed(5330, { now: n++ })) } } }
    const p = poller(host(answers), { changed: () => { redraws++ } })
    await p.round(); await p.round(); await p.round()
    assert.equal(redraws, 1)
    answers[5330] = { '/panel': res(200, feed(5330, { runs: [{ id: 'x' }] })) }
    await p.round()
    assert.equal(redraws, 2)
  })
  test('a Map on a slow scan is not lost: both hops fit the budget', async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms))
    const slow = async url => {
      await wait(20) // a queued fetch, at 1/50 of real time, as sleep below
      return url.endsWith('/panel') ? res(404, null) : res(200, { project: 'old', repoPath: '/old' })
    }
    const p = new Poller({ fetch: slow, sleep: ms => wait(ms / 50), now: () => 0, base: 5330 })
    await p.round()
    assert.equal(p.list().length, 15)
    assert.ok(p.list()[0].tooOld)
  })
  test('a port that never answers does not stall the round', async () => {
    const h = host({})
    const p = new Poller({ fetch: () => new Promise(() => {}), sleep: () => Promise.resolve(), now: h.now, base: 5330 })
    await p.round()
    assert.equal(p.list().length, 0)
  })
})

describe('sample data', () => {
  test('every scenario builds, and none has a real link target to open', () => {
    for (const name of Object.keys(SCENARIOS)) {
      const v = buildView(sampleWorld(name))
      for (const g of v.groups) assert.equal(g.url, null, name)
    }
  })
  test('each state in the review page has a scenario that shows it', () => {
    const v = name => buildView(sampleWorld(name))
    const statuses = name => v(name).groups.flatMap(g => g.rows).map(r => r.status)
    assert.equal(v('off').off, true)
    assert.equal(v('off').unwatched.length, 2)
    assert.match(v('old').groups[0].note, /too old/)
    assert.match(v('noplan').groups[0].note, /No PLAN/)
    assert.match(v('nohooks').groups[0].note, /No hooks/)
    for (const s of ['working', 'blocked', 'done', 'idle']) assert.deepEqual(statuses(s), [s])
    assert.deepEqual(v('nolink').groups[0].rows.map(r => r.unlinked), ['No terminal link', 'Terminal closed'])
    assert.equal(v('shared').groups[0].rows.filter(r => r.unlinked === "Can't tell which terminal").length, 2)
    assert.equal(v('shared').groups[0].rows.filter(r => r.address).length, 2)
    assert.equal(v('remote').remote, 2)
  })
})

describe('the mod stays read-only', () => {
  const files = fs.readdirSync(MOD).filter(f => f.endsWith('.js'))
  const source = Object.fromEntries(files.map(f => [f, fs.readFileSync(path.join(MOD, f), 'utf8')]))
  test('it runs only these commands and programs', () => {
    const all = Object.values(source).join('\n')
    assert.deepEqual([...new Set([...source['main.js'].matchAll(/\brun\("([\w.]+)"/g)].map(m => m[1]))].sort(), ['agent.focus', 'pane.focus', 'terminal.open'])
    assert.deepEqual([...new Set([...all.matchAll(/\bexec\("?([\w-]+)/g)].map(m => m[1]))].sort(), ['git', 'program'])
    assert.ok(!/\b(writeTextFile|setShared|hc\(|method:)/.test(all))
  })
  test('pure modules import nothing from Herdr', () => {
    for (const f of ['link.js', 'view.js', 'feed.js', 'sample.js']) assert.ok(!/from "(herdr|gpui)/.test(source[f]), f)
  })
  test('no timer redraws', () => {
    assert.ok(!/setTimeout|setInterval|timer\.every/.test(Object.values(source).join('\n')))
  })
})
