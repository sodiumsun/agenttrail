import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyTaskEffect, claudeTaskEffect, taskList } from '../bin/lib/tasks.mjs'

const created = (id, subject) => `Task #${id} created successfully: ${subject}`
const apply = (todos, ...args) => {
  const effect = claudeTaskEffect(...args)
  return effect ? applyTaskEffect(todos, effect) ?? todos : todos
}
const one = [{ id: '1', content: 'Write the parser', status: 'in_progress' }]

test('TaskCreate commits from the structured hook result and from text', () => {
  const input = { subject: 'Write the parser', description: 'PRIVATE', activeForm: 'PRIVATE' }
  const expected = [{ id: '1', content: 'Write the parser', status: 'pending' }]
  assert.deepEqual(apply([], 'TaskCreate', input, { task: { id: '1', subject: 'Write the parser', description: 'PRIVATE' } }), expected)
  assert.deepEqual(apply([], 'TaskCreate', input, created(1, 'Write the parser')), expected)
  assert.deepEqual(apply([], 'TaskCreate', input, { content: [{ type: 'text', text: created(1, 'Write the parser') }] }), expected)
  assert.ok(!JSON.stringify(apply([], 'TaskCreate', input, created(1, 'Write the parser'))).includes('PRIVATE'))
})

test('TaskUpdate commits the confirmed status and subject', () => {
  const result = { success: true, taskId: '1', updatedFields: ['status'], statusChange: { from: 'in_progress', to: 'completed' } }
  assert.equal(apply(one, 'TaskUpdate', { taskId: '1', status: 'completed' }, result)[0].status, 'completed')
  assert.equal(apply(one, 'TaskUpdate', { taskId: '1', status: 'completed' }, 'Updated task #1 owner, status')[0].status, 'completed')
  assert.equal(apply(one, 'TaskUpdate', { taskId: '1', subject: 'Renamed' }, { success: true, taskId: '1', updatedFields: ['subject'] })[0].content, 'Renamed')
  assert.deepEqual(apply(one, 'TaskUpdate', { taskId: '1', status: 'deleted' }, { success: true, taskId: '1', updatedFields: ['deleted'], statusChange: { from: 'pending', to: 'deleted' } }), [])
})

test('a failed or unrecognised result keeps the last confirmed list', () => {
  const propose = { taskId: '1', status: 'completed' }
  const rejected = [
    undefined, null, '', {},
    { success: false, taskId: '1', updatedFields: ['status'], statusChange: { to: 'completed' } },
    { success: false, taskId: '1', error: 'Task not found' },
    { is_error: true, content: 'Updated task #1 status' },
    { isError: true, content: [{ type: 'text', text: 'Updated task #1 status' }] },
    { error: 'denied' },
    'Task #1 not found',
    'Updated task #2 status',
    'Updated task #1 owner',
    { success: true, taskId: '2', updatedFields: ['status'], statusChange: { to: 'completed' } },
    { success: true, taskId: '1', updatedFields: [] },
    { somethingNew: true },
    [{ type: 'text', text: 'first' }, { type: 'text', text: 'second' }],
    42,
  ]
  for (const result of rejected) assert.deepEqual(apply(one, 'TaskUpdate', propose, result), one, JSON.stringify(result))
  for (const result of [undefined, 'Task #1 failed to create: nope', { error: 'no' }, { success: false }, { task: { subject: 'no id' } }]) {
    assert.deepEqual(apply(one, 'TaskCreate', { subject: 'New' }, result), one, JSON.stringify(result))
  }
})

test('an update for a task never seen is dropped, not named', () => {
  assert.deepEqual(apply(one, 'TaskUpdate', { taskId: '9', status: 'completed' }, { success: true, taskId: '9', updatedFields: ['status'], statusChange: { to: 'completed' } }), one)
})

test('TaskList and TaskGet report confirmed state', () => {
  const tasks = [{ id: '1', subject: 'A', status: 'completed', owner: 'PRIVATE' }, { id: '2', subject: 'B', status: 'pending' }, { id: '3', subject: 'C', status: 'odd' }]
  assert.deepEqual(apply(one, 'TaskList', {}, { tasks }), [{ id: '1', content: 'A', status: 'completed' }, { id: '2', content: 'B', status: 'pending' }])
  assert.equal(apply(one, 'TaskGet', { taskId: '1' }, { task: { id: '1', subject: 'Write the parser', status: 'completed' } })[0].status, 'completed')
  assert.deepEqual(apply(one, 'TaskList', {}, 'some text'), one)
})

test('legacy TodoWrite follows the same rule', () => {
  const todos = [{ content: 'Done now', status: 'completed' }]
  assert.deepEqual(apply(one, 'TodoWrite', { todos }, { oldTodos: [], newTodos: todos }), todos)
  assert.deepEqual(apply(one, 'TodoWrite', { todos }, 'Todos have been modified successfully.'), todos)
  for (const result of [undefined, {}, 'Something else', { error: 'bad' }, { is_error: true, newTodos: todos }, { success: false, newTodos: todos }]) {
    assert.deepEqual(apply(one, 'TodoWrite', { todos }, result), one, JSON.stringify(result))
  }
})

test('other tools never touch the list', () => {
  assert.equal(claudeTaskEffect('Read', { file_path: 'x' }, 'ok'), null)
  assert.equal(claudeTaskEffect(undefined, {}, 'ok'), null)
})

test('taskList keeps only well formed items', () => {
  assert.equal(taskList('nope'), null)
  assert.deepEqual(taskList([{ step: 'A', status: 'pending' }, { step: 'B', status: 'weird' }, { status: 'pending' }, null]), [{ content: 'A', status: 'pending' }])
})
