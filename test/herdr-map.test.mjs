// The Map prototype mod. Its layout is a port of the page's, so these run the page's
// own functions next to the port, on this repo's real plan read through a real Map.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { Feed } from '../herdr/agenttrail-map/mods/agenttrail-map/feed.js'
import { boardEdges, boardLayout, cardAgents, dockedIn, hostOf, liveCard } from '../herdr/agenttrail-map/mods/agenttrail-map/graph.js'
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

describe('the Map prototype mod', () => {
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
    const feed = new Feed({ fetch: u => fetch(u), sleep: () => new Promise(() => {}), base: map.port, folder: () => path.join(world.repo, 'src') })
    assert.equal(await feed.tick(), true)
    assert.equal(feed.board.project, board.project)
    assert.equal(feed.port, map.port)
    assert.equal(await feed.tick(), false)
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

  describe('where a copy lives', () => {
    const mod = 'agenttrail-map'
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

  test('the mod never writes to Map', () => {
    const dir = path.join(ROOT, 'herdr', 'agenttrail-map', 'mods', 'agenttrail-map')
    for (const file of ['main.js', 'feed.js', 'graph.js']) {
      const text = fs.readFileSync(path.join(dir, file), 'utf8')
      assert.ok(!/method:\s*["']POST|\bexec\(/.test(text), file)
    }
  })
})
