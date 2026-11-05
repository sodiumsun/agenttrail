// A repo with no PLAN.md: Map infers cards from folders and agent activity. These run real
// daemons on temp repos. A plan always wins, and nothing here may write to the repo.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { after, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { areaId, areaNodes, areaTitle, chooseAreas, coarseChange, describeAreas, ownerOf } from '../bin/lib/areas.mjs'
import { areaLines, boardEdges, boardLayout, detailHeight, isUnfolded, liveCard } from '../herdr/agenttrail-map/mods/agenttrail-map/graph.js'
import { freePortBase, startMap, stopAll, tempWorld, until } from './helpers.mjs'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const page = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8')
const fn = (name) => {
  const start = page.indexOf(`function ${name}(`)
  assert.ok(start >= 0, `${name} is gone from the page`)
  return page.slice(start, start + 1 + page.slice(start + 1).search(/\nfunction |\nlet |\nconst |\n\/\/ /))
}
const NOW = 1_000_000
const POLL_WATCH = new URL('./poll-watch.mjs', import.meta.url).href
const ui = (open = []) => ({ open: new Set(open), closed: new Set(), openTasks: new Set(), closedTasks: new Set() })
const many = (dir, n, ext = 'js') => Array.from({ length: n }, (_, i) => `${dir}/f${i}.${ext}`)
const titles = (paths) => [...paths].sort()

describe('choosing areas', () => {
  test('a big repo reads as a capped set of its real folders', () => {
    const files = ['README.md', ...['api', 'web', 'cli', 'core', 'docs', 'infra', 'tools', 'mobile'].flatMap(d => many(d, 60))]
    const paths = chooseAreas(files)
    assert.ok(paths.length >= 6 && paths.length <= 16, String(paths.length))
    for (const p of paths) assert.ok(p === '' || files.some(f => f.startsWith(`${p}/`)), `${p} is not a real folder`)
  })

  test('hundreds of sibling folders still give a capped set', () => {
    const files = Array.from({ length: 400 }, (_, i) => many(`pkg/p${i}`, 5)).flat()
    const paths = chooseAreas(files)
    assert.ok(paths.length <= 16, String(paths.length))
    assert.equal(describeAreas(paths, files).reduce((n, a) => n + a.count, 0), files.length)
  })

  test('a chain of lone folders collapses to where it branches', () => {
    const files = [...many('a/b/c/x', 30), ...many('a/b/c/y', 30)]
    assert.deepEqual(titles(chooseAreas(files)), ['a/b/c/x', 'a/b/c/y'])
  })

  test('a folder with work in it gets finer cards, and ranks first', () => {
    const files = [...['a', 'b', 'c', 'd', 'e', 'f', 'g'].flatMap(d => many(d, 100)), ...many('app/ui', 20), ...many('app/net', 20), ...many('app/db', 20)]
    const before = chooseAreas(files)
    assert.ok(!before.includes('app/ui'), 'a quiet folder stays whole')
    const heat = Object.fromEntries(many('app/ui', 10).map(f => [f, 3]))
    const paths = chooseAreas(files, heat)
    assert.ok(paths.includes('app/ui'))
    assert.equal(describeAreas(paths, files, heat)[0].path, 'app/ui')
  })

  test('images do not outweigh code, and an active image folder is still seen', () => {
    const files = [...many('art', 500, 'png'), ...many('src', 40), ...many('lib', 40), ...many('test', 40)]
    const ranked = describeAreas(chooseAreas(files), files)
    assert.notEqual(ranked[0].path, 'art')
    assert.equal(describeAreas(chooseAreas(files, { 'art/f1.png': 3 }), files, { 'art/f1.png': 3 })[0].path, 'art')
  })

  test('a dot folder gets no card until someone works there', () => {
    const files = [...many('.github', 40), ...many('src', 100), ...many('test', 100)]
    assert.ok(!chooseAreas(files).includes('.github'))
    assert.ok(chooseAreas(files, { '.github/f1.js': 3 }).includes('.github'))
  })

  test('small repos give a few cards, an empty one none', () => {
    assert.deepEqual(chooseAreas([]), [])
    assert.deepEqual(chooseAreas(['a.js', 'b.js']), [''])
    assert.deepEqual(titles(chooseAreas(['README.md', 'src/a.js', 'src/b.js', 'test/a.js', 'test/b.js'])), ['', 'src', 'test'])
  })

  test('every file has exactly one area, its deepest', () => {
    const index = new Map([['', 'root'], ['app', 'app'], ['app/ui', 'ui']])
    assert.equal(ownerOf(index, 'app/ui/x/y.js'), 'ui')
    assert.equal(ownerOf(index, 'app/x.js'), 'app')
    assert.equal(ownerOf(index, 'lib/x.js'), 'root')
    assert.equal(ownerOf(new Map([['app', 'app']]), 'lib/x.js'), null)
  })

  test('a new choice replaces the cards only on a coarse change', () => {
    const list = (...paths) => paths.map(path => ({ path }))
    const now = { list: list('a', 'b', 'c', 'd', 'e', 'f'), files: 1000 }
    assert.equal(coarseChange(now, { list: list('a', 'b', 'c', 'd', 'e', 'f'), files: 1100 }), false)
    assert.equal(coarseChange(now, { list: list('a', 'b', 'c', 'd', 'e', 'g'), files: 1000 }), false, 'one folder is not coarse')
    assert.equal(coarseChange(now, { list: list('a', 'b', 'c', 'd', 'g', 'h'), files: 1000 }), true)
    assert.equal(coarseChange(now, { list: now.list, files: 1300 }), true)
  })

  test('titles are real paths: long ones keep their end, and a part left over says so', () => {
    assert.equal(areaTitle({ path: 'src/audio' }), 'src/audio')
    assert.equal(areaTitle({ path: '' }), 'Repo root')
    assert.equal(areaTitle({ path: 'app', rest: true }), 'app (rest)')
    const long = areaTitle({ path: 'apps/desktop/src/components/settings/panels' })
    assert.ok(long.length <= 28 && long.endsWith('/panels') && long.startsWith('…/'), long)
  })

  test('a card has the keys a plan component has, and no edges', () => {
    const [card] = areaNodes([{ path: 'src', count: 2, sample: [] }])
    for (const key of ['id', 'title', 'level', 'parent', 'needs', 'links', 'files', 'tech', 'by', 'kind', 'url', 'status']) assert.ok(key in card, key)
    assert.equal(card.id, areaId('src'))
    assert.match(card.id, /^[a-z0-9][a-z0-9-]*$/, 'safe in the page, whatever the path holds')
    assert.deepEqual([card.needs, card.links], [[], []])
    assert.equal(card.derived, true)
  })
})

