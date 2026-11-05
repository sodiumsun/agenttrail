// The Map mod. Its layout is a port of the page's, so these run the page's
// own functions next to the port, on this repo's real plan read through a real Map.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { Feed, SCAN_MS, focusFolder, pickMap } from '../herdr/agenttrail/mods/agenttrail/feed.js'
import { boardEdges, boardLayout, cardAgents, dockedIn, hostOf, liveCard } from '../herdr/agenttrail/mods/agenttrail/graph.js'
import { freePortBase, startMap, stopAll, tempWorld } from './helpers.mjs'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const page = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8')
const fn = (name) => {
  const start = page.indexOf(`function ${name}(`)
  assert.ok(start >= 0, `${name} is gone from the page`)
  const next = page.slice(start + 1).search(/\nfunction |\nlet |\nconst /)
  return page.slice(start, start + 1 + next)
}
const NOW = 1_000_000

// The page's graph code, in a scope holding only the state it reads.
function pageGraph(M, open = [], closed = []) {
  const source = ['compLive', 'isUnfolded', 'kids', 'graphTaskIsOpen', 'graphTaskDetails', 'graphDetailHeight', 'graphNodeMetrics', 'boardLayout', 'graphEdge', 'graphLinkEdge'].map(fn).join('\n')
  const make = new Function('M', 'openGraphDetails', 'closedGraphDetails', 'Date', `
    const openGraphTasks = new Set(), closedGraphTasks = new Set(), fileMode = false, ns = id => id, ago = () => ''
    const agentColor = () => '', esc = s => s
    ${source}
    return { boardLayout, graphEdge, graphLinkEdge }`)
  return make(M, new Set(open), new Set(closed), { now: () => NOW })
}
const ui = (open = [], closed = []) => ({ open: new Set(open), closed: new Set(closed), openTasks: new Set(), closedTasks: new Set() })
const live = (plan) => plan.map((n) => (n.id === 'map' ? { ...n, touchedAt: NOW - 5000, recent: [{ file: 'public/index.html', n: 3, at: NOW - 5000 }] } : n))
const curve = (c) => `M${c.x1} ${c.y1}C${c.ax} ${c.ay} ${c.bx} ${c.by} ${c.x2} ${c.y2}`

