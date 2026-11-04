// Recognises Map's own relay among whatever else lives in a settings file.
// The word "agenttrail" proves nothing: Kitchen's relay path contains it too.
const shellWords = command => {
  const words = []
  for (const m of String(command).matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g)) {
    words.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2] ?? m[3])
  }
  return words
}
const baseName = p => p.split(/[\\/]/).pop()

export function isMapRelayCommand(command) {
  const words = shellWords(command)
  if (words.at(-1) !== 'hook') return false
  if (words.length === 3) return /^node(\.exe)?$/.test(baseName(words[0])) && baseName(words[1]) === 'agenttrail.mjs'
  if (words.length === 2) return words[0] === 'agenttrail'
  return false
}
export const hasMapRelay = entries => Array.isArray(entries) && entries.some(entry =>
  isMapRelayCommand(entry?.command) || (Array.isArray(entry?.hooks) && entry.hooks.some(h => isMapRelayCommand(h?.command))))