describe('drawing inferred cards', () => {
  const pageGraph = (M, open = []) => {
    const source = ['compLive', 'isUnfolded', 'kids', 'graphTaskIsOpen', 'graphTaskDetails', 'areaFiles', 'areaLines', 'graphDetailHeight', 'graphNodeMetrics', 'boardLayout', 'nodeAgentChips', 'areaGraphNode', 'collapsedGraphNode'].map(fn).join('\n')
    return new Function('M', 'openGraphDetails', 'closedGraphDetails', 'Date', `
      const openGraphTasks = new Set(), closedGraphTasks = new Set(), fileMode = false, ns = id => '1:' + id, ago = () => '3s'
      const agentColor = () => '', agentIcon = () => '', agentGlyph = n => n[0], esc = s => String(s)
      ${source}
      return { boardLayout, collapsedGraphNode, areaLines }`)(M, new Set(open.map(id => `1:${id}`)), new Set(), { now: () => NOW })
  }
  const list = ['src', 'test', 'docs', 'tools', 'infra'].map((path, i) => ({ path, count: 10 - i, sample: [] }))
  const board = (extra = {}) => ({ plan: areaNodes(list).map((n, i) => ({ ...n, touchedAt: null, recent: [], stats: { changed: 0, sessions: 0 }, ...(i === 1 ? extra : {}) })), runs: [], derived: {}, hasPlan: false })

  test('they land where the page puts them, in the mod and the browser', () => {
    const recent = [{ file: 'test/a.js', at: NOW - 3000 }, { file: 'test/b.js', at: NOW - 9000 }]
    const b = board({ recent, touchedAt: NOW - 3000 })
    for (const open of [[], [b.plan[1].id]]) {
      const theirs = pageGraph(b, open).boardLayout(b)
      const ours = boardLayout(b, ui(open), NOW)
      assert.deepEqual(ours.pos, theirs.pos)
      assert.deepEqual([ours.width, ours.height], [theirs.width, theirs.height])
    }
  })

  test('cards sit on a grid, and a write moves none of them', () => {
    const quiet = boardLayout(board(), ui(), NOW)
    const xs = new Set(Object.values(quiet.pos).map(p => p.x))
    assert.ok(xs.size > 1, 'with no edges they would all stack in one column')
    const live = board({ touchedAt: NOW - 1000, recent: [{ file: 'test/a.js', at: NOW - 1000 }], stats: { changed: 9, sessions: 2 } })
    assert.deepEqual(boardLayout(live, ui(), NOW).pos, quiet.pos)
    const run = { ...board(), runs: [{ componentId: board().plan[0].id, ended: false, agent: 'claude' }] }
    assert.deepEqual(boardLayout(run, ui(), NOW).pos, quiet.pos)
  })

  test('a card says what was seen, with no tasks and no progress', () => {
    const b = board({ stats: { changed: 3, sessions: 2 }, recent: [{ file: 'test/a.js', at: NOW - 3000 }] })
    const g = pageGraph(b)
    const html = g.collapsedGraphNode(b.plan[1], 1, boardLayout(b, ui(), NOW).pos[b.plan[1].id])
    assert.match(html, /3 files changed in 24 h · 2 sessions/)
    assert.match(html, /test\/a\.js · 3s/)
    assert.doesNotMatch(html, /tasks|progress|Not started|of \d/i)
    const quiet = pageGraph(board()).collapsedGraphNode(board().plan[0], 0, boardLayout(board(), ui(), NOW).pos[board().plan[0].id])
    assert.match(quiet, /No activity seen yet/)
  })

  test('the page and the mod word a card the same', () => {
    const ago = () => '5 min'
    const long = `${'deep/'.repeat(12)}file.js`
    for (const p of [{}, { stats: { changed: 1, sessions: 1 } }, { stats: { changed: 4 }, recent: [{ file: 'a.js', at: 1 }] }, { recent: [{ file: long, at: 1 }] }]) {
      assert.deepEqual(areaLines(p, ago), pageGraph({ plan: [], runs: [] }).areaLines(p, ago))
    }
  })

  test('an opened card lists its files, and a live one stays shut until asked', () => {
    const recent = [{ file: 'test/a.js', at: 1 }, { file: 'test/b.js', at: 1 }]
    const b = board({ recent, touchedAt: NOW - 1000 })
    const p = b.plan[1]
    assert.equal(isUnfolded(b, p, ui(), NOW), false)
    assert.equal(isUnfolded(b, p, ui([p.id]), NOW), true)
    assert.equal(detailHeight(b, p, ui([p.id]), NOW), 89)
    assert.equal(liveCard(b, NOW), p.id, 'a narrow view still goes to it')
  })

  test('no trail, no connector: a session\'s moves are the only lines', () => {
    const b = board()
    const L = boardLayout(b, ui(), NOW)
    assert.deepEqual(boardEdges(b, L, NOW), { trails: [], edges: [] })
    const [one, two] = b.plan
    const moved = { ...b, runs: [{ agent: 'claude', path: [{ c: one.id, at: NOW }, { c: two.id, at: NOW }] }] }
    const out = boardEdges(moved, L, NOW)
    assert.equal(out.trails.length, 1)
    assert.deepEqual(out.edges, [])
  })
})

