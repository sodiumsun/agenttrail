// Loaded into a test daemon with --import. fs.watch here is FSEvents, which can lag by
// many seconds on a busy Mac, so tests that wait on a write would be slow and flaky. This
// stands in with the same reports, folders included, from a quick poll of the tree.
import fs from 'node:fs'
import path from 'node:path'

function snapshot(root) {
  const seen = new Map()
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === 'node_modules') continue
      const r = rel ? `${rel}/${e.name}` : e.name
      try { seen.set(r, fs.statSync(path.join(dir, e.name)).mtimeMs) } catch { continue }
      if (e.isDirectory()) walk(path.join(dir, e.name), r)
    }
  }
  try { walk(root, '') } catch {}
  return seen
}

fs.watch = (root, _options, listener) => {
  let last = snapshot(root)
  const timer = setInterval(() => {
    const next = snapshot(root)
    for (const [f, at] of next) if (last.get(f) !== at) listener('change', f)
    for (const f of last.keys()) if (!next.has(f)) listener('rename', f)
    last = next
  }, Number(process.env.POLL_WATCH_MS) || 60)
  timer.unref()
  return { close: () => clearInterval(timer) }
}
