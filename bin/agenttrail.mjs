#!/usr/bin/env node
// agenttrail v0 — codebase-grounded daemon.
// Spine: fs watcher on the repo + PLAN.md convention. No hooks required
// (hooks become an optional fidelity adapter later).
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import crypto from 'node:crypto'
import { exec } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ---------- CLI ----------
const argv = process.argv.slice(2)
let cmd = null
let repo = process.cwd()
let port = 5330
let openBrowser = false
let hooksOnly = false
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === 'init') cmd = 'init'
  else if (a === 'hook') cmd = 'hook'
  else if (a === '--port') port = parseInt(argv[++i], 10)
  else if (a === '--open') openBrowser = true
  else if (a === '--hooks-only') hooksOnly = true
  else repo = path.resolve(a)
}
const planPath = path.join(repo, 'PLAN.md')
const atDir = path.join(repo, '.agenttrail')

if (cmd === 'init') { hooksOnly ? installHooks() : init(); process.exit(0) }
if (cmd === 'hook') { await relayHook(); process.exit(0) }

// reads a claude code hook payload on stdin and fans it out to local daemons;
// each daemon keeps only events whose cwd lives inside its repo. Never blocks
// the agent: 400ms cap, failures are silent.
async function relayHook() {
  let raw = ''
  try { for await (const c of process.stdin) raw += c } catch {}
  if (!raw) return
  const ports = process.env.AGENTTRAIL_PORT ? [parseInt(process.env.AGENTTRAIL_PORT, 10)] : Array.from({ length: 15 }, (_, i) => 5330 + i)
  await Promise.allSettled(ports.map(p => fetch(`http://127.0.0.1:${p}/hook`, {
    method: 'POST', body: raw, signal: AbortSignal.timeout(400),
  }).catch(() => {})))
}

// ---------- PLAN.md parser (convention v2: components, owner-first names) ----------
// `## Plain-language name {#id}` = a component of the system, not a phase.
// `tech:` under a component or task carries the engineer phrasing.
// `needs: [id]` = directed sequencing edge; `links: [id]` = undirected coupling.
const NODE_RE = /^##\s+(.+?)\s*\{#([a-z0-9][a-z0-9-]*)\}\s*$/i
const TASK_RE = /^\s*[-*]\s+\[( |x|~|!)\]\s+(.+?)\s*\{#([a-z0-9][a-z0-9-]*)\}\s*$/i
const NEEDS_RE = /^needs:\s*\[([^\]]*)\]\s*$/i
const LINKS_RE = /^links:\s*\[([^\]]*)\]\s*$/i
const FILES_RE = /^files:\s*\[([^\]]*)\]\s*$/i
const TECH_RE = /^\s*tech:\s*(.+?)\s*$/i
const BY_RE = /^\s*by:\s*(.+?)\s*$/i
const FROM_RE = /^\s*(?:from|horizon):\s*(agent|roadmap|now|backlog)\s*$/i
const DECISIONS_RE = /^##\s+decisions\s*$/i
const idList = s => s.split(',').map(x => x.trim()).filter(Boolean)

