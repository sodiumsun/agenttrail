// Defects found in review of the Herdr branch, each pinned by the scenario that showed it.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { afterEach, describe, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { ClaudeLogReader } from '../bin/lib/claude.mjs'
import { CodexLogReader } from '../bin/lib/codex.mjs'
import { MAX_CANDIDATES, META_BYTES } from '../bin/lib/logtail.mjs'
import { Poller } from '../herdr/agenttrail/mods/agenttrail/feed.js'
import { buildView } from '../herdr/agenttrail/mods/agenttrail/view.js'
import { BIN, cleanEnv, freePortBase, request, startMap, stopAll, tempDir, tempWorld, until } from './helpers.mjs'

let world
afterEach(async () => { await stopAll(); world?.cleanup(); world = null })
const boot = async (plan, env) => {
  world = tempWorld(plan)
  return startMap({ repo: world.repo, home: world.home, base: await freePortBase(), env })
}
const iso = ms => new Date(ms).toISOString()

describe('a plan cannot run script in the Map page', () => {
  const plan = url => `# p\n\n## Part {#part}\nurl: ${url}\n- [ ] t {#t}\n`
  const urlOf = async map => (await map.model()).plan.find(n => n.id === 'part').url
  test('only a plain web address becomes a card link', async () => {
    const map = await boot(plan('http://localhost:3000/console?a=1'))
    assert.equal(await urlOf(map), 'http://localhost:3000/console?a=1')
    for (const bad of [`x"><img/src='x'/onerror=alert(1)>`, 'javascript:alert(1)', `http://x"><img/src='x'/onerror=alert(1)>`, 'data:text/html,x']) {
      fs.writeFileSync(path.join(world.repo, 'PLAN.md'), plan(bad))
      await until(async () => (await urlOf(map)) === '', `dropping ${bad}`)
    }
  })
  test('the page never builds the link inside a script attribute', () => {
    const page = fs.readFileSync(path.join(path.dirname(BIN), '..', 'public', 'index.html'), 'utf8')
    assert.ok(!page.includes('JSON.stringify(p.url)'))
    assert.ok(page.includes('data-url="${esc(p.url)}"'))
  })
})

