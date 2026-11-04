// Native task lists: what an agent reports as its current work.
// A proposed change is only a proposal. It commits on a recognised success
// acknowledgement; a failed, unknown or missing result keeps the last confirmed
// list. Only titles and statuses survive: descriptions and owners are dropped.
const LIVE = new Set(['pending', 'in_progress', 'completed'])
const MAX_TASKS = 100
const TODO_TOOL = /^(TodoWrite|todo_write|write_todos)$/
const TASK_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList'])
const CREATED = /^Task #(\d+) created successfully: ([^\r\n]+)$/
const UPDATED = /^Updated task #(\d+) ((?:owner|status|subject|description|activeForm|metadata|blocks|blockedBy|deleted)(?:, (?:owner|status|subject|description|activeForm|metadata|blocks|blockedBy|deleted))*)$/

export const clean = (v, max = 180) => typeof v === 'string' ? v.replace(/[\x00-\x1f]/g, ' ').trim().slice(0, max) : ''
const taskId = v => typeof v === 'string' || typeof v === 'number' ? clean(String(v), 100) : ''

// Accepts Claude's {content|subject} and Codex's {step} items.
export function taskList(items) {
  if (!Array.isArray(items)) return null
  const out = []
  for (const t of items.slice(0, MAX_TASKS)) {
    const content = clean(t?.content || t?.step || t?.subject || t?.title)
    if (!content || !LIVE.has(t.status)) continue
    const id = taskId(t.id)
    out.push(id ? { id, content, status: t.status } : { content, status: t.status })
  }
  return out
}

const reportsFailure = r => !!r && typeof r === 'object' && !Array.isArray(r) && !!(r.is_error || r.isError || r.error || r.success === false)
const singleText = blocks => blocks.length === 1 && blocks[0]?.type === 'text' ? blocks[0].text : null

// Hooks and logs wrap the same result differently; reduce it to one of
// { failed }, { value } for a structured result, { text }, or {} when unknown.
function readResponse(response) {
  if (response === undefined || response === null) return {}
  if (reportsFailure(response)) return { failed: true }
  let r = response
  if (Array.isArray(r)) r = singleText(r)
  else if (typeof r === 'object' && 'content' in r) r = Array.isArray(r.content) ? singleText(r.content) : r.content
  if (typeof r === 'string') {
    const text = r.trim()
    try {
      const parsed = JSON.parse(text)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return reportsFailure(parsed) ? { failed: true } : { value: parsed }
    } catch {}
    return { text }
  }
  return r && typeof r === 'object' && !Array.isArray(r) ? { value: r } : {}
}

function createdTask(input, { text, value }) {
  if (text !== undefined) {
    const m = CREATED.exec(text)
    const content = clean(input.subject) || clean(m?.[2])
    return m && content ? { id: m[1], content, status: 'pending' } : null
  }
  const id = taskId(value?.task?.id), content = clean(value?.task?.subject) || clean(input.subject)
  if (!id || !content) return null
  return { id, content, status: LIVE.has(value.task.status) ? value.task.status : 'pending' }
}

function updatedTask(input, { text, value }) {
  const wanted = taskId(input.taskId)
  let id, fields, status
  if (text !== undefined) {
    const m = UPDATED.exec(text)
    if (!m) return null
    id = m[1]; fields = m[2].split(', ')
  } else if (value?.task) {
    id = taskId(value.task.id) || wanted
    if (!id || (wanted && id !== wanted)) return null
    return knownChange({ id, content: clean(value.task.subject), status: value.task.status })
  } else if (value?.success === true) {
    id = taskId(value.taskId) || wanted
    fields = Array.isArray(value.updatedFields) ? value.updatedFields : []
    status = value.statusChange?.to
  } else return null
  if (!id || (wanted && id !== wanted)) return null
  status ??= fields.includes('status') || fields.includes('deleted') ? input.status : undefined
  return knownChange({ id, content: fields.includes('subject') ? clean(input.subject) : '', status })
}
function knownChange({ id, content, status }) {
  const statusKnown = LIVE.has(status) || status === 'deleted'
  if (!statusKnown && !content) return null
  return { id, ...(content ? { content } : {}), ...(statusKnown ? { status } : {}) }
}

// The effect of one finished Claude tool call on the task list, or null for none.
export function claudeTaskEffect(tool, input, response) {
  const isTodo = TODO_TOOL.test(tool || '')
  if (!isTodo && !TASK_TOOLS.has(tool)) return null
  input = input && typeof input === 'object' ? input : {}
  const result = readResponse(response)
  if (result.failed) return null
  if (isTodo) {
    const newTodos = result.value?.newTodos
    const acknowledged = Array.isArray(newTodos) || /modified successfully/i.test(result.text || '')
    const list = acknowledged ? taskList(Array.isArray(newTodos) ? newTodos : input.todos) : null
    return list ? { replace: list, partial: input.merge === true } : null
  }
  if (result.text === undefined && result.value === undefined) return null
  if (tool === 'TaskList') {
    const list = taskList(result.value?.tasks)
    return list ? { replace: list } : null
  }
  let change = null
  if (tool === 'TaskCreate') change = createdTask(input, result)
  else if (tool === 'TaskUpdate') change = updatedTask(input, result)
  else if (result.value?.task) change = knownChange({ id: taskId(result.value.task.id), content: clean(result.value.task.subject), status: result.value.task.status })
  return change?.id ? { change } : null
}

// The next list after an effect, or null when nothing changed. A status for a
// task whose title was never seen is dropped: no invented name stands in for it.
export function applyTaskEffect(todos, effect) {
  if (effect.replace) {
    if (!effect.partial) return effect.replace
    const incoming = effect.replace.filter(t => t.id)
    const ids = new Set(incoming.map(t => t.id))
    return [...todos.filter(t => !ids.has(t.id)), ...incoming]
  }
  const { id, content, status } = effect.change
  const prior = todos.find(t => t.id === id)
  if (status === 'deleted') return prior ? todos.filter(t => t !== prior) : null
  if (prior) return todos.map(t => t === prior ? { ...t, ...(content ? { content } : {}), ...(status ? { status } : {}) } : t)
  return content && status && todos.length < MAX_TASKS ? [...todos, { id, content, status }] : null
}