function parsePlan(text) {
  const nodes = [] // ordered
  const decisions = []
  let title = ''
  let curComponent = null
  let lastNode = null // tech: lines attach to the most recent component or task
  let inDecisions = false
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    if (!title && /^#\s+/.test(line)) { title = line.replace(/^#\s+/, ''); continue }
    if (DECISIONS_RE.test(line)) { inDecisions = true; curComponent = null; lastNode = null; continue }
    let m
    if ((m = line.match(NODE_RE))) {
      inDecisions = false
      curComponent = { id: m[2], title: m[1], level: 'component', parent: null, needs: [], links: [], files: [], tech: '', by: '', status: 'pending' }
      lastNode = curComponent
      nodes.push(curComponent)
      continue
    }
    if (inDecisions) {
      if (/^\s*[-*]\s+/.test(line)) decisions.push(line.replace(/^\s*[-*]\s+/, ''))
      continue
    }
    if ((m = line.match(TASK_RE))) {
      const status = m[1] === 'x' ? 'done' : m[1] === '~' ? 'active' : m[1] === '!' ? 'blocked' : 'pending'
      lastNode = { id: m[3], title: m[2], level: 'task', parent: curComponent ? curComponent.id : null, needs: [], links: [], tech: '', by: '', src: '', status }
      nodes.push(lastNode)
      continue
    }
    if ((m = line.match(TECH_RE))) { if (lastNode) lastNode.tech = m[1]; continue }
    if ((m = line.match(BY_RE))) { if (lastNode) lastNode.by = m[1]; continue }
    if ((m = line.match(FROM_RE))) { if (lastNode) { const v = m[1].toLowerCase(); lastNode.src = v === 'now' ? 'agent' : v === 'backlog' ? 'roadmap' : v } continue }
    if ((m = line.match(NEEDS_RE))) { if (curComponent) curComponent.needs = idList(m[1]); continue }
    if ((m = line.match(LINKS_RE))) { if (curComponent) curComponent.links = idList(m[1]); continue }
    if ((m = line.match(FILES_RE))) { if (curComponent) curComponent.files = idList(m[1]); continue }
  }
  // derive component status from its tasks — blocked wins (it demands attention)
  for (const c of nodes.filter(n => n.level === 'component')) {
    const kids = nodes.filter(n => n.parent === c.id)
    if (kids.some(k => k.status === 'blocked')) c.status = 'blocked'
    else if (kids.some(k => k.status === 'active')) c.status = 'active'
    else if (kids.length && kids.every(k => k.status === 'done')) c.status = 'done'
  }
  return { nodes, decisions, title }
}

// ---------- live state ----------
const session = { id: Math.random().toString(36).slice(2, 10), project: path.basename(repo), startedAt: new Date().toISOString() }
let planText = safeRead(planPath)
let parsed = parsePlan(planText)
let activity = null // { file, at } — most recent non-plan repo write
let recentActivity = [] // last N writes, newest first — feeds the live-view drill-down
let planMtime = statMtime(planPath)
const clients = new Set()

// ---------- observed activity per component (files: globs) ----------
// Declared status ([~]/[x]) says what the agent claims; this says what the
// filesystem shows. A component whose files are being written is live no
// matter what its checkbox says — that is how "revising done work" stays visible.
const compTouched = {} // component id -> last matching write ts
const compRecent = {} // component id -> [{file, at}] newest first — feeds capsule work lines
function globToRe(g) {
  if (!/[*?]/.test(g)) return new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&') + '(/|$)')
  const esc = g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*')
  return new RegExp('^' + esc + '$')
}
let compMatchers = []
function rebuildMatchers() {
  compMatchers = parsed.nodes.filter(n => n.level === 'component' && n.files.length)
    .map(c => ({ id: c.id, res: c.files.map(globToRe) }))
}
function touchComponents(file, at) {
  for (const m of compMatchers) if (m.res.some(re => re.test(file))) {
    compTouched[m.id] = at
    const arr = compRecent[m.id] || (compRecent[m.id] = [])
    if (arr[0] && arr[0].file === file) arr[0] = { file, at, n: (arr[0].n || 1) + 1 }
    else arr.unshift({ file, at, n: 1 })
    if (arr.length > 6) arr.length = 6
  }
}

