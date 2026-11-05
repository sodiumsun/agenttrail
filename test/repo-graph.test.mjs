// A repo with no PLAN.md: Map draws the real work from git, across every branch and
// worktree. Everything here is a made-up repo in a temp folder, and real daemons run on
// them. A plan always wins, and nothing here may write to the repo.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { after, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { areaId, areaTitle, chooseAreas, describeAreas, ownerOf } from '../bin/lib/areas.mjs'
import { assignCommits, boardNodes, keepOrder, parseLog, parseRefs, parseWorktrees, readHistory, streamId } from '../bin/lib/workstreams.mjs'
import { boardEdges, boardLayout, cardLines, detailHeight, inferredNote, isUnfolded, liveCard, openingCard } from '../herdr/agenttrail-map/mods/agenttrail-map/graph.js'
import { freePortBase, startMap, stopAll, tempDir, tempWorld, until } from './helpers.mjs'
import { hits, scan } from './leak-scan.mjs'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const page = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8')
const fn = (name) => {
  const start = page.indexOf(`function ${name}(`)
  assert.ok(start >= 0, `${name} is gone from the page`)
  return page.slice(start, start + 1 + page.slice(start + 1).search(/\nfunction |\nlet |\nconst |\n\/\/ /))
}
const NOW = 1_000_000_000
const HOUR = 3600e3
const POLL_WATCH = new URL('./poll-watch.mjs', import.meta.url).href
const ui = (open = []) => ({ open: new Set(open), closed: new Set(), openTasks: new Set(), closedTasks: new Set() })

let n = 0
const commit = (s, files = ['src/a.js'], extra = {}) => {
  const sha = `c${++n}`
  return { sha, parents: [], ct: NOW - n * 1000, at: NOW - n * 1000, s, files, ...extra }
}
// A line of commits, newest first, each the child of the next.
const line = (...list) => list.map((c, i) => ({ ...c, parents: list[i + 1] ? [list[i + 1].sha] : c.parents }))
const head = (name, sha) => ({ sha, ref: `refs/heads/${name}` })
const tree = (p, branch, sha = 'x') => ({ path: p, head: sha, branch: branch ? `refs/heads/${branch}` : null })

describe('reading git output', () => {
  test('a log with paths, merges, odd subjects and a prefix', () => {
    const text = '\x01aaa\0bbb ccc\x00200\x00100\x00Merge x\n\n\x01bbb\0\x00300\x00150\x00Fix: a\0b?\n\nsub/src/a.js\nother/b.js\nsub/dist/x.js\n'
    const [merge, plain] = parseLog(text, 'sub/')
    assert.deepEqual(merge.parents, ['bbb', 'ccc'])
    assert.equal(merge.ct, 200_000)
    assert.deepEqual(plain.files, ['src/a.js'], 'outside the prefix and build output are not work here')
  })

  test('worktrees: attached, detached and bare', () => {
    const text = 'worktree /r\nbare\n\nworktree /a b\nHEAD aaa\nbranch refs/heads/x\n\nworktree /c\nHEAD ccc\ndetached\n\n'
    assert.deepEqual(parseWorktrees(text), [{ path: '/a b', head: 'aaa', branch: 'refs/heads/x' }, { path: '/c', head: 'ccc', branch: null }])
  })

  test('refs', () => assert.deepEqual(parseRefs('aaa\0refs/heads/x\n'), [{ sha: 'aaa', ref: 'refs/heads/x' }]))
})

