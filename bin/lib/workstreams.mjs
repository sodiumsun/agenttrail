// What is really being worked on in a repo with no PLAN.md, read from git across every
// branch and worktree. A workstream is a branch or worktree with commits of its own, or with
// an agent session in it. Pure: git-scan.mjs does the reading. A card goes in where a plan's
// component goes, so the page and the Herdr mod draw it with the code they already have.
import crypto from 'node:crypto'
import path from 'node:path'
import { IGNORE, MAX_AREAS, TMP_FILE, areaId, areaTitle, chooseAreas, describeAreas, ownerOf } from './areas.mjs'

export const WINDOWS = [7, 30, 90, 365] // days; a quiet repo widens until it has something to say
export const ENOUGH_COMMITS = 5
export const MAX_COMMITS = 4000
export const MAX_STREAMS = 8 // a handful, however many branches a repo keeps
const STREAM_AREAS = 8 // beside a column of workstreams; a repo with one branch gets MAX_AREAS
const MAX_LINKS = 2 // connectors from one workstream: its most touched areas, and still followable
const LINK_SHARE = 0.1 // of a workstream's commits: less than this is passing through
const SHOWN_COMMITS = 6
const MAX_FILES = 300 // of one commit: past this it is a bulk move, and more names add nothing
const TITLE_MAX = 34
const TRUNKS = ['main', 'master', 'trunk'] // beside origin/HEAD, which can be years stale

