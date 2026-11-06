// Drives the pi extension with a stand-in for pi's API against a real board.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import agenttrail from '../integrations/pi/index.js'
import { freePortBase, startMap, stopAll, tempWorld, until } from './helpers.mjs'

let world, map
const handlers = {}
const ctx = () => ({ cwd: world.repo, sessionManager: { getSessionId: () => 'pi-session' } })
const fire = (name, event) => handlers[name](event, ctx())
const run = async () => (await map.model()).runs.find(r => r.id === 'pi-session')

before(async () => {
  world = tempWorld()
  map = await startMap({ repo: world.repo, home: world.home, base: await freePortBase() })
  process.env.AGENTTRAIL_PORT = String(map.port)
  agenttrail({ on: (name, fn) => { handlers[name] = fn } })
})
after(async () => { delete process.env.AGENTTRAIL_PORT; await stopAll(); world.cleanup() })

test('a pi session shows as a run with tools, written files and todos', async () => {
  fire('session_start', { reason: 'startup' })
  fire('tool_execution_start', { toolName: 'write', toolCallId: 't1', args: { path: 'src/new.js', content: 'SECRET BODY' } })
  await until(async () => (await run())?.currentTool?.name === 'write')
  const r0 = await run()
  assert.equal(r0.provider, 'pi')
  assert.equal(r0.currentTool.detail, 'src/new.js')
  assert.ok(!JSON.stringify(await map.model()).includes('SECRET BODY'))
  fire('tool_execution_end', { toolName: 'write', toolCallId: 't1', args: { path: 'src/new.js' }, isError: false })
  await until(async () => (await map.model()).activity?.file === 'src/new.js')
  fire('tool_execution_end', { toolName: 'todo', toolCallId: 't2', args: { action: 'add' }, isError: false, result: { details: { todos: [{ id: 1, text: 'Ship it', done: false }, { id: 2, text: 'Test it', done: true }] } } })
  await until(async () => (await run())?.todos.length === 2)
  assert.deepEqual((await run()).todos, [{ id: '1', content: 'Ship it', status: 'pending' }, { id: '2', content: 'Test it', status: 'completed' }])
  fire('agent_settled', {})
  await until(async () => (await run())?.status === 'idle')
  await fire('session_shutdown', { reason: 'quit' })
  assert.equal((await run()).status, 'ended')
})
