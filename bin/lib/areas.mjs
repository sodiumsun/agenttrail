// The code areas of a repo with no PLAN.md, taken from what its commits touched. An area is
// a real folder and a card only reports what git recorded, so nothing here claims meaning or
// progress. The input is commits rather than a file listing: a folder nobody touched has
// nothing to say, and a folder that only exists on another branch still counts.
import crypto from 'node:crypto'

export const IGNORE = /(^|\/)(\.git|node_modules|\.agenttrail|dist|build|\.next|__pycache__|\.venv|\.build|\.pytest_cache|\.ruff_cache|\.cache|\.DS_Store)(\/|$)/
// editor and tool atomic-write droppings, not real activity targets
export const TMP_FILE = /(\.tmp(\.|$)|~$|\.swp$|\.swx$|(^|\/)\.#|(^|\/)#.+#$|\.DS_Store$)/

export const MAX_AREAS = 12
const KID_SHARE = 0.03 // of all commits: a folder needs this to come out as its own card
const LONGER_NAME = 0.6 // of its parent's commits
const DEPTH_COST = 0.25
const FEW_CARDS = 3
const SLIVER_SHARE = 0.01
const SAMPLE = 24
const RECENT = 6
const TITLE_MAX = 28 // both the page and the mod draw this many characters of a title

const folders = (file) => {
  const parts = file.split('/').slice(0, -1)
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'))
}

// The one area a file belongs to: its deepest folder with a card.
export function ownerOf(index, file) {
  let at = file
  while (at) {
    const cut = at.lastIndexOf('/')
    at = cut < 0 ? '' : at.slice(0, cut)
    if (index.has(at)) return index.get(at)
  }
  return null
}

function folderTree(commits) {
  const kids = new Map() // folder -> its child folders
  const hits = new Map() // folder -> commits that touched something under it
  const own = new Set() // folders with a file directly in them
  for (const c of commits) {
    const seen = new Set([''])
    for (const file of c.files) {
      const chain = folders(file)
      own.add(chain.at(-1) ?? '')
      for (let i = 0; i < chain.length; i++) {
        seen.add(chain[i])
        const up = i ? chain[i - 1] : ''
        if (!kids.has(up)) kids.set(up, new Set())
        kids.get(up).add(chain[i])
      }
    }
    for (const f of seen) hits.set(f, (hits.get(f) || 0) + 1)
  }
  return { kids, hits, own }
}

// Which folders get cards. One at a time, the busiest folder not yet on a card comes out of
// the card holding it, so a repo's cards go where its commits are, at whatever depth that is,
// and a quiet top-level folder never crowds out a busy one further down. What is not split
// off stays with the folder above. A commit counts once per folder, so one that moved a
// thousand files weighs what any other commit weighs.
export function chooseAreas(commits, max = MAX_AREAS) {
  const list = commits.filter((c) => c.files.length)
  if (!list.length) return []
  const shape = folderTree(list)
  // Many equal folders each fall short of the bar, so a repo like that gets a lower one.
  const found = chooseWith(list, shape, max, KID_SHARE)
  return found.length >= FEW_CARDS ? found : chooseWith(list, shape, max, KID_SHARE / 8)
}

function chooseWith(list, { kids, hits, own }, max, share) {
  const total = list.length
  const inner = (f) => [...(kids.get(f) ?? [])]
  // A folder holding one folder and nothing else says nothing: go on to the one that does.
  const collapse = (f) => { while (!own.has(f) && kids.get(f)?.size === 1) f = inner(f)[0]; return f }
  const enough = Math.max(total < 20 ? 1 : 2, total * share)
  // A folder holding nearly all of its parent's commits is only a longer name for it, like
  // src/ or packages/: what is worth a card is inside it.
  const below = (f) => inner(f).filter((k) => hits.get(k) >= enough).flatMap((k) => hits.get(k) > hits.get(f) * LONGER_NAME ? below(k) : [k])
  const pull = (f) => hits.get(f) / (1 + DEPTH_COST * f.split('/').length) // at a close call, the wider view
  const top = collapse('')
  const cards = new Set([top])
  let waiting = below(top)
  while (cards.size < max && waiting.length) {
    const pick = waiting.reduce((a, f) => pull(f) > pull(a) || (pull(f) === pull(a) && f < a) ? f : a)
    const card = collapse(pick)
    cards.add(card)
    waiting = waiting.filter((f) => f !== pick).concat(below(card))
  }
  // A sliver left behind by a split is not an area.
  const index = new Map([...cards].map((p) => [p, p]))
  const held = new Map([...cards].map((p) => [p, 0]))
  for (const c of list) for (const p of new Set(c.files.map((f) => ownerOf(index, f)).filter((p) => p !== null))) held.set(p, held.get(p) + 1)
  const kept = [...cards].filter((p) => held.get(p) >= Math.max(1, total * SLIVER_SHARE))
  return kept.length ? kept : [...cards]
}

// What each chosen folder saw, most commits first.
export function describeAreas(paths, commits) {
  const index = new Map(paths.map((p) => [p, p]))
  const areas = new Map(paths.map((p) => [p, { path: p, commits: 0, recent: [], touched: new Map(), rest: paths.some((q) => q !== p && (!p || q.startsWith(`${p}/`))) }]))
  for (const c of [...commits].sort((a, b) => b.ct - a.ct)) {
    const here = new Set()
    for (const file of c.files) {
      const owner = ownerOf(index, file)
      if (owner === null) continue
      here.add(owner)
      const a = areas.get(owner)
      a.touched.set(file, (a.touched.get(file) || 0) + 1)
    }
    for (const owner of here) {
      const a = areas.get(owner)
      a.commits += 1
      if (a.recent.length < RECENT) a.recent.push({ s: c.s, at: c.ct, landed: Boolean(c.landed) })
    }
  }
  return [...areas.values()].filter((a) => a.commits)
    .map(({ touched, ...a }) => ({ ...a, files: touched.size, sample: [...touched].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).slice(0, SAMPLE).map(([f]) => f) }))
    .sort((a, b) => b.commits - a.commits || (a.path < b.path ? -1 : 1))
}

export const areaId = (path) => `area-${crypto.createHash('sha1').update(path).digest('hex').slice(0, 10)}`

// A path that fits a card: the end of it, since that is the part that tells areas apart.
export function fitPath(path, room) {
  if (path.length <= room) return path
  const parts = path.split('/')
  let tail = parts.pop()
  while (parts.length && tail.length + parts.at(-1).length + 3 <= room) tail = `${parts.pop()}/${tail}`
  return `…/${tail}`.slice(0, room)
}
export function areaTitle(area) {
  if (!area.path) return 'Repo root'
  const tag = area.rest ? ' (rest)' : ''
  return `${fitPath(area.path, TITLE_MAX - tag.length)}${tag}`
}