// ---------- live runs (claude code hooks adapter) ----------
// The run is the foreground: what the agent is doing right now — current
// todo, streaming tool line, recent calls — pinned to a component on the map.
const runs = {} // session id -> run
function runFor(id, cwd) {
  return runs[id] || (runs[id] = { id, agent: 'claude', cwd, startedAt: Date.now(), lastEventAt: Date.now(), todos: [], currentTool: null, recentTools: [], componentId: null, ended: false })
}
function toolDetail(input = {}) {
  const p = input.file_path || input.notebook_path
  const d = input.command || (p ? (relToRepo(p) ?? p) : '') || input.pattern || input.url || input.query || input.prompt || ''
  return String(d).replace(/\s+/g, ' ').slice(0, 90)
}
function relToRepo(p) {
  if (!p) return null
  const r = path.resolve(String(p))
  return r === repo ? '' : r.startsWith(repo + path.sep) ? r.slice(repo.length + 1) : null
}
function handleHookEvent(ev) {
  const cwd = ev.cwd || ''
  if (!(cwd === repo || cwd.startsWith(repo + path.sep))) return false
  const run = runFor(ev.session_id || 'session', cwd)
  run.lastEventAt = Date.now()
  stateDirty = true
  const kind = ev.hook_event_name
  if (kind === 'SessionStart') run.ended = false
  else if (kind === 'Stop' || kind === 'SessionEnd') { run.ended = true; run.currentTool = null }
  else if (kind === 'PreToolUse') {
    run.ended = false
    run.currentTool = { name: ev.tool_name, detail: toolDetail(ev.tool_input), at: Date.now() }
  } else if (kind === 'PostToolUse') {
    run.ended = false
    const started = run.currentTool && run.currentTool.name === ev.tool_name ? run.currentTool.at : Date.now()
    run.recentTools.unshift({ name: ev.tool_name, detail: toolDetail(ev.tool_input), at: Date.now(), ms: Date.now() - started })
    if (run.recentTools.length > 8) run.recentTools.length = 8
    run.currentTool = null
    if (ev.tool_name === 'TodoWrite' && ev.tool_input && Array.isArray(ev.tool_input.todos)) {
      run.todos = ev.tool_input.todos.map(t => ({ content: t.content, status: t.status }))
    }
    const rel = relToRepo(ev.tool_input && (ev.tool_input.file_path || ev.tool_input.notebook_path))
    if (rel) {
      touchComponents(rel, Date.now())
      activity = { file: rel, at: Date.now() }
      for (const m of compMatchers) if (m.res.some(re => re.test(rel))) run.componentId = m.id
    }
  } else return false
  return true
}
function liveRuns() {
  const now = Date.now()
  for (const [id, r] of Object.entries(runs)) {
    if (!r.ended && now - r.lastEventAt > 15 * 60e3) { r.ended = true; r.currentTool = null } // missed Stop
    if (now - r.lastEventAt > 2 * 3600e3) delete runs[id] // 2h trail, then gone
  }
  return Object.values(runs).sort((a, b) => a.startedAt - b.startedAt)
}

// ---------- observed-state persistence (survives daemon restarts) ----------
// Lives under ~/.agenttrail keyed by repo path — never touches the repo itself.
const stateFile = path.join(os.homedir(), '.agenttrail', crypto.createHash('sha1').update(repo).digest('hex').slice(0, 12) + '.json')
let stateDirty = false
function loadState() {
  try {
    const st = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
    activity = st.activity || null
    recentActivity = st.recentActivity || []
    Object.assign(runs, st.runs || {})
    Object.assign(compTouched, st.compTouched || {})
    Object.assign(compRecent, st.compRecent || {})
  } catch {}
}
function saveState() {
  if (!stateDirty) return
  stateDirty = false
  try {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true })
    fs.writeFileSync(stateFile, JSON.stringify({ activity, recentActivity, compTouched, compRecent, runs }))
  } catch {}
}
loadState()
setInterval(saveState, 15000).unref()
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stateDirty = true; saveState(); process.exit(0) })

// ---------- repo tree (vs-code-style explorer, folders first) ----------
const IGNORE = /(^|\/)(\.git|node_modules|\.agenttrail|dist|build|\.next|__pycache__|\.venv|\.build|\.pytest_cache|\.ruff_cache|\.cache|\.DS_Store)(\/|$)/
// editor/tool atomic-write droppings — not real activity targets
const TMP_FILE = /(\.tmp(\.|$)|~$|\.swp$|\.swx$|(^|\/)\.#|(^|\/)#.+#$|\.DS_Store$)/

function buildTree(rootDir, budgetN = 4000, perDir = 250) {
  treeTruncated = false
  const root = []
  const queue = [{ dir: rootDir, rel: '', depth: 0, out: root }]
  let budget = budgetN
  while (queue.length) {
    const { dir, rel, depth, out } = queue.shift()
    if (depth > 8) continue
    let entries = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { continue }
    let taken = 0
    for (const e of entries) {
      const r = rel ? rel + '/' + e.name : e.name
      if (IGNORE.test(r) || TMP_FILE.test(r)) continue
      if (taken >= perDir || budget <= 0) { treeTruncated = true; break }
      taken++; budget--
      if (e.isDirectory()) {
        const node = { name: e.name, path: r, dir: true, children: [] }
        out.push(node)
        queue.push({ dir: path.join(dir, e.name), rel: r, depth: depth + 1, out: node.children })
      } else if (e.isFile()) out.push({ name: e.name, path: r, dir: false })
    }
    out.sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name))
  }
  return root
}
let treeTruncated = false
let tree = buildTree(repo)
let treeDirty = false
let lastTreeSent = Date.now()
rebuildMatchers()

