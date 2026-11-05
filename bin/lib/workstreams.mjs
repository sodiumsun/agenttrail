// What is really being worked on in a repo with no PLAN.md, read from git across every
// branch and worktree. A workstream is a branch or worktree with commits of its own, or with
// an agent session in it. Pure: git-scan.mjs does the reading. A card goes in where a plan's
// component goes and a branch's lineage where a plan's `needs` go, so the page and the Herdr
// mod lay out and draw it with the code a plan uses.
import crypto from 'node:crypto'
import path from 'node:path'
import { IGNORE, MAX_AREAS, TMP_FILE, areaId, areaTitle, chooseAreas, describeAreas, fitPath, ownerOf } from './areas.mjs'

export const WINDOWS = [7, 30, 90, 365] // days; a quiet repo widens until it has something to say
export const ENOUGH_COMMITS = 5
export const MAX_COMMITS = 4000
export const MAX_SHAPE = 20000 // commits read for lineage and counts: names cost, parents do not
export const MAX_STREAMS = 8 // a handful, however many branches a repo keeps
const STREAM_AREAS = 8 // folders a workstream can name; a repo with one branch gets MAX_AREAS cards
const SHOWN_COMMITS = 6
const MAX_FILES = 300 // of one commit: past this it is a bulk move, and more names add nothing
const TOP_LINE = 33 // what a card's top line holds beside its status, in the page and the mod
const FOOT_LINE = 40 // what its bottom line holds beside SHOW COMMITS
const TRUNKS = ['main', 'master', 'trunk'] // beside origin/HEAD, which can be years stale