describe('choosing areas', () => {
  const touching = (file, count) => Array.from({ length: count }, (_, i) => commit(`${file} ${i}`, [file]))

  test('cards go where the commits are, at any depth, past quieter top-level folders', () => {
    const list = [...touching('a/one/x.js', 40), ...touching('a/two/x.js', 40), ...touching('a/three/x.js', 30), ...touching('b/x.js', 20), ...touching('c/x.js', 3), ...touching('d/x.js', 2)]
    const paths = chooseAreas(list, 5)
    assert.ok(paths.includes('a/one') && paths.includes('a/two') && paths.includes('a/three'), paths.join())
    assert.ok(!paths.includes('d'))
  })

  test('a bulk move weighs one commit, not a thousand files', () => {
    const bulk = commit('move', Array.from({ length: 1000 }, (_, i) => `sprites/f${i}.png`))
    const list = [bulk, ...touching('core/a.js', 30), ...touching('api/a.js', 30)]
    const ranked = describeAreas(chooseAreas(list), list)
    assert.equal(ranked.find(a => a.path === 'sprites')?.commits ?? 1, 1)
    assert.ok(['core', 'api'].includes(ranked[0].path))
  })

  test('a folder that nearly fills its parent is looked through, and a lone chain collapses', () => {
    const list = [...touching('app/src/x.js', 40), ...touching('app/test/x.js', 5), ...touching('deep/er/still/x.js', 40)]
    const paths = chooseAreas(list)
    assert.ok(!paths.includes('app/src'), paths.join())
    assert.ok(paths.includes('deep/er/still'), paths.join())
  })

  test('a small history gives a few cards, nothing gives none', () => {
    assert.deepEqual(chooseAreas([]), [])
    assert.deepEqual(chooseAreas([commit('only', [])]), [])
    assert.deepEqual(chooseAreas([commit('only', ['README.md'])]), [''])
    assert.equal(areaTitle({ path: '' }), 'Repo root')
  })

  test('hundreds of folders still give a capped set', () => {
    const list = Array.from({ length: 400 }, (_, i) => commit(`c${i}`, [`pkg/p${i % 200}/a.js`]))
    assert.ok(chooseAreas(list).length <= 12)
  })

  test('many equal folders are not all folded into one card', () => {
    const list = Array.from({ length: 900 }, (_, i) => commit(`c${i}`, [`pkg/p${i % 40}/a.js`]))
    assert.ok(chooseAreas(list, 8).length >= 6)
  })

  test('each file has one area, its deepest; an area counts each commit once', () => {
    const index = new Map([['src', 'A'], ['src/ui', 'B']])
    assert.equal(ownerOf(index, 'src/ui/x/a.js'), 'B')
    assert.equal(ownerOf(index, 'src/a.js'), 'A')
    assert.equal(ownerOf(index, 'lib/a.js'), null)
    const c = { ...commit('two files', ['src/a.js', 'src/b.js']), on: 'x' }
    const [area] = describeAreas(['src'], [c])
    assert.deepEqual([area.commits, area.branches, area.recent[0].s], [1, 1, 'two files'])
  })

  test('titles are real paths: long ones keep their end, and a part left over says so', () => {
    assert.equal(areaTitle({ path: 'src', rest: true }), 'src (rest)')
    const long = areaTitle({ path: 'very/long/nested/folder/that/goes/on/and/on/here' })
    assert.ok(long.startsWith('…/') && long.endsWith('here') && long.length <= 34)
  })
})

describe('who owns a commit', () => {
  const map = (list) => new Map(list.map(c => [c.sha, c]))
  const owned = (list, tips, trunk) => assignCommits(map(list), tips, trunk)

  test('what reached the trunk has landed, and a branch keeps the rest', () => {
    const base = commit('base'), mine = { ...commit('mine'), parents: [base.sha] }
    const { landed, owner } = owned([mine, base], [{ key: 'x', sha: mine.sha, ct: mine.ct }], [base.sha])
    assert.ok(landed.has(base.sha))
    assert.deepEqual([...owner], [[mine.sha, 'x']])
  })

  test('a rebased or cherry-picked commit counts as landed, by its author time and subject', () => {
    const onTrunk = commit('same work'), copy = { ...onTrunk, sha: 'copy', ct: NOW + 5 }, mine = { ...commit('new work'), parents: ['copy'] }
    copy.parents = []
    const { owner } = owned([mine, copy, onTrunk], [{ key: 'x', sha: mine.sha, ct: mine.ct }], [onTrunk.sha])
    assert.deepEqual([...owner.keys()], [mine.sha])
  })

  test('a stacked branch takes only what is new', () => {
    const [top, mid, low] = line(commit('top'), commit('mid'), commit('low'))
    const { owner } = owned([top, mid, low], [{ key: 'upper', sha: top.sha, ct: 2 }, { key: 'lower', sha: mid.sha, ct: 1 }], [])
    assert.equal(owner.get(top.sha), 'upper')
    assert.equal(owner.get(low.sha), 'upper')
  })

  test('an integration branch does not swallow the branches merged into it, only orphans', () => {
    const base = commit('base'), feat = { ...commit('feat'), parents: [base.sha] }, gone = { ...commit('from a deleted branch'), parents: [base.sha] }
    const merge = { ...commit('Merge'), parents: [base.sha, feat.sha] }, merge2 = { ...commit('Merge'), parents: [merge.sha, gone.sha] }
    const { owner } = owned([merge2, merge, feat, gone, base], [{ key: 'integ', sha: merge2.sha, ct: 9 }, { key: 'feat', sha: feat.sha, ct: 1 }], [base.sha])
    assert.equal(owner.get(feat.sha), 'feat')
    assert.equal(owner.get(gone.sha), 'integ')
  })
})