export const streamId = (key) => `ws-${crypto.createHash('sha1').update(key).digest('hex').slice(0, 10)}`
const branchName = (ref) => ref.replace(/^refs\/heads\//, '').replace(/^refs\/remotes\/[^/]+\//, '')
const counted = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`
const cut = (text, room) => text.length > room ? `${text.slice(0, room - 1)}…` : text
// A rebase or a cherry-pick changes the hash but keeps these two, so it is the same work.
const sameWork = (c) => `${c.at}|${c.s}`

export function parseRefs(text) {
  return text.split('\n').filter(Boolean).map((line) => {
    const [sha, ref] = line.split('\0')
    return { sha, ref }
  })
}

export function parseWorktrees(text) {
  const list = []
  let at = null
  for (const line of text.split('\n')) {
    if (line.startsWith('worktree ')) list.push(at = { path: line.slice(9), head: null, branch: null })
    else if (!at) continue
    else if (line.startsWith('HEAD ')) at.head = line.slice(5)
    else if (line.startsWith('branch ')) at.branch = line.slice(7)
    else if (line === 'bare') at.bare = true
  }
  return list.filter((w) => !w.bare)
}

export const LOG_FORMAT = '%x01%H%x00%P%x00%ct%x00%at%x00%s'
export function parseLog(text, prefix = '') {
  const out = []
  for (const block of text.split('\x01')) {
    if (!block) continue
    const [head, ...names] = block.split('\n')
    const [sha, parents, ct, at, s] = head.split('\0')
    if (!sha) continue
    const files = names.filter(Boolean).slice(0, MAX_FILES)
      .filter((f) => f.startsWith(prefix)).map((f) => f.slice(prefix.length))
      .filter((f) => !IGNORE.test(f) && !TMP_FILE.test(f))
    out.push({ sha, parents: parents ? parents.split(' ') : [], ct: Number(ct) * 1000, at: Number(at) * 1000, s: s ?? '', files })
  }
  return out
}
const realCommit = (c) => c.parents.length < 2 // a merge commit repeats work, and says little

function trunkNames(refs, originHead, worktrees) {
  const names = new Set(refs.map((r) => branchName(r.ref)).filter((n) => TRUNKS.includes(n)))
  if (originHead) names.add(branchName(originHead))
  if (!names.size && worktrees[0]?.branch) names.add(branchName(worktrees[0].branch))
  return names
}

// One entry per branch name, however many remotes carry it, plus each worktree that is on
// no branch. A detached worktree sitting on a branch's tip is just that branch.
function findTips(refs, worktrees, byHash, trunks) {
  const tips = new Map()
  for (const { sha, ref } of refs) {
    const name = branchName(ref)
    if (name === 'HEAD') continue
    const ct = byHash.get(sha)?.ct ?? 0
    const had = tips.get(name)
    const local = ref.startsWith('refs/heads/')
    if (!had) tips.set(name, { key: name, name, sha, ct, local, trunk: trunks.has(name), worktree: null, shas: new Set([sha]) })
    else {
      had.shas.add(sha)
      had.local ||= local
      if (ct > had.ct) Object.assign(had, { sha, ct })
    }
  }
  const owners = {}
  for (const w of worktrees) {
    let tip = w.branch ? tips.get(branchName(w.branch)) : [...tips.values()].find((t) => t.shas.has(w.head))
    if (!tip) {
      const key = w.branch ? branchName(w.branch) : `worktree:${w.path}`
      tip = { key, name: w.branch ? key : path.basename(w.path), sha: w.head, ct: byHash.get(w.head)?.ct ?? 0, local: true, trunk: false, worktree: null, shas: new Set([w.head]), detached: !w.branch }
      tips.set(key, tip)
    }
    tip.worktree ??= w.path
    owners[w.path] = tip.key
  }
  return { tips, owners }
}

// Which workstream each commit belongs to. What reached the trunk has landed. Of the rest, a
// branch keeps its own first-parent line, the newest tip first, so a branch stacked on
// another takes only what is new, and an integration branch does not swallow the feature
// branches merged into it. Then whatever only a merge reaches goes to the tip that merged it.
export function assignCommits(byHash, tips, trunkShas) {
  const landed = new Set()
  const stack = [...trunkShas]
  while (stack.length) {
    const sha = stack.pop()
    const c = byHash.get(sha)
    if (!c || landed.has(sha)) continue
    landed.add(sha)
    stack.push(...c.parents)
  }
  const landedWork = new Set([...landed].map((sha) => sameWork(byHash.get(sha))))
  const owner = new Map()
  const order = [...tips].filter((t) => !t.trunk).sort((a, b) => b.ct - a.ct || (a.key < b.key ? -1 : 1))
  for (const t of order) {
    for (let at = t.sha; byHash.has(at) && !landed.has(at) && !owner.has(at);) {
      const c = byHash.get(at)
      if (landedWork.has(sameWork(c))) { at = c.parents[0]; continue }
      owner.set(at, t.key)
      at = c.parents[0]
    }
  }
  const walked = new Set()
  for (const t of order) {
    const todo = [t.sha]
    while (todo.length) {
      const sha = todo.pop()
      const c = byHash.get(sha)
      if (!c || walked.has(sha) || landed.has(sha) || (owner.has(sha) && owner.get(sha) !== t.key)) continue
      walked.add(sha)
      if (!owner.has(sha) && !landedWork.has(sameWork(c))) owner.set(sha, t.key)
      todo.push(...c.parents)
    }
  }
  return { landed, landedWork, owner }
}

// Cards keep their places between looks at the repo: what was there stays in order, and
// what is new goes on top. Only the periodic full ranking moves them.
export function keepOrder(list, order) {
  if (!order?.length) return list
  const place = new Map(order.map((key, i) => [key, i]))
  const fresh = list.filter((s) => !place.has(s.key))
  const known = list.filter((s) => place.has(s.key)).sort((a, b) => place.get(a.key) - place.get(b.key))
  return [...fresh, ...known]
}

// `live` is the worktrees with an agent working in them: those always get a card.
// `keep` holds the last areas and order, while cards are not yet due to move.
export function readHistory({ refs, worktrees, commits, originHead = null, live = [], keep = null, days = WINDOWS[0], maxStreams = MAX_STREAMS }) {
  const byHash = new Map(commits.map((c) => [c.sha, c]))
  const trunks = trunkNames(refs, originHead, worktrees)
  const { tips, owners } = findTips(refs, worktrees, byHash, trunks)
  const trunkShas = refs.filter((r) => trunks.has(branchName(r.ref))).map((r) => r.sha)
  const { landed, landedWork, owner } = assignCommits(byHash, tips.values(), trunkShas)
  const real = commits.filter((c) => realCommit(c) && (c.files.length || !c.parents.length))
  const trunk = [...tips.values()].filter((t) => t.trunk).sort((a, b) => b.ct - a.ct)[0] ?? null
  const groups = new Map()
  const add = (key, c) => { if (!groups.has(key)) groups.set(key, []); groups.get(key).push(c) }
  for (const c of real) {
    const key = landed.has(c.sha) || landedWork.has(sameWork(c)) ? trunk?.key : owner.get(c.sha)
    c.on = key ? tips.get(key)?.name : undefined
    if (key) add(key, c)
  }
  const liveKeys = new Set(live.map((root) => owners[root]).filter(Boolean))
  const active = [...tips.values()].filter((t) => groups.has(t.key) || liveKeys.has(t.key)).map((t) => {
    const own = (groups.get(t.key) ?? []).sort((a, b) => b.ct - a.ct)
    return { tip: t, own, key: t.key, at: own[0]?.ct ?? 0, live: liveKeys.has(t.key) }
  })
  const ranked = active.sort((a, b) => b.live - a.live || b.at - a.at || (a.key < b.key ? -1 : 1))
  const shown = keepOrder(ranked.slice(0, maxStreams), keep?.order)

  const seen = new Set()
  const work = real.filter((c) => { const k = sameWork(c); if (seen.has(k)) return false; seen.add(k); return true })
  const lone = active.length < 2 && (!active.length || active[0].tip.trunk)
  const held = keep?.areas?.length ? describeAreas(keep.areas, work) : []
  const areas = held.length ? held : describeAreas(chooseAreas(work, lone ? MAX_AREAS : STREAM_AREAS), work)
  const index = new Map(areas.map((a) => [a.path, a.path]))

  const streams = shown.map(({ tip, own, at, key, live: isLive }) => {
    const hits = new Map()
    for (const c of own) for (const p of new Set(c.files.map((f) => ownerOf(index, f)).filter((p) => p !== null))) hits.set(p, (hits.get(p) || 0) + 1)
    const links = [...hits].filter(([, n]) => n >= Math.max(1, own.length * LINK_SHARE)).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, MAX_LINKS).map(([p]) => p)
    return {
      key, id: streamId(key), name: tip.name, at, commits: own.length, live: isLive,
      recent: own.slice(0, SHOWN_COMMITS).map((c) => ({ s: c.s, at: c.ct })),
      worktree: tip.worktree, remote: !tip.local, detached: Boolean(tip.detached), trunk: tip.trunk, head: tip.sha,
      links, sample: [...new Set(own.flatMap((c) => c.files))].slice(0, 24),
    }
  })
  const activeKeys = new Set(active.map((s) => s.key))
  return {
    mode: lone ? 'areas' : 'streams', days, streams: lone ? [] : streams, areas,
    worktrees: Object.fromEntries(Object.entries(owners).map(([root, key]) => [root, streamId(key)])),
    counts: {
      commits: work.length, active: active.length, shown: lone ? 0 : streams.length,
      worktrees: worktrees.length, quiet: Object.values(owners).filter((k) => !activeKeys.has(k)).length,
    },
  }
}

const streamTech = (s) => [
  s.commits ? (s.trunk ? `${counted(s.commits, 'commit')} landed` : counted(s.commits, 'commit')) : 'no new commits',
  s.remote ? 'remote' : s.detached ? 'detached' : s.worktree ? 'worktree' : '',
  s.dirty ? `${s.dirty} uncommitted` : '',
].filter(Boolean).join(' · ')

const card = (fields) => ({ level: 'component', parent: null, needs: [], links: [], files: [], by: '', kind: '', url: '', status: 'pending', derived: true, ...fields })
const columnsFor = (n) => n < 2 ? 1 : Math.max(2, Math.min(4, Math.ceil(Math.sqrt(n / 2))))

// The same keys parsePlan gives a component, plus `col` for a place on the grid, `commits`
// with their subjects as written, and `at`. `links` draw a workstream's connectors.
export function boardNodes(scan) {
  if (!scan?.mode) return []
  const streams = scan.mode === 'streams'
  const columns = streams ? 1 : columnsFor(scan.areas.length)
  const areaCards = scan.areas.map((a, i) => card({
    id: areaId(a.path), title: areaTitle(a), path: a.path, col: streams ? 1 : i % columns, sample: a.sample,
    tech: [counted(a.commits, 'commit'), streams && a.branches ? counted(a.branches, 'branch', 'branches') : ''].filter(Boolean).join(' · '),
    commits: a.recent, at: a.recent[0]?.at ?? 0,
  }))
  const known = new Set(areaCards.map((a) => a.path))
  return [
    ...scan.streams.map((s) => card({
      id: s.id, title: cut(s.name, TITLE_MAX), col: 0, sample: s.sample, tech: streamTech(s), stream: true,
      links: s.links.filter((p) => known.has(p)).map(areaId),
      commits: s.recent.length ? s.recent : s.last ? [s.last] : [], at: s.at || s.last?.at || 0,
    })),
    ...areaCards,
  ]
}