function safeRead(p) { try { return fs.readFileSync(p, 'utf8') } catch { return '' } }
function statMtime(p) { try { return fs.statSync(p).mtimeMs } catch { return null } }

// ---------- previous sessions ----------
const sessionsCache = {} // path -> { mtime, size, turns, snippet }

function encodeCwd(p) {
  let resolved = p
  try { resolved = fs.realpathSync(p) } catch {}
  const out = []
  for (let i = 0; i < resolved.length; i++) {
    const ch = resolved[i]
    const c = ch.charCodeAt(0)
    if ((48 <= c && c <= 57) || (65 <= c && c <= 90) || (97 <= c && c <= 122)) {
      out.push(ch)
    } else {
      out.push('-')
    }
  }
  return out.join('')
}

function loadPreviousSessions() {
  const projDir = path.join(os.homedir(), '.claude', 'projects', encodeCwd(repo))
  const list = []
  try {
    if (fs.existsSync(projDir)) {
      const names = fs.readdirSync(projDir)
      for (const name of names) {
        if (!name.endsWith('.jsonl')) continue
        const fullPath = path.join(projDir, name)
        let st
        try { st = fs.statSync(fullPath) } catch { continue }
        
        let cached = sessionsCache[fullPath]
        if (!cached || cached.mtime !== st.mtimeMs || cached.size !== st.size) {
          let turns = 0
          let snippet = ''
          try {
            const content = fs.readFileSync(fullPath, 'utf8')
            const lines = content.split('\n')
            for (const line of lines) {
              if (!line.trim()) continue
              try {
                const d = JSON.parse(line)
                if (d.type === 'user') {
                  turns++
                  if (!snippet) {
                    const contentVal = d.message?.content
                    if (typeof contentVal === 'string') {
                      snippet = contentVal
                    } else if (Array.isArray(contentVal)) {
                      snippet = contentVal.map(x => x.text || '').join(' ')
                    }
                  }
                }
              } catch {}
            }
          } catch {}
          cached = {
            mtime: st.mtimeMs,
            size: st.size,
            turns,
            snippet: snippet ? snippet.trim().replace(/\s+/g, ' ') : '(empty)',
          }
          sessionsCache[fullPath] = cached
        }
        
        list.push({
          id: name.slice(0, -6),
          mtime: cached.mtime,
          size: cached.size,
          turns: cached.turns,
          snippet: cached.snippet,
        })
      }
    }
  } catch {}
  return list.sort((a, b) => b.mtime - a.mtime)
}

function getSessionTranscript(sessionId) {
  const projDir = path.join(os.homedir(), '.claude', 'projects', encodeCwd(repo))
  const fullPath = path.join(projDir, `${sessionId}.jsonl`)
  const transcript = []
  try {
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf8')
      const lines = content.split('\n')
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const d = JSON.parse(line)
          const t = d.type
          if (t === 'user') {
            let text = ''
            const contentVal = d.message?.content
            if (typeof contentVal === 'string') {
              text = contentVal
            } else if (Array.isArray(contentVal)) {
              text = contentVal.map(x => x.text || '').join(' ')
            }
            transcript.push({
              role: 'user',
              text: text.trim(),
              timestamp: d.timestamp ? new Date(d.timestamp).getTime() : null
            })
          } else if (t === 'assistant') {
            let text = ''
            const contentVal = d.message?.content
            if (typeof contentVal === 'string') {
              text = contentVal
            } else if (Array.isArray(contentVal)) {
              text = contentVal.filter(x => x.type === 'text').map(x => x.text || '').join('\n')
            }
            
            const tools = []
            if (Array.isArray(contentVal)) {
              contentVal.filter(x => x.type === 'tool_use').forEach(x => {
                tools.push({
                  name: x.name,
                  input: typeof x.input === 'object' ? JSON.stringify(x.input) : String(x.input || '')
                })
              })
            }
            
            transcript.push({
              role: 'assistant',
              text: text.trim(),
              tools,
              timestamp: d.timestamp ? new Date(d.timestamp).getTime() : null
            })
          }
        } catch {}
      }
    }
  } catch {}
  return transcript
}