describe('a real Map with no plan', () => {
  const worlds = []
  const world = (files = {}) => {
    const w = tempWorld('')
    worlds.push(w)
    for (const [f, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(w.repo, f)), { recursive: true }); fs.writeFileSync(path.join(w.repo, f), text) }
    return w
  }
  const git = (w, ...args) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: w.repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  const committed = (w) => { git(w, 'init', '-q'); git(w, 'add', '.'); git(w, 'commit', '-qm', 'start'); return w }
  const cardsOf = (map) => until(async () => { const b = await lite(map); return b.plan.length ? b : null }, 'the first cards')
  const lite = async (map) => JSON.parse((await map.get('/board-lite')).body)
  const hook = (map, id, cwd, file, name = 'PostToolUse') => map.post('/hook', { hook_event_name: name, session_id: id, cwd, tool_name: 'Edit', tool_input: { file_path: file } })
  const start = async (w) => startMap({ repo: w.repo, home: w.home, base: await freePortBase(), env: { NODE_OPTIONS: `--import=${POLL_WATCH}` } })
  const sample = { 'README.md': 'x', '.gitignore': 'out/\n', 'src/a.js': 'x', 'src/b.js': 'x', 'test/a.js': 'x', 'test/b.js': 'x' }
  after(async () => { await stopAll(); for (const w of worlds) w.cleanup() })

  test('any git repo gets cards with no setup, marked as inferred, and the repo stays as it was', async () => {
    const w = committed(world(sample))
    const before = git(w, 'status', '--porcelain=v2', '--ignored')
    const index = fs.readFileSync(path.join(w.repo, '.git', 'index'))
    const map = await start(w)
    const b = await cardsOf(map)
    assert.equal(b.hasPlan, false)
    assert.deepEqual(titles(b.plan.map(n => n.title)), ['Repo root', 'src', 'test'])
    assert.equal(b.derived.source, 'git')
    assert.equal(b.derived.files, 6)
    assert.ok(b.plan.every(n => n.derived && !n.needs.length && !n.links.length && 'stats' in n))
    assert.ok(!fs.existsSync(path.join(w.repo, 'PLAN.md')))
    assert.ok(!fs.existsSync(path.join(w.repo, '.agenttrail')))
    assert.equal(git(w, 'status', '--porcelain=v2', '--ignored'), before)
    assert.deepEqual(fs.readFileSync(path.join(w.repo, '.git', 'index')), index)
    assert.equal(JSON.parse((await map.get('/panel')).body).hasPlan, false)
    assert.deepEqual(JSON.parse((await map.get('/summary')).body).components, [], 'other views still see no plan')
  })

  test('ignored and untracked noise stays off the cards', async () => {
    const w = committed(world({ ...sample, 'out/junk.js': 'x' }))
    const map = await start(w)
    const b = await cardsOf(map)
    assert.equal(b.derived.files, 6, 'out/ is ignored')
    fs.writeFileSync(path.join(w.repo, 'out', 'junk.js'), 'y')
    fs.writeFileSync(path.join(w.repo, 'src', 'a.js'), 'y')
    const seen = await until(async () => { const m = await lite(map); return m.plan.find(n => n.path === 'src').touchedAt ? m : null }, 'the write to show')
    assert.ok(!seen.recentActivity.some(a => a.file.startsWith('out/')))
    assert.equal(seen.plan.find(n => n.path === '').touchedAt, null)
  })

  test('a folder that is not in git is walked, and an empty one draws nothing yet', async () => {
    const plain = await start(world({ 'lib/a.js': 'x', 'lib/b.js': 'x', 'node_modules/x/i.js': 'x', 'docs/a.md': 'x', 'docs/b.md': 'x' }))
    const b = await cardsOf(plain)
    assert.equal(b.derived.source, 'folders')
    assert.deepEqual(titles(b.plan.map(n => n.title)), ['docs', 'lib'])
    const w = world()
    const empty = await start(w)
    await until(async () => (await lite(empty)).derived?.source, 'the listing')
    assert.deepEqual((await lite(empty)).plan, [])
    fs.writeFileSync(path.join(w.repo, 'first.js'), 'x')
    await until(async () => (await lite(empty)).plan.length === 1, 'the first file to become a card')
  })

  test('a write updates its card, moves nothing, and each file lists once with no folders', async () => {
    const w = committed(world(sample))
    const map = await start(w)
    const b = await cardsOf(map)
    const places = (x) => x.plan.map(n => [n.id, n.col])
    fs.writeFileSync(path.join(w.repo, 'src', 'a.js'), 'y')
    await until(async () => (await lite(map)).recentActivity.some(a => a.file === 'src/a.js'), 'the first write')
    fs.mkdirSync(path.join(w.repo, 'src', 'deep'))
    fs.writeFileSync(path.join(w.repo, 'src', 'deep', 'n.js'), 'y')
    fs.writeFileSync(path.join(w.repo, 'test', 'a.js'), 'y')
    await until(async () => (await lite(map)).recentActivity.some(a => a.file === 'test/a.js'), 'the second write')
    await new Promise(r => setTimeout(r, 1200))
    fs.writeFileSync(path.join(w.repo, 'src', 'a.js'), 'z')
    await until(async () => (await lite(map)).recentActivity[0].file === 'src/a.js', 'the repeat write')
    const now = await lite(map)
    const files = now.recentActivity.map(a => a.file)
    assert.equal(new Set(files).size, files.length, files.join())
    assert.ok(!files.some(f => fs.statSync(path.join(w.repo, f)).isDirectory()), files.join())
    const src = now.plan.find(n => n.path === 'src')
    assert.equal(src.recent[0].file, 'src/a.js')
    assert.equal(new Set(src.recent.map(a => a.file)).size, src.recent.length)
    assert.ok(src.stats.changed >= 2)
    assert.deepEqual(places(now), places(b))
  })

  test('a session moving between areas draws a trail, counts on each card, and shows who is here', async () => {
    const w = committed(world(sample))
    const map = await start(w)
    const b = await cardsOf(map)
    const id = (p) => b.plan.find(n => n.path === p).id
    await hook(map, 's1', w.repo, path.join(w.repo, 'src/a.js'))
    await hook(map, 's1', w.repo, path.join(w.repo, 'test/a.js'))
    await hook(map, 's2', w.repo, path.join(w.repo, 'test/b.js'))
    const m = await lite(map)
    const run = m.runs.find(r => r.id === 's1')
    assert.deepEqual(run.path.map(s => s.c), [id('src'), id('test')])
    assert.equal(run.componentId, id('test'))
    assert.equal(m.plan.find(n => n.path === 'test').stats.sessions, 2)
    assert.equal(m.plan.find(n => n.path === 'src').stats.sessions, 1)
    assert.equal(boardEdges(m, boardLayout(m, ui(), Date.now()), Date.now()).trails.length, 1)
    assert.deepEqual(JSON.parse((await map.get('/panel')).body).runs.find(r => r.id === 's1').path, [], 'the list panel\'s paths stay a plan\'s')
  })

  test('restarting keeps the same cards in the same places', async () => {
    const w = committed(world(sample))
    const map = await start(w)
    const b = await cardsOf(map)
    await hook(map, 's1', w.repo, path.join(w.repo, 'test/a.js'))
    await map.stop()
    const again = await start(w)
    const c = await cardsOf(again)
    assert.deepEqual(c.plan.map(n => [n.id, n.col]), b.plan.map(n => [n.id, n.col]))
    assert.equal(c.plan.find(n => n.path === 'test').stats.sessions, 1)
  })

  test('a plan takes over at once, and removing it brings the cards back', async () => {
    const w = committed(world(sample))
    const map = await start(w)
    await cardsOf(map)
    await hook(map, 's1', w.repo, path.join(w.repo, 'src/a.js'))
    fs.writeFileSync(path.join(w.repo, 'PLAN.md'), '# p\n\n## Do a thing {#thing}\n- [ ] One {#one}\n- [ ] Two {#two}\n')
    const planned = await until(async () => { const m = await lite(map); return m.hasPlan ? m : null }, 'the plan')
    assert.ok(!('derived' in planned))
    assert.deepEqual(planned.plan.map(n => n.id), ['thing', 'one', 'two'])
    assert.ok(!planned.plan.some(n => 'col' in n || 'stats' in n))
    assert.equal(planned.runs[0].componentId, null)
    fs.rmSync(path.join(w.repo, 'PLAN.md'))
    await until(async () => { const m = await lite(map); return !m.hasPlan && m.plan.some(n => n.derived) }, 'the cards to return')
  })

  test('Recent files is right with a plan too: each file once, no folders', async () => {
    const w = committed(world({ ...sample, 'PLAN.md': '# p\n\n## Thing {#thing}\nfiles: [src/**]\n- [ ] One {#one}\n- [ ] Two {#two}\n' }))
    const map = await start(w)
    const saw = (f) => until(async () => (await lite(map)).recentActivity[0]?.file === f, `${f} first`)
    fs.writeFileSync(path.join(w.repo, 'src', 'a.js'), 'y')
    await saw('src/a.js')
    fs.mkdirSync(path.join(w.repo, 'src', 'deep'))
    fs.writeFileSync(path.join(w.repo, 'src', 'deep', 'n.js'), 'y')
    await saw('src/deep/n.js')
    fs.writeFileSync(path.join(w.repo, 'src', 'a.js'), 'z')
    await saw('src/a.js')
    const files = (await lite(map)).recentActivity.map(a => a.file)
    assert.deepEqual([...files].sort(), ['src/a.js', 'src/deep/n.js'])
  })

  test('a repo with a plan gets nothing inferred, even a skeleton', async () => {
    const w = committed(world({ ...sample, 'PLAN.md': '# p\n\n## Set up the project {#setup}\n- [ ] First task {#setup-first}\n' }))
    const map = await start(w)
    await hook(map, 's1', w.repo, path.join(w.repo, 'src/a.js'))
    await new Promise(r => setTimeout(r, 300))
    const m = await lite(map)
    assert.ok(!('derived' in m))
    assert.deepEqual(m.plan.map(n => n.id), ['setup', 'setup-first'])
    assert.deepEqual(Object.keys(m.plan[0]).sort(), ['by', 'files', 'filesList', 'id', 'kind', 'level', 'links', 'needs', 'parent', 'recent', 'status', 'tech', 'title', 'touchedAt', 'url'])
    assert.ok(!('path' in m.runs[0] && m.runs[0].path.some(s => 'f' in s)))
    assert.ok(!('areaFile' in m.runs[0]))
  })
})