describe('the Map mod', () => {
  let world, map, board
  before(async () => {
    world = tempWorld(fs.readFileSync(path.join(ROOT, 'PLAN.md'), 'utf8'))
    map = await startMap({ repo: world.repo, home: world.home, base: await freePortBase() })
    board = JSON.parse((await map.get('/board-lite')).body)
  })
  after(async () => { await stopAll(); world.cleanup() })

  test('Map already serves everything a card and a connector need', () => {
    const comps = board.plan.filter(n => n.level === 'component')
    assert.ok(comps.length >= 5)
    for (const c of comps) for (const key of ['id', 'title', 'status', 'needs', 'links', 'tech', 'touchedAt', 'recent']) assert.ok(key in c, key)
    for (const key of ['runs', 'handoffs', 'activity', 'project']) assert.ok(key in board, key)
  })

  test('cards land where the page puts them, folded, opened and live', () => {
    const comps = board.plan.filter(n => n.level === 'component').map(n => n.id)
    for (const [plan, open, closed] of [[board.plan, [], []], [board.plan, comps, []], [board.plan, [comps[1]], []], [live(board.plan), [], []], [live(board.plan), [], ['map']]]) {
      const b = { ...board, plan, runs: [] }
      const theirs = pageGraph(b, open, closed).boardLayout(b)
      const ours = boardLayout(b, ui(open, closed), NOW)
      assert.deepEqual(ours.pos, theirs.pos)
      assert.equal(ours.width, theirs.width)
      assert.equal(ours.height, theirs.height)
    }
  })

  test('connectors follow the same curves as the page', () => {
    const b = { ...board, runs: [] }
    const g = pageGraph(b)
    const L = g.boardLayout(b)
    const { edges } = boardEdges(b, boardLayout(b, ui(), NOW), NOW)
    const needs = edges.filter(e => e.arrow)
    const links = edges.filter(e => !e.arrow)
    const pathOf = (html) => html.match(/ d="([^"]+)"/)[1]
    const theirNeeds = L.phases.flatMap(p => p.needs.filter(n => L.byId[n]).map(n => pathOf(g.graphEdge(L.byId[n], p, L.pos))))
    assert.deepEqual(needs.map(e => curve(e.curve)), theirNeeds)
    assert.ok(links.length > 0)
    const seen = new Set(), theirLinks = []
    for (const p of L.phases) for (const l of p.links || []) {
      const key = [p.id, l].sort().join('|')
      if (!L.byId[l] || seen.has(key)) continue
      seen.add(key)
      theirLinks.push(pathOf(g.graphLinkEdge(L.byId[l], p, L.pos)))
    }
    assert.deepEqual(links.map(e => curve(e.curve)), theirLinks)
  })

  test('a card shows the agents its tasks name and the live runs pinned to it', () => {
    const plan = [{ id: 'c', level: 'component' }, { id: 't', parent: 'c', status: 'active', by: 'codex' }]
    const runs = [{ agent: 'claude', componentId: 'c', ended: false }, { agent: 'gone', componentId: 'c', ended: true }]
    assert.deepEqual(cardAgents({ plan, runs }, plan[0]), ['codex', 'claude'])
  })

  test('the feed finds the Map for this folder and reports only real changes', async () => {
    const feed = new Feed({ fetch: u => fetch(u), sleep: () => new Promise(() => {}), base: map.port, root: async () => world.repo, folder: () => path.join(world.repo, 'src') })
    assert.equal(await feed.tick(), true)
    assert.equal(feed.board.project, board.project)
    assert.equal(feed.state.kind, 'map')
    assert.equal(feed.port, map.port)
    assert.equal(await feed.tick(), false)
  })

  test('a real Map on a repo with no plan is shown, not waited on', async () => {
    const bare = tempWorld('')
    const m = await startMap({ repo: bare.repo, home: bare.home, base: await freePortBase() })
    const feed = new Feed({ fetch: u => fetch(u), sleep: () => new Promise(() => {}), base: m.port, root: async () => bare.repo, folder: () => bare.repo })
    assert.equal(await feed.tick(), true)
    assert.equal(feed.state.kind, 'map')
    assert.deepEqual(feed.board.plan, [])
    assert.equal(feed.board.hasPlan, false)
    assert.ok('recentActivity' in feed.board && 'runs' in feed.board)
    await m.stop()
    bare.cleanup()
  })

  test('a narrow view opens where a live run is pinned, then the freshest edit, then the plan, else nothing', () => {
    const c = (id, extra = {}) => ({ id, level: 'component', ...extra })
    const old = NOW - 3600e3
    const plan = [c('a', { status: 'active' }), c('b', { touchedAt: NOW - 9000 }), c('c', { touchedAt: NOW - 2000 }), c('d', { touchedAt: old })]
    assert.equal(liveCard({ plan, runs: [{ componentId: 'a' }] }, NOW), 'a')
    assert.equal(liveCard({ plan, runs: [{ componentId: 'a' }, { componentId: 'b' }] }, NOW), 'b')
    assert.equal(liveCard({ plan, runs: [{ componentId: 'gone' }, { componentId: 'a', ended: true }] }, NOW), 'c')
    assert.equal(liveCard({ plan: [plan[0], c('b'), plan[3]], runs: [] }, NOW), 'a')
    assert.equal(liveCard({ plan: [c('b'), plan[3]] }, NOW), null)
  })

  describe('which Map a copy shows', () => {
    const BASE = 7000
    const A = { port: BASE, project: 'alpha', repoPath: '/w/alpha' }
    const B = { port: BASE + 1, project: 'beta', repoPath: '/w/beta' }
    const never = () => new Promise(() => {})
    // A pretend machine: the Maps up now, and what each serves.
    function machine(maps, { plan = [{ id: 'c', level: 'component' }] } = {}) {
      const world = { maps, down: new Set(), hang: new Set(), asked: [] }
      world.fetch = async (url) => {
        const { port, pathname } = new URL(url)
        world.asked.push(url)
        const m = world.maps.find(x => x.port === Number(port))
        if (world.hang.has(Number(port))) return never()
        if (!m || world.down.has(m.port)) throw new Error('refused')
        const body = pathname === '/panel' ? { app: 'agenttrail', ...m } : { project: m.project, plan, runs: [], now: Date.now() }
        return { ok: true, json: async () => body }
      }
      return world
    }
    const roots = { '/w/alpha': '/w/alpha', '/w/alpha/src': '/w/alpha', '/w/beta': '/w/beta', '/w/gamma': '/w/gamma', '/w/alpha/inner': '/w/alpha/inner' }
    const feedOn = (world, at, over = {}) => new Feed({ fetch: world.fetch, sleep: never, base: BASE, root: async f => roots[f] ?? null, folder: () => at.folder, ...over })

    test('a /panel reply cannot steer the next fetch: the scanned port is kept', async () => {
      const world = machine([A])
      const fetch = world.fetch
      world.fetch = async (url) => {
        const res = await fetch(url)
        if (!url.endsWith('/panel')) return res
        const body = await res.json()
        return { ok: true, json: async () => ({ ...body, port: '8080/elsewhere#' }) }
      }
      const feed = feedOn(world, { folder: '/w/alpha' })
      await feed.tick()
      assert.equal(feed.port, A.port)
      assert.ok(world.asked.every(u => /^http:\/\/127\.0\.0\.1:\d+\/(panel|board-lite)$/.test(u)), world.asked.join(' '))
    })

    test('a board without a plan list is not shown, and bad ports are never fetched', async () => {
      for (const plan of [null, 'x', [null]]) {
        const feed = feedOn(machine([A], { plan }), { folder: '/w/alpha' })
        await feed.tick()
        assert.equal(feed.board, null, JSON.stringify(plan))
      }
      const world = machine([A])
      for (const port of ['7000', 7000.5, 0, 70000, '8080/x#']) {
        const feed = feedOn(world, { folder: '/w/alpha' }, { port })
        assert.equal(await feed.get(port, '/board-lite'), null)
      }
      assert.deepEqual(world.asked, [])
    })

    test('with no Map for this repo it shows nothing, and names the others', async () => {
      const feed = feedOn(machine([B]), { folder: '/w/alpha' })
      assert.equal(await feed.tick(), true)
      assert.equal(feed.board, null)
      assert.equal(feed.port, null)
      assert.equal(feed.state.kind, 'off')
      assert.equal(feed.state.repo, '/w/alpha')
      assert.deepEqual(feed.state.others, [B])
    })

    test('focus moving to another repo re-picks, keeping the last board until the next is ready', async () => {
      const at = { folder: '/w/alpha/src' }
      const world = machine([A, B])
      const feed = feedOn(world, at)
      await feed.tick()
      assert.equal(feed.board.project, 'alpha')
      assert.equal(feed.state.repo, '/w/alpha')
      at.folder = '/w/beta'
      const before = world.fetch
      let during
      world.fetch = undefined
      feed.fetch = async (url) => { during ??= feed.board?.project; return before(url) }
      assert.equal(await feed.tick(), true)
      assert.equal(during, 'alpha')
      assert.equal(feed.board.project, 'beta')
      assert.equal(feed.port, B.port)
      assert.equal(await feed.tick(), false)
    })

    test('focus moving during a slow read is followed before the tick ends', async () => {
      const at = { folder: '/w/alpha' }
      const world = machine([A, B])
      const feed = feedOn(world, at, { fetch: async (url) => { if (url.endsWith('/board-lite')) at.folder = '/w/beta'; return world.fetch(url) } })
      await feed.tick()
      assert.equal(feed.board.project, 'beta')
    })

    test('a known Map switches without a new scan; a Map started since is found by one', async () => {
      const at = { folder: '/w/alpha' }
      const world = machine([A, B])
      const feed = feedOn(world, at)
      await feed.tick()
      at.folder = '/w/beta'
      world.asked.length = 0
      await feed.tick()
      assert.deepEqual(world.asked, [`http://127.0.0.1:${B.port}/board-lite`])
      const C = { port: BASE + 2, project: 'gamma', repoPath: '/w/gamma' }
      world.maps = [A, B, C]
      at.folder = '/w/gamma'
      await feed.tick()
      assert.equal(feed.board.project, 'gamma')
    })

    test('while off it scans now and then, and every tick when a start is under way', async () => {
      let clock = 0, eager = false
      const world = machine([])
      const feed = feedOn(world, { folder: '/w/alpha' }, { now: () => clock, eager: () => eager })
      await feed.tick()
      world.asked.length = 0
      clock = SCAN_MS - 1
      await feed.tick()
      assert.equal(world.asked.length, 0)
      eager = true
      world.maps = [A]
      await feed.tick()
      assert.equal(feed.state.kind, 'map')
    })

    test('one missed answer keeps the board; a stopped Map turns into off', async () => {
      const world = machine([A])
      const feed = feedOn(world, { folder: '/w/alpha' })
      await feed.tick()
      world.down.add(A.port)
      assert.equal(await feed.tick(), false)
      assert.equal(feed.board.project, 'alpha')
      assert.equal(await feed.tick(), true)
      assert.equal(feed.state.kind, 'off')
      assert.equal(feed.board, null)
    })

    test('a folder outside any repo says so, with or without other Maps', async () => {
      const feed = feedOn(machine([A]), { folder: '/w/loose' })
      await feed.tick()
      assert.equal(feed.state.kind, 'plain')
      assert.equal(feed.state.repo, '/w/loose')
      assert.deepEqual(feed.state.others, [A])
    })

    test('no terminal yet is its own state, not a Map picked at random', async () => {
      const feed = feedOn(machine([A]), { folder: null })
      await feed.tick()
      assert.equal(feed.state.kind, 'none')
      assert.equal(feed.board, null)
    })

    test('a port that never answers cannot stop a scan from resolving', async () => {
      const world = machine([A, B])
      world.hang.add(B.port)
      const feed = feedOn(world, { folder: '/w/alpha' }, { sleep: async () => {} })
      await feed.tick()
      assert.notEqual(feed.state.kind, 'scanning')
      const none = machine([])
      none.hang.add(BASE)
      const off = feedOn(none, { folder: '/w/alpha' }, { sleep: async () => {} })
      await off.tick()
      assert.equal(off.state.kind, 'off')
    })

    test('props.port stays a pin whatever has focus, and says when it stops answering', async () => {
      const at = { folder: '/w/alpha' }
      const world = machine([A, B])
      const feed = feedOn(world, at, { port: B.port })
      await feed.tick()
      assert.equal(feed.board.project, 'beta')
      at.folder = '/w/gamma'
      assert.equal(await feed.tick(), false)
      assert.equal(feed.board.project, 'beta')
      world.down.add(B.port)
      await feed.tick()
      await feed.tick()
      assert.equal(feed.state.kind, 'gone')
      assert.equal(feed.state.port, B.port)
      assert.ok(!world.asked.some(u => u.endsWith('/panel')))
    })

    test('a Map picked by hand lasts until focus changes repo, and says so', async () => {
      const at = { folder: '/w/gamma' }
      const feed = feedOn(machine([A, B]), at)
      await feed.tick()
      assert.equal(feed.state.kind, 'off')
      feed.choose(B.port)
      await feed.tick()
      assert.equal(feed.board.project, 'beta')
      assert.equal(feed.state.away, '/w/gamma')
      feed.back()
      await feed.tick()
      assert.equal(feed.state.kind, 'off')
      feed.choose(B.port)
      await feed.tick()
      at.folder = '/w/alpha'
      await feed.tick()
      assert.equal(feed.board.project, 'alpha')
      assert.equal(feed.state.away, null)
    })

    test('the repo a folder belongs to decides, not which Map contains it', () => {
      const parent = { port: 1, repoPath: '/w' }, sub = { port: 2, repoPath: '/w/alpha/pkg' }
      assert.equal(pickMap([parent], '/w/alpha/src', '/w/alpha'), null)
      assert.equal(pickMap([A, parent], '/w/alpha/src', '/w/alpha'), A)
      assert.equal(pickMap([A, sub], '/w/alpha/pkg/x', '/w/alpha'), sub)
      assert.equal(pickMap([A, sub], '/w/alpha/src', '/w/alpha'), A)
      assert.equal(pickMap([A], '/w/alpha/inner', '/w/alpha/inner'), null)
      assert.equal(pickMap([{ port: 3, repoPath: '/w/alphabet' }], '/w/alpha', '/w/alpha'), null)
      assert.equal(pickMap([parent], '/w/loose', null), parent)
      assert.equal(pickMap([A], null, null), null)
      assert.equal(pickMap([A], '/link/to/alpha/src', '/w/alpha'), A)
    })

    test('focus on anything but a local terminal keeps the last folder', () => {
      const spaces = [{ id: 's' }, { id: 'r', machine: 'vps' }]
      assert.equal(focusFolder({ space: 's', terminal: 't1', cwd: '/w/alpha/' }, spaces, '/w/beta'), '/w/alpha')
      assert.equal(focusFolder({ space: 's', terminal: null, pane: 'p', cwd: null }, spaces, '/w/beta'), '/w/beta')
      assert.equal(focusFolder({ space: 'r', terminal: 't2', cwd: '/srv/app' }, spaces, '/w/beta'), '/w/beta')
      assert.equal(focusFolder(null, spaces, null), null)
    })
  })

  describe('where a copy lives', () => {
    const mod = 'agenttrail'
    const dock = { type: 'row', children: [{ content: { tab: 'active' } }, { id: 'dock', content: { mod } }] }
    const map = (pane, tab, zoomed = false) => ({ pane, tab, mod, zoomed })
    const shell = (pane, tab) => ({ pane, tab, terminal: 't1' })
    const host = (over) => hostOf({ layout: { type: 'row', children: [] }, props: {}, panes: [], tab: 'T', focusedPane: null, mod, ...over })

    test('a block is found by its props, at any depth, and not when hidden', () => {
      assert.ok(dockedIn(dock, mod, {}))
      assert.ok(dockedIn(dock, mod, null))
      assert.ok(!dockedIn(dock, mod, { expanded: true }))
      assert.ok(dockedIn({ children: [{ children: [{ floating: [{ content: { mod, props: { a: 1 } } }] }] }] }, mod, { a: 1 }))
      assert.ok(!dockedIn({ children: [{ hidden: true, children: dock.children }] }, mod, {}))
    })

    test('docked: expand must not zoom, even with a terminal focused or a Map pane beside it', () => {
      assert.deepEqual(host({ layout: dock, panes: [shell('p1', 'T')], focusedPane: 'p1' }), { kind: 'block' })
      assert.deepEqual(host({ layout: dock, panes: [shell('p1', 'T'), map('p2', 'T')] }), { kind: 'block' })
    })

    test('a pane beside others zooms itself, and knows it is zoomed', () => {
      assert.deepEqual(host({ panes: [shell('p1', 'T'), map('p2', 'T', true)] }), { kind: 'pane', pane: 'p2', zoomed: true })
      assert.equal(host({ panes: [shell('p1', 'T'), map('p2', 'T'), map('p3', 'T')], focusedPane: 'p3' }).pane, 'p3')
      assert.equal(host({ layout: dock, props: { other: 1 }, panes: [shell('p1', 'T'), map('p2', 'T')] }).kind, 'pane')
    })

    test('an expanded tab closes only while Map is alone in it, so collapse cannot end a terminal', () => {
      assert.equal(host({ layout: dock, props: { expanded: true }, panes: [map('p2', 'T')] }).kind, 'tab')
      assert.equal(host({ layout: dock, props: { expanded: true }, panes: [map('p2', 'T'), shell('p1', 'T')] }).kind, 'pane')
      assert.equal(host({ panes: [map('p2', 'T')] }).kind, 'lone')
    })

    test('a Map pane in another tab is not this copy', () => {
      assert.deepEqual(host({ panes: [map('p2', 'other')] }), { kind: 'block' })
    })
  })

  test('the listing folder holds the mod, its recipe and preview, and no layout', () => {
    const dir = path.join(ROOT, 'herdr', 'agenttrail')
    assert.deepEqual(fs.readdirSync(dir).sort(), ['RECIPE.md', 'mods', 'preview.png'])
    assert.deepEqual(fs.readdirSync(path.join(dir, 'mods')), ['agenttrail'])
    const text = fs.readFileSync(path.join(dir, 'mods', 'agenttrail', 'main.js'), 'utf8')
    assert.match(text, /^const MOD = "agenttrail";$/m)
    for (const [, art] of text.matchAll(/\$\{ASSET\}\/([\w-]+\.svg)/g)) assert.ok(fs.existsSync(path.join(dir, 'mods', 'agenttrail', art)), art)
  })

  test('the pure modules import nothing from Herdr', () => {
    const dir = path.join(ROOT, 'herdr', 'agenttrail', 'mods', 'agenttrail')
    for (const file of ['feed.js', 'graph.js']) assert.ok(!/from "(herdr|gpui)/.test(fs.readFileSync(path.join(dir, file), 'utf8')), file)
  })

  test('no timer redraws: the clock only moves with the poll', () => {
    const dir = path.join(ROOT, 'herdr', 'agenttrail', 'mods', 'agenttrail')
    for (const file of ['main.js', 'feed.js', 'graph.js']) assert.ok(!/setTimeout|setInterval|timer\.every/.test(fs.readFileSync(path.join(dir, file), 'utf8')), file)
  })

  test('the mod never writes to Map', () => {
    const dir = path.join(ROOT, 'herdr', 'agenttrail', 'mods', 'agenttrail')
    for (const file of ['main.js', 'feed.js', 'graph.js']) {
      const text = fs.readFileSync(path.join(dir, file), 'utf8')
      assert.ok(!/method:\s*["']POST/.test(text), file)
      for (const call of text.match(/\bexec\(.*/g) ?? []) assert.match(call, /^exec\("git", \["rev-parse", "--show-toplevel"\]/, file)
    }
  })

  test('the only command the mod sends that starts anything is the Map terminal', () => {
    const text = fs.readFileSync(path.join(ROOT, 'herdr', 'agenttrail', 'mods', 'agenttrail', 'main.js'), 'utf8')
    assert.deepEqual([...new Set(text.match(/\brun\("[a-z.]+"/g))].sort(), ['run("pane.zoom"', 'run("tab.close"', 'run("tab.new"', 'run("tab.select"', 'run("terminal.open"'])
    // pinned to this release, so a new npm publish never runs from a click without a new mod release
    const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
    assert.ok(text.includes(`START_COMMAND = ["npx", "-y", "agenttrail@${version}"]`), `START_COMMAND must pin agenttrail@${version}`)
    assert.match(text, /\[\.\.\.this\.command, repo, "--no-open"\]/)
  })
})
