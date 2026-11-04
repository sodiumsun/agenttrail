// Every daemon here runs from a temporary HOME and repo, on a private port range,
// with a scrubbed environment, so tests cannot touch real settings, logs or boards.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'agenttrail.mjs')

export function tempDir(name) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `agenttrail-${name}-`)))
}
export function tempWorld(plan = '') {
  const root = tempDir('world')
  const home = path.join(root, 'home'), repo = path.join(root, 'repo')
  fs.mkdirSync(home); fs.mkdirSync(repo)
  if (plan) fs.writeFileSync(path.join(repo, 'PLAN.md'), plan)
  return { root, home, repo, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) }
}
export function cleanEnv(home, extra = {}) {
  return { PATH: process.env.PATH, HOME: home, USERPROFILE: home, ...extra }
}

const canBind = port => new Promise(resolve => {
  const s = net.createServer()
  s.once('error', () => resolve(false))
  s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)))
})
export async function freePortBase() {
  for (let tries = 0; tries < 200; tries++) {
    const base = 20000 + Math.floor(Math.random() * 40000)
    const open = await Promise.all(Array.from({ length: 15 }, (_, i) => canBind(base + i)))
    if (open.every(Boolean)) return base
  }
  throw new Error('no free port range for the test daemons')
}

const running = new Set()
export async function startMap({ repo, home, base, port = base, env = {} }) {
  const child = spawn(process.execPath, [BIN, repo, '--no-open'], {
    env: cleanEnv(home, { AGENTTRAIL_PORT_BASE: String(base), AGENTTRAIL_PORT: String(port), ...env }),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  running.add(child)
  child.once('exit', () => running.delete(child))
  let output = ''
  const actualPort = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`daemon did not start: ${output}`)), 8000)
    const read = c => {
      output += c
      const m = output.match(/http:\/\/localhost:(\d+)/)
      if (m) { clearTimeout(timer); resolve(Number(m[1])) }
    }
    child.stdout.on('data', read)
    child.stderr.on('data', read)
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`daemon exited ${code}: ${output}`)) })
  })
  return {
    port: actualPort,
    child,
    stop: () => stopChild(child),
    get: (p, headers) => request(actualPort, p, { headers }),
    post: (p, body, headers) => request(actualPort, p, { method: 'POST', body, headers }),
    model: async () => JSON.parse((await request(actualPort, '/model')).body),
    token: async () => (await request(actualPort, '/')).body.match(/name="agenttrail-token" content="([^"]*)"/)[1],
  }
}
function stopChild(child, signal = 'SIGTERM') {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise(resolve => { child.once('exit', resolve); child.kill(signal) })
}
export async function stopAll() { await Promise.all([...running].map(c => stopChild(c))) }

// node:http rather than fetch: fetch cannot send a chosen Host or Origin.
export function request(port, target, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
    const req = http.request({ host: '127.0.0.1', port, path: target, method, headers }, res => {
      let text = ''
      res.on('data', c => text += c)
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: text }))
    })
    req.on('error', reject)
    req.setTimeout(6000, () => req.destroy(new Error(`timed out: ${method} ${target}`)))
    req.end(payload)
  })
}

export async function until(check, what, ms = 8000) {
  const end = Date.now() + ms
  let last
  while (Date.now() < end) {
    last = await check()
    if (last) return last
    await new Promise(r => setTimeout(r, 50))
  }
  throw new Error(`timed out waiting for ${what}`)
}