function model() {
  if (treeDirty) { tree = buildTree(repo); treeDirty = false }
  return {
    boards,
    runs: liveRuns(),
    previousSessions: loadPreviousSessions(),
    session, plan: parsed.nodes.map(n => n.level === 'component' ? { ...n, touchedAt: compTouched[n.id] || null, recent: compRecent[n.id] || [] } : n), tree,
    planTitle: parsed.title,
    hasPlan: planText.length > 0, treeTruncated,
    activity, recentActivity, planMtime,
    now: Date.now(),
  }
}

function send(obj) {
  const data = `data: ${JSON.stringify(obj)}\n\n`
  for (const res of clients) res.write(data)
}
function broadcast() { send(model()) }
// activity ticks carry only what moved — the 600KB tree stays home
function broadcastTick() {
  send({ partial: true, runs: liveRuns(), previousSessions: loadPreviousSessions(), activity, recentActivity, touched: { ...compTouched }, compRecent, now: Date.now() })
}

// ---------- watcher ----------
let planDebounce = null
try {
  fs.watch(repo, { recursive: true }, (_ev, filename) => {
    if (!filename) return
    const f = filename.toString().split(path.sep).join('/')
    if (IGNORE.test(f) || TMP_FILE.test(f)) return
    if (path.resolve(repo, f) === planPath) {
      clearTimeout(planDebounce)
      planDebounce = setTimeout(() => {
        planText = safeRead(planPath)
        parsed = parsePlan(planText)
        rebuildMatchers()
        planMtime = statMtime(planPath)
        broadcast()
      }, 150)
      return
    }
    // plain repo churn → liveness signal
    treeDirty = true
    stateDirty = true
    activity = { file: f, at: Date.now() }
    touchComponents(f, activity.at)
    if (!recentActivity.length || recentActivity[0].file !== f) recentActivity.unshift(activity)
    else recentActivity[0] = activity
    recentActivity = recentActivity.slice(0, 12)
    throttleBroadcast()
  })
} catch (e) {
  // recursive watch is unsupported on some platforms (older linux) — degrade:
  // PLAN.md and top-level changes still tracked, deep activity limited.
  try {
    fs.watch(repo, (_ev, filename) => {
      if (!filename) return
      const f = filename.toString()
      if (path.resolve(repo, f) === planPath) {
        clearTimeout(planDebounce)
        planDebounce = setTimeout(() => {
          planText = safeRead(planPath)
          parsed = parsePlan(planText)
          rebuildMatchers()
          planMtime = statMtime(planPath)
          broadcast()
        }, 150)
      }
    })
    console.error('note: recursive file watching unavailable here — plan updates still live, deep file activity limited')
  } catch (e2) {
    console.error('watcher failed:', e2.message)
  }
}
let lastActivityPush = 0
function throttleBroadcast() {
  const now = Date.now()
  if (now - lastActivityPush <= 1000) return
  lastActivityPush = now
  if (treeDirty && now - lastTreeSent > 10000) { lastTreeSent = now; broadcast() } // tree refresh, at most every 10s
  else broadcastTick()
}

// ---------- sibling boards (multi-repo: one daemon per repo, boards link to each other) ----------
let boards = [{ port, project: path.basename(repo), self: true }]
async function discoverBoards() {
  const found = [{ port, project: session.project, self: true }]
  await Promise.allSettled(Array.from({ length: 15 }, (_, i) => 5330 + i).filter(p => p !== port).map(async p => {
    try {
      const r = await fetch(`http://127.0.0.1:${p}/whoami`, { signal: AbortSignal.timeout(300) })
      const j = await r.json()
      if (j && j.project) found.push({ port: p, project: j.project, self: false })
    } catch {}
  }))
  boards = found.sort((a, b) => a.port - b.port)
}
discoverBoards()
for (const t of [3000, 8000]) setTimeout(discoverBoards, t).unref() // cold-start: siblings may not be up yet
setInterval(discoverBoards, 30000).unref()