describe('choosing workstreams', () => {
  const trunkBase = { ...commit('trunk work'), ct: NOW - 1000 * HOUR }
  const branch = (name, count = 1, age = 1) => {
    const list = line(...Array.from({ length: count }, (_, i) => commit(`${name} ${i}`, [`${name}/x.js`], { ct: NOW - age * HOUR - i })), { ...commit('fork point'), sha: `fork-${name}`, parents: [trunkBase.sha] }).slice(0, count)
    list[count - 1].parents = [trunkBase.sha]
    return list
  }

  test('work on other branches counts, with none on the checked-out one', () => {
    const a = branch('alpha', 3), b = branch('beta', 2, 2)
    const out = readHistory({
      refs: [head('main', trunkBase.sha), head('alpha', a[0].sha), head('beta', b[0].sha)],
      worktrees: [tree('/r', 'main', trunkBase.sha), tree('/w/alpha', 'alpha', a[0].sha)],
      commits: [...a, ...b, trunkBase],
    })
    assert.equal(out.mode, 'streams')
    assert.deepEqual(out.streams.map(s => [s.name, s.commits, s.worktree]), [['alpha', 3, '/w/alpha'], ['beta', 2, null], ['main', 1, '/r']])
    assert.deepEqual(out.streams[0].recent.map(c => c.s), ['alpha 0', 'alpha 1', 'alpha 2'])
  })

  test('many branches reduce to a handful, newest first, and the rest are counted', () => {
    const lots = Array.from({ length: 30 }, (_, i) => branch(`b${i}`, 1, i + 1))
    const out = readHistory({ refs: [head('main', trunkBase.sha), ...lots.map((l, i) => head(`b${i}`, l[0].sha))], worktrees: [tree('/r', 'main', trunkBase.sha)], commits: [...lots.flat(), trunkBase] })
    assert.equal(out.streams.length, 8)
    assert.equal(out.streams[0].name, 'b0')
    assert.deepEqual([out.counts.active, out.counts.shown], [31, 8])
  })

  test('a live session always gets its card, even on a branch with no new commits', () => {
    const lots = Array.from({ length: 12 }, (_, i) => branch(`b${i}`, 1, i + 1))
    const out = readHistory({
      refs: [head('main', trunkBase.sha), head('old', 'gone'), ...lots.map((l, i) => head(`b${i}`, l[0].sha))],
      worktrees: [tree('/r', 'main', trunkBase.sha), tree('/w/old', 'old', 'gone')],
      commits: [...lots.flat(), trunkBase], live: ['/w/old'],
    })
    assert.equal(out.streams[0].name, 'old')
    assert.equal(out.streams[0].commits, 0)
    assert.equal(out.worktrees['/w/old'], streamId('old'))
  })

  test('local and remote copies are one workstream; a remote-only one says so', () => {
    const a = branch('alpha'), b = branch('beta', 1, 2)
    const out = readHistory({
      refs: [head('main', trunkBase.sha), head('alpha', trunkBase.sha), { sha: a[0].sha, ref: 'refs/remotes/origin/alpha' }, { sha: b[0].sha, ref: 'refs/remotes/origin/beta' }, { sha: 'x', ref: 'refs/remotes/origin/HEAD' }],
      worktrees: [tree('/r', 'main', trunkBase.sha)], commits: [...a, ...b, trunkBase],
    })
    assert.deepEqual(out.streams.filter(s => !s.trunk).map(s => [s.name, s.remote]), [['alpha', false], ['beta', true]])
  })

  test('a stale origin/HEAD does not stop main counting as the trunk', () => {
    const a = branch('alpha')
    const out = readHistory({
      refs: [head('main', trunkBase.sha), head('alpha', a[0].sha), head('old-release', 'out-of-window')],
      worktrees: [tree('/r', 'alpha', a[0].sha)], commits: [...a, trunkBase], originHead: 'refs/remotes/origin/old-release',
    })
    assert.equal(out.streams.find(s => s.name === 'alpha').commits, 1)
  })

  test('a detached worktree is its branch when on a tip, and its own workstream when not', () => {
    const a = branch('alpha'), lone = { ...commit('detached work', ['z/x.js']), parents: [trunkBase.sha] }
    const out = readHistory({
      refs: [head('main', trunkBase.sha), head('alpha', a[0].sha)],
      worktrees: [tree('/r', 'main', trunkBase.sha), tree('/w/on-tip', null, a[0].sha), tree('/w/own-folder', null, lone.sha)],
      commits: [...a, lone, trunkBase],
    })
    const names = out.streams.map(s => s.name)
    assert.ok(names.includes('own-folder') && !names.includes('on-tip'), names.join())
    assert.equal(out.streams.find(s => s.name === 'alpha').worktree, '/w/on-tip')
    assert.equal(out.streams.find(s => s.name === 'own-folder').detached, true)
  })

  test('a branch with nothing new is left out, with its worktree counted as quiet', () => {
    const a = branch('alpha')
    const out = readHistory({
      refs: [head('main', trunkBase.sha), head('alpha', a[0].sha), head('done', trunkBase.sha)],
      worktrees: [tree('/r', 'main', trunkBase.sha), tree('/w/a', 'alpha', a[0].sha), tree('/w/done', 'done', trunkBase.sha)],
      commits: [...a, trunkBase],
    })
    assert.ok(!out.streams.some(s => s.name === 'done'))
    assert.deepEqual([out.counts.worktrees, out.counts.quiet], [3, 1])
  })

  test('one branch means area cards with subjects, and no workstreams', () => {
    const list = line(commit('add api', ['api/a.js']), commit('add web', ['web/a.js']))
    const out = readHistory({ refs: [head('main', list[0].sha)], worktrees: [tree('/r', 'main', list[0].sha)], commits: list })
    assert.equal(out.mode, 'areas')
    const nodes = boardNodes(out)
    assert.deepEqual(nodes.map(p => p.path).sort(), ['api', 'web'])
    assert.ok(nodes.every(p => p.commits.length === 1 && !p.stream))
  })

  test('connectors run to a workstream\'s most touched areas, and only real ones', () => {
    const files = (names) => names.map(f => `${f}/x.js`)
    const main = commit('base', ['zzz/x.js'])
    const list = line(...Array.from({ length: 20 }, (_, i) => commit(`w${i}`, files(i < 19 ? ['a', 'b', 'c', 'd'] : ['once']))), main)
    const out = readHistory({ refs: [head('main', main.sha), head('w', list[0].sha)], worktrees: [tree('/r', 'main', main.sha)], commits: list })
    const nodes = boardNodes(out)
    const stream = nodes.find(p => p.stream && p.title === 'w')
    assert.ok(stream.links.length > 0 && stream.links.length <= 2)
    assert.ok(stream.links.every(id => nodes.some(p => p.id === id && p.path != null)))
    assert.ok(!stream.links.includes(areaId('once')))
  })

  test('cards hold their places between full rankings, and new work goes on top', () => {
    const s = (key) => ({ key })
    assert.deepEqual(keepOrder([s('new'), s('b'), s('a')], ['a', 'b', 'gone']).map(x => x.key), ['new', 'a', 'b'])
    assert.deepEqual(keepOrder([s('b'), s('a')], null).map(x => x.key), ['b', 'a'])
  })

  test('thousands of refs read fast', () => {
    const lots = Array.from({ length: 3000 }, (_, i) => branch(`s${i}`, 1, i % 100))
    const started = Date.now()
    const out = readHistory({ refs: [head('main', trunkBase.sha), ...lots.map((l, i) => head(`s${i}`, l[0].sha))], worktrees: [tree('/r', 'main', trunkBase.sha)], commits: [...lots.flat(), trunkBase] })
    assert.equal(out.streams.length, 8)
    assert.ok(Date.now() - started < 3000, `${Date.now() - started} ms`)
  })
})

