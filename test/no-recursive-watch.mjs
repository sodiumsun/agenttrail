// Loaded into a test daemon with --import: a platform where fs.watch cannot recurse,
// so Map takes its fallback watcher.
import fs from 'node:fs'

const watch = fs.watch
fs.watch = (root, options, listener) => {
  if (options && typeof options === 'object' && options.recursive) throw Object.assign(new Error('recursive watch unsupported'), { code: 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM' })
  return watch(root, options, listener)
}