// ---------- http ----------
const sseSessions = new Map() // id -> response
const indexPath = path.join(__dirname, '..', 'public', 'index.html')
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x')
  if (u.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html' }).end(fs.readFileSync(indexPath, 'utf8'))
  } else if (u.pathname === '/whoami') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ project: session.project, port }))
  } else if (u.pathname === '/model') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(model()))
  } else if (u.pathname === '/session-transcript') {
    const sid = u.searchParams.get('id')
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(getSessionTranscript(sid)))
  } else if (u.pathname === '/session-distill') {
    const sid = u.searchParams.get('id')
    const pythonScript = path.join(os.homedir(), 'work', 'sessions', 'sessions.py')
    const cmd = `python3 "${pythonScript}" distill ${sid}`
    exec(cmd, (err, stdout, stderr) => {
      const distilledFile = path.join(os.homedir(), '.sessions', 'distilled', 'claude', `${sid}.md`)
      let content = ''
      try {
        if (fs.existsSync(distilledFile)) {
          content = fs.readFileSync(distilledFile, 'utf8')
        }
      } catch {}
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        success: !err && content.length > 0,
        text: content || stdout || stderr || 'Could not distill session.'
      }))
    })
  } else if (u.pathname === '/session-sync-vault') {
    const sid = u.searchParams.get('id')
    const distilledFile = path.join(os.homedir(), '.sessions', 'distilled', 'claude', `${sid}.md`)
    const vaultDir = '/Users/esaruoho/work/cc/vault/sources/conversations'
    const targetFile = path.join(vaultDir, `${sid}.md`)
    let success = false
    try {
      if (fs.existsSync(distilledFile)) {
        if (!fs.existsSync(vaultDir)) fs.mkdirSync(vaultDir, { recursive: true })
        fs.copyFileSync(distilledFile, targetFile)
        success = true
      }
    } catch {}
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ success, path: targetFile }))
  } else if (u.pathname === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
    res.write(`data: ${JSON.stringify(model())}\n\n`)
    clients.add(res)
    req.on('close', () => clients.delete(res))
  } else if (u.pathname === '/hook' && req.method === 'POST') {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', () => {
      try { if (handleHookEvent(JSON.parse(body))) hookTick() } catch {}
      res.writeHead(200).end()
    })
  } else if (u.pathname === '/sse') {
    // MCP over SSE Transport connection
    const sessionId = Math.random().toString(36).slice(2, 10)
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    })
    sseSessions.set(sessionId, res)
    res.write(`event: endpoint\ndata: ${encodeURIComponent(`/message?id=${sessionId}`)}\n\n`)
    req.on('close', () => sseSessions.delete(sessionId))
  } else if (u.pathname === '/message' && req.method === 'POST') {
    const sessionId = u.searchParams.get('id')
    let body = ''
    req.on('data', c => body += c)
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end('accepted')
      try {
        const payload = JSON.parse(body)
        const response = handleMcpMessage(payload)
        const clientRes = sseSessions.get(sessionId)
        if (clientRes && response) {
          clientRes.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`)
        }
      } catch {}
    })
  } else res.writeHead(404).end()
})

// ---------- MCP protocol parser & tool executor ----------
function handleMcpMessage(payload) {
  if (payload.jsonrpc !== '2.0') return null
  const id = payload.id
  const method = payload.method
  
  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: 'agenttrail',
          version: '0.1.0'
        }
      }
    }
  }
  
  if (method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools: [
          {
            name: 'register_run',
            description: 'Notify agenttrail that an agent has initiated an active session.',
            inputSchema: {
              type: 'object',
              properties: {
                session_id: { type: 'string', description: 'Unique session id or chat context id.' },
                agent_name: { type: 'string', description: 'The name of the agent (e.g. gemini, cursor, copilot, codex).' }
              },
              required: ['session_id', 'agent_name']
            }
          },
          {
            name: 'post_tool_use',
            description: 'Notify agenttrail that a tool is being invoked by the agent.',
            inputSchema: {
              type: 'object',
              properties: {
                session_id: { type: 'string' },
                tool_name: { type: 'string', description: 'Name of the tool (e.g. bash, read, write).' },
                tool_input: { type: 'string', description: 'Action inputs or shell command details.' },
                status: { type: 'string', enum: ['start', 'complete'], description: 'Whether the tool is beginning or ending.' }
              },
              required: ['session_id', 'tool_name', 'status']
            }
          },
          {
            name: 'update_todos',
            description: 'Update the live in-progress checklist of tasks.',
            inputSchema: {
              type: 'object',
              properties: {
                session_id: { type: 'string' },
                todos: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      content: { type: 'string' },
                      status: { type: 'string', enum: ['not_started', 'in_progress', 'completed'] }
                    },
                    required: ['content', 'status']
                  }
                }
              },
              required: ['session_id', 'todos']
            }
          }
        ]
      }
    }
  }
  
  if (method === 'tools/call') {
    const toolName = payload.params?.name
    const args = payload.params?.arguments || {}
    let success = false
    
    if (toolName === 'register_run') {
      success = handleHookEvent({
        cwd: repo,
        session_id: args.session_id,
        hook_event_name: 'SessionStart',
        agent: args.agent_name
      })
    } else if (toolName === 'post_tool_use') {
      success = handleHookEvent({
        cwd: repo,
        session_id: args.session_id,
        hook_event_name: args.status === 'start' ? 'PreToolUse' : 'PostToolUse',
        tool_name: args.tool_name,
        tool_input: { command: args.tool_input }
      })
    } else if (toolName === 'update_todos') {
      success = handleHookEvent({
        cwd: repo,
        session_id: args.session_id,
        hook_event_name: 'PostToolUse',
        tool_name: 'TodoWrite',
        tool_input: { todos: args.todos }
      })
    }
    
    if (success) hookTick()
    
    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [
          {
            type: 'text',
            text: success ? `Successfully synchronized state with agenttrail.` : `Could not sync state. Ensure session path is correct.`
          }
        ]
      }
    }
  }
  
  return null
}
let lastHookTick = 0
function hookTick() {
  const now = Date.now()
  if (now - lastHookTick > 300) { lastHookTick = now; broadcastTick() }
}
function listenWithFallback(tries = 20) {
  server.once('error', e => {
    if (e.code === 'EADDRINUSE' && tries > 0) { port += 1; listenWithFallback(tries - 1) }
    else { console.error('could not bind a port:', e.message); process.exit(1) }
  })
  server.listen(port, '127.0.0.1', onListen)
}
function onListen() {
  console.log(`agenttrail · ${session.project} · http://localhost:${port}`)
  if (!planText) console.log('no PLAN.md found — run `agenttrail init` in the repo to scaffold one')
  if (openBrowser) {
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
    import('node:child_process').then(cp => cp.spawn(opener, [`http://localhost:${port}`], { stdio: 'ignore', detached: true }))
  }
}
listenWithFallback()

// ---------- init ----------
function init() {
  fs.mkdirSync(atDir, { recursive: true })
  if (!fs.existsSync(planPath)) {
    fs.writeFileSync(planPath, `# ${path.basename(repo)}

## Set up the project {#setup}
tech: scaffolding
- [ ] First task {#setup-first}

## decisions
`)
    console.log('wrote PLAN.md skeleton')
  }
  const marker = '<!-- agenttrail -->'
  const snippet = `\n${marker}\n## agenttrail plan convention\nMaintain PLAN.md as the living plan. It is read by the project OWNER, not by you — write it for them.\n- nodes are COMPONENTS of the system being built (\`## Plain-language name {#id}\`), not phases or sprints; keep the map at 5-9 components regardless of repo size — grow tasks, not cards, and split a component only when one agent could no longer own it for a session\n- naming rule: titles are verb-led, plain-language, and CONCRETE — the owner can tell when it is done ("Read alerts out loud", "Watch the repo"). Never engineer-speak ("fs watcher + activity signal") and never vague vibes ("Decide what matters"); put the engineer phrasing on a \`tech:\` line under the heading\n- tasks inside a component: \`- [ ] Plain outcome {#id}\`, optional indented \`tech:\` line beneath; mark a task \`[~]\` BEFORE you start it and save PLAN.md immediately — this drives the live in-progress view; flip it to \`[x]\` the moment it completes, \`[!]\` if stuck (clear once unblocked). Never batch plan updates for the end of the session\n- when you mark a task \`[~]\`, add an indented \`by: <your name>\` line under it (claude, codex, cursor, …) and leave it there when done — it is the record of who did what\n- edges under a component heading: \`needs: [id, id]\` = must come after those components; \`links: [id, id]\` = interconnected with / talks to\n- \`files: [src/audio/**, config.py]\` under a component declares which paths it owns — keep it current; it is how the live view knows which component you are really working in, including when you revisit finished work\n- \`{#id}\`s are stable — never rename, only add or remove nodes\n- open tasks carry an indented \`from:\` line naming their provenance — \`from: agent\` when YOU are declaring it as your own imminent build intent (the owner corrects these on sight if wrong), \`from: roadmap\` when it comes from planning documents (durable intent, backloggable); omit when neither\n- before ending a session, graduate your plan-worthy completed todos into PLAN.md as \`[x]\` tasks (with \`by:\`) — housekeeping todos stay out of the plan\n- record any plan-affecting decision under \`## decisions\` BEFORE implementing it\n`
  // CLAUDE.md is read by Claude Code, AGENTS.md by Codex/Cursor and friends —
  // the convention block goes in both so any agent maintains the same plan.
  for (const name of ['CLAUDE.md', 'AGENTS.md']) {
    const p = path.join(repo, name)
    if (!safeRead(p).includes(marker)) {
      fs.appendFileSync(p, snippet)
      console.log(`appended agenttrail convention block to ${name}`)
    }
  }
  installHooks()
  const gi = path.join(repo, '.gitignore')
  const giText = safeRead(gi)
  if (!giText.includes('.agenttrail')) fs.appendFileSync(gi, (giText.endsWith('\n') || !giText ? '' : '\n') + '.agenttrail/\n')
  console.log('done — start the daemon with: agenttrail ' + repo)
  console.log('\nnext: have your agent draw the real map. Paste this to Claude Code or Codex in this repo:\n')
  console.log('  Read the "agenttrail plan convention" section in CLAUDE.md or AGENTS.md. Then study this repo in trust order — the code and directory layout first (what exists), git log for what is actually recent, decision logs and any in-progress build/handoff docs for what is in flight, and README/roadmap prose LAST and only for open intent (founding docs rot; cross-check their claims against git log) — and rewrite PLAN.md as the real map of this codebase: components with stable {#id}s, needs:/links: edges between them, files: globs for the paths each owns, and verb-led concrete titles with tech: sublines. Keep it to 5-9 components no matter how big the repo — a component is a part one agent could own for a session, with its own doneness and at least one edge; anything smaller is a task inside one. Verify every status against the CODE, not the docs — READMEs and roadmaps rot; mark [x] only after finding the implementing source or artifact, and cite that evidence on its tech: line (e.g. tech: TurnView.swift) so a human can audit every tick; if you cannot find evidence, leave it unchecked and say so in the decisions note. Statuses must be honest — [x] only for what verifiably exists, [~] only for what you are working on right now, everything else [ ]. Tag open tasks with an indented from: line naming provenance — from: agent when an in-progress build/handoff doc or your own declared intent claims it imminently, from: roadmap when sourced only from planning docs; omit when unsure. Record the backfill under ## decisions.')
}

// merge our hook relay into the repo's .claude/settings.json so Claude Code
// sessions stream tool calls + todos to the board. Additive and idempotent.
function installHooks() {
  const dir = path.join(repo, '.claude')
  const sp = path.join(dir, 'settings.local.json')
  let cfg = {}
  try { cfg = JSON.parse(fs.readFileSync(sp, 'utf8')) } catch {}
  const cmd = `node ${JSON.stringify(fileURLToPath(import.meta.url))} hook`
  cfg.hooks = cfg.hooks || {}
  let added = 0
  for (const ev of ['PreToolUse', 'PostToolUse', 'Stop', 'SessionStart']) {
    const list = cfg.hooks[ev] = cfg.hooks[ev] || []
    const present = JSON.stringify(list).includes('agenttrail')
    if (!present) { list.push({ matcher: '*', hooks: [{ type: 'command', command: cmd }] }); added++ }
  }
  if (added) {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(sp, JSON.stringify(cfg, null, 2) + '\n')
    console.log(`wired ${added} claude code hooks into .claude/settings.local.json (live tool + todo stream)`)
  }
}