describe('drawing cards from git', () => {
  const pageGraph = (M, open = []) => {
    const source = ['compLive', 'isUnfolded', 'kids', 'graphTaskIsOpen', 'graphTaskDetails', 'cardCommits', 'cardLines', 'inferredNote', 'graphDetailHeight', 'graphNodeMetrics', 'boardLayout', 'nodeAgentChips', 'areaGraphNode', 'collapsedGraphNode'].map(fn).join('\n')
    return new Function('M', 'openGraphDetails', 'closedGraphDetails', 'Date', 'esc', `
      const openGraphTasks = new Set(), closedGraphTasks = new Set(), fileMode = false, ns = id => '1:' + id, ago = () => '3s'
      const agentColor = () => '', agentIcon = () => '', agentGlyph = n => n[0]
      const fitLine = (text, room) => text.length > room ? text.slice(0, room - 1) + '…' : text
      ${source}
      return { boardLayout, collapsedGraphNode, cardLines, inferredNote }`)(M, new Set(open.map(id => `1:${id}`)), new Set(), { now: () => NOW }, (s) => String(s).replace(/</g, '&lt;'))
  }
  const scanned = {
    mode: 'streams',
    streams: ['one', 'two', 'three'].map((name, i) => ({ key: name, id: streamId(name), name, at: NOW - i * HOUR, commits: 2, recent: [{ s: `${name} latest`, at: NOW }, { s: `${name} before`, at: NOW - 1 }], worktree: i ? null : '/w', links: ['src'], sample: [] })),
    areas: ['src', 'test'].map((p) => ({ path: p, commits: 4, branches: 2, recent: [{ s: 'x', at: NOW, on: 'one' }], sample: [] })),
  }
  const board = (extra = {}) => ({ plan: boardNodes(scanned).map((p, i) => ({ ...p, touchedAt: null, recent: [], ...(i === 1 ? extra : {}) })), runs: [], derived: { mode: 'streams', days: 7, shown: 3, active: 9, worktrees: 20, quiet: 14, commits: 40 }, hasPlan: false })

  test('they land where the page puts them, in the mod and the browser', () => {
    const b = board({ touchedAt: NOW - 3000 })
    for (const open of [[], [b.plan[1].id]]) {
      const theirs = pageGraph(b, open).boardLayout(b)
      const ours = boardLayout(b, ui(open), NOW)
      assert.deepEqual(ours.pos, theirs.pos)
      assert.deepEqual([ours.width, ours.height], [theirs.width, theirs.height])
    }
  })

  test('workstreams sit left of the areas they touched, with a connector each', () => {
    const b = board()
    const L = boardLayout(b, ui(), NOW)
    const stream = b.plan.find(p => p.stream), area = b.plan.find(p => p.path === 'src')
    assert.ok(L.pos[stream.id].x < L.pos[area.id].x)
    const { edges, trails } = boardEdges(b, L, NOW)
    assert.equal(edges.length, 3)
    assert.ok(edges.every(e => e.kind === 'link'))
    assert.deepEqual(trails, [])
  })

  test('a card shows its subjects as written, and no tasks or progress', () => {
    const b = board()
    const node = pageGraph(b).collapsedGraphNode(b.plan[0], 0, boardLayout(b, ui(), NOW).pos[b.plan[0].id])
    assert.match(node, /one latest/)
    assert.match(node, /one before/)
    assert.doesNotMatch(node, /tasks|Not started|class="progress/)
  })

  test('a subject cannot reach the page as markup', () => {
    const b = board()
    b.plan[0].commits = [{ s: '<img src=x onerror=alert(1)>', at: NOW }]
    assert.doesNotMatch(pageGraph(b).collapsedGraphNode(b.plan[0], 0, boardLayout(b, ui(), NOW).pos[b.plan[0].id]), /<img/)
  })

  test('a session on a card takes the second line, live or just finished', () => {
    const b = board()
    const p = b.plan[0]
    const ago = () => '5 min'
    b.runs = [{ agent: 'claude', componentId: p.id, ended: false, lastEventAt: NOW, todos: [{ status: 'in_progress', content: 'Write the thing' }] }]
    assert.deepEqual(cardLines(b, p, ago), { first: 'one latest', second: 'claude: Write the thing', working: true, age: '5 min ago' })
    b.runs = [{ agent: 'codex', componentId: p.id, ended: true, lastEventAt: NOW }]
    assert.equal(cardLines(b, p, ago).second, 'codex session, 5 min ago')
    assert.equal(cardLines(b, p, ago).working, false)
  })

  test('the page and the mod word a card and the note the same', () => {
    const ago = () => '5 min'
    const b = board()
    const long = { ...b.plan[0], commits: [{ s: 'x'.repeat(90), at: 1 }, { s: 'y'.repeat(90), at: 1 }] }
    for (const p of [b.plan[0], { commits: [] }, long]) assert.deepEqual(cardLines(b, p, ago), pageGraph(b).cardLines(b, p, ago))
    for (const d of [b.derived, { mode: 'areas', days: null, commits: 1 }]) for (const narrow of [true, false]) assert.equal(inferredNote({ derived: d }, narrow), pageGraph(b).inferredNote({ derived: d }, narrow))
  })

  test('the note says how many were left out', () => {
    assert.equal(inferredNote(board(), true), 'Inferred from git, last 7 days: 3 of 9 active branches and worktrees shown, 6 left out.')
    assert.match(inferredNote(board(), false), /14 of 20 worktrees quiet\. A plan adds tasks and progress: npx agenttrail init$/)
  })

  test('an opened card lists its commits, and a live one stays shut until asked', () => {
    const b = board({ touchedAt: NOW - 1000 })
    const p = b.plan[1]
    assert.equal(isUnfolded(b, p, ui(), NOW), false)
    assert.equal(isUnfolded(b, p, ui([p.id]), NOW), true)
    assert.equal(detailHeight(b, p, ui([p.id]), NOW), 89)
    assert.equal(liveCard(b, NOW), p.id, 'a narrow view still goes to it')
  })

  test('a narrow view with nothing live opens on the newest card, not a fit too small to read', () => {
    const b = board()
    assert.equal(liveCard(b, NOW), null)
    assert.equal(openingCard(b, NOW), b.plan[0].id)
    assert.equal(openingCard({ plan: [{ id: 'x', level: 'component' }], runs: [] }, NOW), null, 'a plan keeps its fit')
  })
})

describe('a real Map with no plan', () => {
  const worlds = []
  const world = (files = {}) => {
    const w = tempWorld('')
    worlds.push(w)
    put(w.repo, files)
    return w
  }
  const put = (dir, files) => { for (const [f, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text) } }
  const gitIn = (cwd, ...args) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  const git = (w, ...args) => gitIn(w.repo, ...args)
  const save = (cwd, subject, files) => { put(cwd, files); gitIn(cwd, 'add', '.'); gitIn(cwd, 'commit', '-qm', subject) }
  const committed = (w) => { git(w, 'init', '-q', '-b', 'main'); save(w.repo, 'start', { 'README.md': 'x', '.gitignore': 'out/\n', 'src/a.js': 'x', 'test/a.js': 'x' }); return w }
  // Three branches, two with worktrees, one of those outside the repo's folder.
  const busy = () => {
    const w = committed(world())
    const away = path.join(tempDir('away'), 'feature-wt')
    worlds.push({ cleanup: () => fs.rmSync(path.dirname(away), { recursive: true, force: true }) })
    git(w, 'worktree', 'add', '-q', '-b', 'feat/search', away)
    save(away, 'Add search box', { 'web/search.js': 'x' })
    save(away, 'Rank search results', { 'web/rank.js': 'x', 'api/rank.js': 'x' })
    git(w, 'worktree', 'add', '-q', '-b', 'fix/login', path.join(w.repo, '.wt', 'login'))
    save(path.join(w.repo, '.wt', 'login'), 'Fix login redirect', { 'api/login.js': 'x' })
    git(w, 'branch', 'idea/empty')
    return { ...w, away }
  }
  const lite = async (map) => JSON.parse((await map.get('/board-lite')).body)
  const cardsOf = (map) => until(async () => { const b = await lite(map); return b.plan.length ? b : null }, 'the first cards')
  const hook = (map, id, cwd, file, name = 'PostToolUse') => map.post('/hook', { hook_event_name: name, session_id: id, cwd, tool_name: 'Edit', tool_input: { file_path: file } })
  const start = async (w, env = {}) => startMap({ repo: w.repo, home: w.home, base: await freePortBase(), env: { NODE_OPTIONS: `--import=${POLL_WATCH}`, AGENTTRAIL_GIT_POLL_MS: '150', ...env } })
  const card = (b, title) => b.plan.find(n => n.title === title)
  after(async () => { await stopAll(); for (const w of worlds) w.cleanup() })

  test('every branch and worktree shows, marked as inferred, with commits as written', async () => {
    const w = busy()
    const map = await start(w)
    const b = await cardsOf(map)
    assert.equal(b.hasPlan, false)
    assert.equal(JSON.parse((await map.get('/panel')).body).hasPlan, false)
    assert.deepEqual(JSON.parse((await map.get('/summary')).body).components, [], 'other views still see no plan')
    assert.equal(b.derived.mode, 'streams')
    assert.equal(b.derived.days, null, 'a repo this quiet shows all it has')
    const search = card(b, 'feat/search')
    assert.deepEqual(search.commits.map(c => c.s), ['Rank search results', 'Add search box'])
    assert.match(search.tech, /2 commits · worktree/)
    assert.ok(card(b, 'fix/login'))
    assert.ok(!card(b, 'idea/empty'), 'a branch with nothing of its own is not work')
    assert.ok(search.links.length > 0)
    assert.ok(b.plan.every(n => n.derived && !n.needs.length && n.commits))
  })

  test('uncommitted work in a worktree is counted', async () => {
    const w = busy()
    put(w.away, { 'web/wip.js': 'x' })
    const b = await cardsOf(await start(w))
    assert.match(card(b, 'feat/search').tech, /1 uncommitted/)
  })

  test('Map runs only read-only git commands, leaves the repo as it was, and adds nothing', async () => {
    const w = busy()
    const shimDir = tempDir('shim')
    worlds.push({ cleanup: () => fs.rmSync(shimDir, { recursive: true, force: true }) })
    const real = execFileSync('which', ['git'], { encoding: 'utf8' }).trim()
    const log = path.join(shimDir, 'calls')
    fs.writeFileSync(path.join(shimDir, 'git'), `#!/bin/sh\necho "$@" >> ${log}\nexec ${real} "$@"\n`, { mode: 0o755 })
    const fingerprint = (dir) => {
      const out = []
      const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { const st = fs.statSync(p); out.push(`${p}|${st.size}|${st.mtimeMs}`) } } }
      walk(dir)
      return crypto.createHash('sha1').update(out.sort().join('\n')).digest('hex')
    }
    const look = () => { const seen = [git(w, '--no-optional-locks', 'status', '--porcelain=v2', '--ignored'), git(w, 'worktree', 'list')]; return [...seen, fingerprint(path.join(w.repo, '.git')), fingerprint(w.away)] }
    const before = look()
    const map = await start(w, { PATH: `${shimDir}:${process.env.PATH}`,  })
    await cardsOf(map)
    await new Promise(r => setTimeout(r, 500))
    await map.stop()
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n')
    assert.ok(calls.length >= 6)
    for (const call of calls) {
      assert.match(call, /^--no-optional-locks -c core\.fsmonitor=false -c core\.quotePath=false (rev-parse|for-each-ref|worktree list|log|symbolic-ref|status|ls-files)( |$)/, call)
      assert.doesNotMatch(call, /fetch|pull|push|gc|prune|checkout|repack/, call)
    }
    assert.deepEqual(look(), before)
    assert.ok(!fs.existsSync(path.join(w.repo, 'PLAN.md')))
    assert.ok(!fs.existsSync(path.join(w.repo, '.agenttrail')))
  })

  test('a new commit shows from polling alone, and cards keep their places', async () => {
    const w = busy()
    const map = await start(w)
    const b = await cardsOf(map)
    const order = b.plan.filter(n => n.stream).map(n => n.title)
    save(path.join(w.repo, '.wt', 'login'), 'Keep the session cookie', { 'api/cookie.js': 'x' })
    const c = await until(async () => { const m = await lite(map); return card(m, 'fix/login')?.commits.length === 2 ? m : null }, 'the new commit')
    assert.equal(card(c, 'fix/login').commits[0].s, 'Keep the session cookie')
    assert.deepEqual(c.plan.filter(n => n.stream).map(n => n.title), order)
  })

  test('a session in a worktree outside the repo folder lands on its card, with no plan', async () => {
    const w = busy()
    const map = await start(w)
    const b = await cardsOf(map)
    assert.equal((await hook(map, 's1', w.away, path.join(w.away, 'web/search.js'))).status, 200)
    await hook(map, 'elsewhere', tempDir('other'), '/nowhere/a.js')
    const m = await lite(map)
    const run = m.runs.find(r => r.id === 's1')
    const search = card(b, 'feat/search')
    assert.equal(run.componentId, search.id)
    assert.ok(!m.runs.some(r => r.id === 'elsewhere'))
    assert.equal(card(m, 'feat/search').touchedAt > 0, true)
    assert.equal(card(m, 'feat/search').recent[0].file, 'web/search.js')
    assert.equal(m.plan.find(n => n.path === 'web')?.recent[0].file, 'web/search.js')
    assert.deepEqual(boardEdges(m, boardLayout(m, ui(), Date.now()), Date.now()).trails, [])
  })

  test('a session from a local log, in a worktree, is matched too', async () => {
    const w = busy()
    const logs = path.join(w.home, '.claude', 'projects', 'p')
    fs.mkdirSync(logs, { recursive: true })
    const at = new Date().toISOString()
    fs.writeFileSync(path.join(logs, 's.jsonl'), `${JSON.stringify({ type: 'user', sessionId: 'log1', cwd: w.away, timestamp: at, message: { role: 'user', content: 'go on' } })}\n`)
    const map = await start(w)
    const m = await until(async () => { const x = await lite(map); return x.runs.some(r => r.id === 'log1' && r.componentId) ? x : null }, 'the session to land on a card', 15000)
    assert.equal(m.runs.find(r => r.id === 'log1').componentId, card(m, 'feat/search').id)
  })

  test('a session in a worktree with no recent commits still gets a card', async () => {
    const w = busy()
    const quiet = path.join(path.dirname(w.away), 'quiet-wt')
    git(w, 'worktree', 'add', '-q', '-b', 'chore/quiet', quiet)
    const map = await start(w)
    await cardsOf(map)
    await hook(map, 's1', quiet, path.join(quiet, 'src/a.js'), 'PreToolUse')
    const m = await until(async () => { const x = await lite(map); return card(x, 'chore/quiet') ? x : null }, 'the card', 10000)
    assert.match(card(m, 'chore/quiet').tech, /no new commits/)
    assert.equal(card(m, 'chore/quiet').commits[0].s, 'start')
  })

  test('a session in a folder holding worktrees lands on the one it writes in', async () => {
    const w = busy()
    const home = path.dirname(w.away)
    git(w, 'worktree', 'add', '-q', '-b', 'chore/two', path.join(home, 'two-wt'))
    const map = await start(w)
    await cardsOf(map)
    await hook(map, 's1', home, path.join(w.away, 'web/search.js'))
    await hook(map, 's1', home, path.join(w.away, 'web/rank.js'))
    const m = await lite(map)
    assert.equal(m.runs.find(r => r.id === 's1').componentId, card(m, 'feat/search').id)
  })

  test('one branch draws area cards with its subjects', async () => {
    const w = committed(world())
    save(w.repo, 'Add the importer', { 'lib/import.js': 'x' })
    const b = await cardsOf(await start(w))
    assert.equal(b.derived.mode, 'areas')
    assert.ok(b.plan.every(n => !n.stream && n.commits.length))
    assert.ok(b.plan.some(n => n.path === 'lib' && n.commits[0].s === 'Add the importer'))
  })

  test('a session on one branch lands on the area it writes in', async () => {
    const w = committed(world())
    save(w.repo, 'Add the importer', { 'lib/import.js': 'x' })
    const map = await start(w)
    const b = await cardsOf(map)
    await hook(map, 's1', w.repo, path.join(w.repo, 'lib/import.js'))
    assert.equal((await lite(map)).runs[0].componentId, b.plan.find(n => n.path === 'lib').id)
  })

  test('a folder not in git and an empty repo keep the Watching view, until a first commit', async () => {
    const plain = await start(world({ 'lib/a.js': 'x', 'lib/b.js': 'x' }))
    await until(async () => (await lite(plain)).derived?.git === false, 'the look at git')
    assert.deepEqual((await lite(plain)).plan, [])
    const w = world()
    git(w, 'init', '-q', '-b', 'main')
    const empty = await start(w)
    await until(async () => (await lite(empty)).derived?.git === true, 'the look at git')
    assert.deepEqual((await lite(empty)).plan, [])
    save(w.repo, 'First commit', { 'first.js': 'x' })
    const b = await cardsOf(empty)
    assert.equal(b.plan[0].commits[0].s, 'First commit')
  })

  test('ignored files and other worktrees stay off the main worktree\'s live activity', async () => {
    const w = busy()
    put(w.repo, { 'out/junk.js': 'x' })
    const map = await start(w)
    await cardsOf(map)
    await new Promise(r => setTimeout(r, 300))
    fs.writeFileSync(path.join(w.repo, 'out', 'junk.js'), 'y')
    fs.writeFileSync(path.join(w.repo, '.wt', 'login', 'api', 'login.js'), 'y')
    fs.writeFileSync(path.join(w.repo, 'src', 'a.js'), 'y')
    const seen = await until(async () => { const m = await lite(map); return m.recentActivity.some(a => a.file === 'src/a.js') ? m : null }, 'the write to show')
    assert.deepEqual(seen.recentActivity.map(a => a.file), ['src/a.js'])
  })

  test('restarting keeps the same cards in the same places', async () => {
    const w = busy()
    const map = await start(w)
    const b = await cardsOf(map)
    await map.stop()
    const c = await cardsOf(await start(w))
    assert.deepEqual(c.plan.map(n => [n.id, n.col]), b.plan.map(n => [n.id, n.col]))
  })

  test('a plan takes over at once, and removing it brings the cards back', async () => {
    const w = busy()
    const map = await start(w)
    await cardsOf(map)
    await hook(map, 's1', w.repo, path.join(w.repo, 'src/a.js'))
    fs.writeFileSync(path.join(w.repo, 'PLAN.md'), '# p\n\n## Do a thing {#thing}\n- [ ] One {#one}\n- [ ] Two {#two}\n')
    const planned = await until(async () => { const m = await lite(map); return m.hasPlan ? m : null }, 'the plan')
    assert.ok(!('derived' in planned))
    assert.deepEqual(planned.plan.map(n => n.id), ['thing', 'one', 'two'])
    assert.ok(!planned.plan.some(n => 'col' in n || 'commits' in n))
    assert.equal(planned.runs[0].componentId, null)
    fs.rmSync(path.join(w.repo, 'PLAN.md'))
    await until(async () => { const m = await lite(map); return !m.hasPlan && m.plan.some(n => n.derived) }, 'the cards to return')
  })

  test('Recent files is right with a plan too: each file once, no folders', async () => {
    const w = committed(world({ 'PLAN.md': '# p\n\n## Thing {#thing}\nfiles: [src/**]\n- [ ] One {#one}\n- [ ] Two {#two}\n' }))
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

  test('a repo with a plan gets nothing inferred, and reads no git', async () => {
    const w = busy()
    put(w.repo, { 'PLAN.md': '# p\n\n## Set up the project {#setup}\n- [ ] First task {#setup-first}\n' })
    const map = await start(w, { PATH: '/nonexistent' })
    await hook(map, 's1', w.repo, path.join(w.repo, 'src/a.js'))
    await hook(map, 'other', w.away, path.join(w.away, 'web/search.js'))
    await new Promise(r => setTimeout(r, 300))
    const m = await lite(map)
    assert.ok(!('derived' in m))
    assert.deepEqual(m.plan.map(n => n.id), ['setup', 'setup-first'])
    assert.deepEqual(Object.keys(m.plan[0]).sort(), ['by', 'files', 'filesList', 'id', 'kind', 'level', 'links', 'needs', 'parent', 'recent', 'status', 'tech', 'title', 'touchedAt', 'url'])
    assert.deepEqual(m.runs.map(r => r.id), ['s1'], 'a plan only hears the repo itself')
    assert.ok(!('place' in m.runs[0]) && !('areaCard' in m.runs[0]))
  })
})

describe('public repo safety', () => {
  const b = (s) => Buffer.from(s, 'base64').toString()
  test('the scan catches what it should, and leaves the ordinary verb alone', () => {
    assert.equal(hits(`+a ${b('SmFydmlz')} line\n-${b('SmFydmlz')}\n+++ b/file\n context`).length, 1)
    assert.equal(hits(`+${b('SGVhcmQ=')} app\n`).length, 1)
    assert.equal(hits(`+Map ${b('SGVhcmQ=').toLowerCase()} nothing\n`).length, 0)
  })

  test('nothing from a private repo is on this branch', () => {
    assert.deepEqual(scan(ROOT), [])
  })
})
