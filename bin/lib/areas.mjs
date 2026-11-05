// A repo with no PLAN.md still gets a map: its folders, grouped into a few areas.
// An area becomes a card in the shape parsePlan gives a component, so the page and the
// Herdr mod draw it with the code they already have. Nothing here claims meaning or
// progress: a title is a real path, and a card only reports what was observed.
import crypto from 'node:crypto'

export const IGNORE = /(^|\/)(\.git|node_modules|\.agenttrail|dist|build|\.next|__pycache__|\.venv|\.build|\.pytest_cache|\.ruff_cache|\.cache|\.DS_Store)(\/|$)/
// editor and tool atomic-write droppings, not real activity targets
export const TMP_FILE = /(\.tmp(\.|$)|~$|\.swp$|\.swx$|(^|\/)\.#|(^|\/)#.+#$|\.DS_Store$)/

export const MAX_AREAS = 16
const MIN_AREAS = 6 // a big repo below this is not worth a graph, so splitting goes on
const FAIR_SHARE = 0.02 // of the repo's files, to earn a card on size alone
const HOT_SHARE = 0.1 // of the recent work, to earn one on activity
const HOT_PULL = 4 // recent work counts this much more than size when choosing what to split
const SAMPLE = 24
// A folder of 500 images is not 500 files' worth of work. Size only: an image still counts,
// and activity on one counts in full.
const ASSET = /\.(png|jpe?g|gif|webp|avif|ico|icns|bmp|tiff?|svg|heic|pdf|mp[34]|m4a|mov|webm|wav|aiff?|flac|ogg|ttf|otf|woff2?|eot|zip|gz|tar|bin|onnx|lock)$/i
const ASSET_WEIGHT = 0.05
const sizeOf = (file) => ASSET.test(file) ? ASSET_WEIGHT : 1
const TITLE_MAX = 28 // the page and the mod both cut a card title here

const makeNode = (path, name) => ({ path, name, files: 0, size: 0, hot: 0, own: 0, kids: new Map() })

function fileTree(files, heat) {
  const root = makeNode('', '')
  for (const file of files) {
    const hot = heat[file] || 0
    const size = sizeOf(file)
    const parts = file.split('/')
    let node = root
    node.files += 1
    node.size += size
    node.hot += hot
    for (const name of parts.slice(0, -1)) {
      let kid = node.kids.get(name)
      if (!kid) node.kids.set(name, kid = makeNode(node.path ? `${node.path}/${name}` : name, name))
      kid.files += 1
      kid.size += size
      kid.hot += hot
      node = kid
    }
    node.own += 1
  }
  return root
}

// A folder holding one folder and nothing else says nothing: go on to the one that does.
function collapse(node) {
  while (!node.own && node.kids.size === 1) node = [...node.kids.values()][0]
  return node
}

// Which folders get cards. Heat is { file: weight } for recent work. The biggest and most
// worked-on folders split off first, so active places get finer detail and quiet ones stay
// whole. Each level down must earn twice the share, so a quiet repo reads as its top
// folders. What is not split off stays with the folder above it.
export function chooseAreas(files, heat = {}, max = MAX_AREAS) {
  if (!files.length) return []
  const root = fileTree(files, heat)
  const total = root.files, totalSize = root.size, totalHot = root.hot
  const limit = Math.min(max, Math.ceil(total / 2))
  const smallest = total < 50 ? 1 : 2
  const share = (c) => c.node.size / totalSize / 2 ** c.depth
  const hotShare = (c) => totalHot ? c.node.hot / totalHot : 0
  const pull = (c) => share(c) + HOT_PULL * hotShare(c)
  const top = collapse(root)
  const cards = new Map([[top.path, top]])
  const rest = new Map([[top.path, top.files]])
  const below = (node, depth) => [...node.kids.values()].map((n) => ({ node: collapse(n), name: n.name, parent: node.path, depth }))
  let waiting = below(top, 0)
  const count = () => [...rest.values()].filter(Boolean).length
  const eligible = (c) => c.node.files >= smallest && (c.node.hot > 0 || !c.name.startsWith('.'))
  const earns = (c) => share(c) >= FAIR_SHARE || hotShare(c) >= HOT_SHARE
  const best = (list) => list.reduce((a, c) => !a || pull(c) > pull(a) || (pull(c) === pull(a) && c.node.path < a.node.path) ? c : a, null)
  for (;;) {
    const open = waiting.filter(eligible)
    const pick = best(open.filter(earns)) ?? (count() < Math.min(MIN_AREAS, limit) ? best(open) : null)
    // Splitting the last of a folder only renames its card, so that one is always free.
    if (!pick || (count() >= limit && rest.get(pick.parent) !== pick.node.files)) break
    waiting = waiting.filter((c) => c !== pick).concat(below(pick.node, pick.depth + 1))
    cards.set(pick.node.path, pick.node)
    rest.set(pick.node.path, pick.node.files)
    rest.set(pick.parent, rest.get(pick.parent) - pick.node.files)
  }
  // A sliver left behind by a split is not an area: it goes back to the folder above.
  const sliver = Math.max(smallest, Math.floor(total * 0.005))
  return [...cards.keys()].filter((p) => p === top.path ? rest.get(p) > 0 : rest.get(p) >= sliver)
}

// The one area a file belongs to: its deepest folder with a card.
export function areaIndex(paths) {
  return new Map(paths.map((p) => [p, p]))
}
export function ownerOf(index, file) {
  let at = file
  while (at) {
    const cut = at.lastIndexOf('/')
    at = cut < 0 ? '' : at.slice(0, cut)
    if (index.has(at)) return index.get(at)
  }
  return null
}

// What each chosen folder holds, ranked with the most worked-on first.
export function describeAreas(paths, files, heat = {}) {
  const index = areaIndex(paths)
  const areas = new Map(paths.map((p) => [p, { path: p, count: 0, size: 0, hot: 0, sample: [], rest: paths.some((q) => q !== p && (!p || q.startsWith(`${p}/`))) }]))
  for (const file of files) {
    const owner = ownerOf(index, file)
    if (owner === null) continue
    const a = areas.get(owner)
    a.count += 1
    a.size += sizeOf(file)
    a.hot += heat[file] || 0
    a.sample.push(file)
  }
  const byUse = (f, g) => (heat[g] || 0) - (heat[f] || 0) || f.length - g.length || (f < g ? -1 : 1)
  return [...areas.values()].filter((a) => a.count)
    .map((a) => ({ ...a, sample: a.sample.sort(byUse).slice(0, SAMPLE) }))
    .sort((a, b) => b.hot - a.hot || b.size - a.size || (a.path < b.path ? -1 : 1))
}

// Cards must not jump about, so a new choice replaces the old only when the repo has
// really changed: many more or fewer files, or a good part of the areas now different.
export function coarseChange(current, next) {
  const had = new Set(current.list.map((a) => a.path))
  const fresh = next.list.filter((a) => !had.has(a.path)).length
  const grown = Math.abs(next.files - current.files) / Math.max(1, current.files)
  return grown >= 0.2 || fresh >= Math.max(2, Math.ceil(had.size / 3))
}

export const areaId = (path) => `area-${crypto.createHash('sha1').update(path).digest('hex').slice(0, 10)}`

// A path that fits a card: the end of it, since that is the part that tells areas apart.
function fitPath(path, room) {
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

const columnsFor = (n) => n < 2 ? 1 : Math.max(2, Math.min(4, Math.ceil(Math.sqrt(n / 2))))

// The same keys parsePlan gives a component, plus `col`: with no needs: edges, every card
// would otherwise sit in one column. It is a place on the grid and says nothing about order.
export function areaNodes(list) {
  const columns = columnsFor(list.length)
  return list.map((a, i) => ({
    id: areaId(a.path), title: areaTitle(a), level: 'component', parent: null, needs: [], links: [], files: [],
    tech: `${a.count} file${a.count === 1 ? '' : 's'}`, by: '', kind: '', url: '', status: 'pending',
    derived: true, path: a.path, col: i % columns,
  }))
}