export const streamId = (key) => `ws-${crypto.createHash('sha1').update(key).digest('hex').slice(0, 10)}`
const branchName = (ref) => ref.replace(/^refs\/heads\//, '').replace(/^refs\/remotes\/[^/]+\//, '')
const counted = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`
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

// Which workstream each commit belongs to. The trunk's own line belongs to no branch. A branch
// keeps its first-parent line, the newest tip first, down to the trunk's line or to where
// another branch starts, so a branch stacked on another takes only what is new, and an
// integration branch does not swallow the branches merged into it. That holds for work that
// has since landed too, which is how a card can say how much of it did. Then whatever only a
// merge reaches goes to the tip that merged it.
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
  const trunkLine = new Set()
  for (let sha of trunkShas) while (byHash.has(sha) && !trunkLine.has(sha)) { trunkLine.add(sha); sha = byHash.get(sha).parents[0] }
  const landedWork = new Set([...landed].map((sha) => sameWork(byHash.get(sha))))
  const owner = new Map()
  const order = [...tips].filter((t) => !t.trunk).sort((a, b) => b.ct - a.ct || (a.key < b.key ? -1 : 1))
  const starts = new Set(order.map((t) => t.sha))
  for (const t of order) {
    for (let at = t.sha; byHash.has(at) && !trunkLine.has(at) && !owner.has(at) && (at === t.sha || !starts.has(at)); at = byHash.get(at).parents[0]) owner.set(at, t.key)
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

// Where a branch left the line it grew from: the workstream that owns the commit below its
// own, looking through branches with no card, or none when that is the trunk or out of sight.
export function grewFrom(tip, tips, byHash, owner, shown) {
  const seen = new Set()
  for (let t = tip; t && !seen.has(t.key);) {
    seen.add(t.key)
    let at = t.sha
    while (byHash.has(at) && owner.get(at) === t.key) at = byHash.get(at).parents[0]
    const key = owner.get(at)
    if (key && shown.has(key) && key !== tip.key) return key
    t = tips.get(key)
  }
  return null
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

// The folders a card names, as many as its top line holds.
export function folderLine(paths, room = TOP_LINE) {
  const named = paths.filter(Boolean)
  const line = (n) => `${named.slice(0, n).join(', ')}${named.length > n ? ` +${named.length - n}` : ''}`
  if (!named.length) return paths.length ? 'Repo root' : ''
  for (let n = named.length; n > 0; n--) if (line(n).length <= room) return line(n)
  const more = named.length > 1 ? ` +${named.length - 1}` : ''
  return `${fitPath(named[0], room - more.length)}${more}`
}

// `commits` are the window's, with their files. `shape` is the wider history with no files,
// for what a window would cut short: how much of a branch there is, and where it began.
// `live` is the worktrees with an agent working in them: those always get a card.
// `keep` holds the last areas and order, while cards are not yet due to move.
export function readHistory({ refs, worktrees, commits, shape = null, originHead = null, live = [], keep = null, days = WINDOWS[0], maxStreams = MAX_STREAMS }) {
  const byHash = new Map((shape ?? []).map((c) => [c.sha, c]))
  for (const c of commits) byHash.set(c.sha, c)
  const trunks = trunkNames(refs, originHead, worktrees)
  const { tips, owners } = findTips(refs, worktrees, byHash, trunks)
  const trunkShas = refs.filter((r) => trunks.has(branchName(r.ref))).map((r) => r.sha)
  const { landed, landedWork, owner } = assignCommits(byHash, tips.values(), trunkShas)
  const hasLanded = (c) => landed.has(c.sha) || landedWork.has(sameWork(c))
  const inRange = new Set(commits.map((c) => c.sha))
  const real = commits.filter((c) => realCommit(c) && (c.files.length || !c.parents.length))
  const trunk = [...tips.values()].filter((t) => t.trunk).sort((a, b) => b.ct - a.ct)[0] ?? null
  const inWindow = new Set()
  const lines = new Map() // a workstream's commits, whatever the window
  const add = (key, c) => { if (!lines.has(key)) lines.set(key, []); lines.get(key).push(c) }
  for (const c of real) {
    c.landed = hasLanded(c)
    const key = owner.get(c.sha) ?? (c.landed ? trunk?.key : undefined)
    if (key) inWindow.add(key)
  }
  for (const c of shape ? [...byHash.values()].filter(realCommit) : real) {
    c.landed = hasLanded(c)
    if (owner.has(c.sha)) add(owner.get(c.sha), c)
  }
  const liveKeys = new Set(live.map((root) => owners[root]).filter(Boolean))
  const describe = (t) => {
    const own = (lines.get(t.key) ?? []).sort((a, b) => b.ct - a.ct)
    const landedCount = own.filter((c) => c.landed).length
    return { tip: t, own, key: t.key, at: own[0]?.ct ?? 0, live: liveKeys.has(t.key), landed: landedCount, open: own.length - landedCount }
  }
  const active = [...tips.values()].filter((t) => !t.trunk && (inWindow.has(t.key) || liveKeys.has(t.key))).map(describe)
  const ranked = active.sort((a, b) => b.live - a.live || Boolean(b.open) - Boolean(a.open) || b.at - a.at || (a.key < b.key ? -1 : 1))
  const shown = keepOrder(ranked.slice(0, maxStreams), keep?.order)

  const seen = new Set()
  const work = real.filter((c) => { const k = sameWork(c); if (seen.has(k)) return false; seen.add(k); return true })
  const lone = !active.length
  const held = keep?.areas?.length ? describeAreas(keep.areas, work) : []
  const areas = held.length ? held : describeAreas(chooseAreas(work, lone ? MAX_AREAS : STREAM_AREAS), work)
  const index = new Map(areas.map((a) => [a.path, a.path]))

  const touched = (own) => {
    const hits = new Map()
    // A folder too quiet for an area of its own is still where the work was, so it keeps its name.
    const folder = (f) => ownerOf(index, f) || (f.includes('/') ? f.slice(0, f.indexOf('/')) : '')
    for (const c of own) for (const p of new Set(c.files.map(folder))) hits.set(p, (hits.get(p) || 0) + 1)
    return [...hits].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([p]) => p)
  }
  const stream = ({ tip, own, at, key, live: isLive, landed: done }, parent) => ({
    key, id: streamId(key), name: tip.name, at, commits: own.length, lately: own.filter((c) => inRange.has(c.sha)).length, landed: done, live: isLive, parent,
    recent: own.slice(0, SHOWN_COMMITS).map((c) => ({ s: c.s, at: c.ct, landed: c.landed })),
    worktree: tip.worktree, remote: !tip.local, detached: Boolean(tip.detached), trunk: tip.trunk, head: tip.sha,
    folders: touched(own), sample: [...new Set(own.flatMap((c) => c.files))].slice(0, 24),
  })
  const shownKeys = new Set(shown.map((s) => s.key))
  const rootId = trunk ? streamId(trunk.key) : null
  const streams = shown.map((s) => {
    const from = grewFrom(s.tip, tips, byHash, owner, shownKeys)
    return stream(s, from ? streamId(from) : rootId)
  })
  if (trunk && !lone) {
    const own = real.filter((c) => c.landed).sort((a, b) => b.ct - a.ct)
    streams.unshift(stream({ tip: trunk, own, at: own[0]?.ct ?? 0, key: trunk.key, live: liveKeys.has(trunk.key), landed: own.length }, null))
  }
  // Work that all landed takes a spare card, and is only counted if it got one: it is not going on.
  const going = active.filter((s) => s.open || s.live).length
  const quietKeys = new Set([...active.filter((s) => s.open || s.live).map((s) => s.key), ...shownKeys, ...(trunk && inWindow.has(trunk.key) ? [trunk.key] : [])])
  return {
    mode: lone ? 'areas' : 'streams', days, streams: lone ? [] : streams, areas,
    worktrees: Object.fromEntries(Object.entries(owners).map(([root, key]) => [root, streamId(key)])),
    counts: {
      commits: work.length, active: Math.max(going, shown.length), shown: lone ? 0 : shown.length,
      worktrees: worktrees.length, quiet: Object.values(owners).filter((k) => !quietKeys.has(k)).length,
    },
  }
}

const card = (fields) => ({ level: 'component', parent: null, needs: [], links: [], files: [], by: '', kind: '', url: '', status: 'pending', derived: true, ...fields })
const columnsFor = (n) => n < 2 ? 1 : Math.max(2, Math.min(4, Math.ceil(Math.sqrt(n / 2))))

const span = (days) => days ? `in ${days} days` : 'in all'
const activity = (n, days) => n ? `${counted(n, 'commit')} ${span(days)}` : `No commits ${span(days)}`

// A card's bottom line says what its bar measures, then what else git knows, as far as it fits.
function streamFoot(s, days, top, alone) {
  const flag = [s.remote ? 'remote' : s.detached ? 'detached' : '', s.dirty ? `${s.dirty} uncommitted` : ''].filter(Boolean).join(' · ')
  const line = (...parts) => parts.filter(Boolean).join(' · ')
  const plain = activity(s.lately, days)
  if (s.trunk) return [line(flag, s.lately ? `${plain}, all landed` : plain), line(flag, plain)].find((l) => l.length <= FOOT_LINE) ?? plain
  const said = alone && s.lately === top ? `Busiest: ${plain}` : plain
  const landing = s.landed ? `${s.landed} of ${s.commits} landed` : ''
  return [line(flag, said, landing), line(flag, said), line(flag, plain)].find((l) => l.length <= FOOT_LINE) ?? plain
}

// Nothing here says what done would be, so a bar never claims progress. It is how many commits
// a branch had in the window, against the busiest card. The trunk is not one of the race.
const streamCard = (s, days, top, alone) => {
  const latest = s.recent[0] ?? s.last
  return card({
    id: s.id, title: s.name, sample: s.sample, stream: true, needs: s.parent ? [s.parent] : [],
    tech: folderLine(s.folders) || (s.worktree ? 'worktree' : 'branch'),
    meta: latest?.s || 'No new commits', foot: streamFoot(s, days, top, alone), bar: s.trunk ? null : { n: s.lately, of: top },
    landed: s.landed, total: s.commits, status: s.commits && s.landed === s.commits ? 'done' : 'pending',
    commits: s.recent.length ? s.recent : s.last ? [s.last] : [], at: s.at || s.last?.at || 0,
  })
}

// Parents before their children, so stacked branches line up and their connectors do not cross.
function treeOrder(streams) {
  const ids = new Set(streams.map((s) => s.id))
  const under = (id) => streams.filter((s) => (ids.has(s.parent) ? s.parent : null) === id).flatMap((s) => [s, ...under(s.id)])
  return under(null)
}

// The same keys parsePlan gives a component, plus `meta` for the line under the title, its
// latest commit, `at` for how old that is, `bar` as `n` of `of` or null for none, `foot` for
// the words on what the bar measures, and `commits` as written. A branch's connector is a
// `needs`, to what it grew from. A folder has no lineage, so it gets a grid place from `col`,
// and its bar is its share of the repo's commits.
export function boardNodes(scan) {
  if (!scan?.mode) return []
  if (scan.mode === 'streams') {
    const branches = scan.streams.filter((s) => !s.trunk)
    const top = Math.max(0, ...branches.map((s) => s.lately))
    const alone = top > 0 && branches.filter((s) => s.lately === top).length === 1 && branches.length > 1 // a tie has no busiest
    return treeOrder(scan.streams).map((s) => streamCard(s, scan.days, top, alone))
  }
  const columns = columnsFor(scan.areas.length)
  const total = scan.counts?.commits ?? 0
  return scan.areas.map((a, i) => card({
    id: areaId(a.path), title: areaTitle(a), path: a.path, col: i % columns, sample: a.sample,
    tech: counted(a.files, 'file'), meta: a.recent[0]?.s || 'No new commits', foot: `${a.commits} of ${counted(Math.max(total, a.commits), 'commit')} here`,
    bar: { n: a.commits, of: Math.max(total, a.commits) }, landed: a.commits, total: Math.max(total, a.commits), commits: a.recent, at: a.recent[0]?.at ?? 0,
  }))
}
