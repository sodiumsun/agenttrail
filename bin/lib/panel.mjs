// A small summary of this Map (GET /panel), which the Herdr mod reads to find it. A stable, versioned shape, so the
// mod never depends on how Map keeps a run internally. Raise PANEL_SCHEMA for any
// change a schema-1 reader could misread; adding a field is not one.
export const PANEL_SCHEMA = 1
const PATH_STOPS = 5

// The task to show: the one in progress, else the next pending. Null when the
// agent never reported a list, or reported one with nothing open.
function openTask(run) {
  const todos = run.todosUpdatedAt ? run.todos || [] : []
  const task = todos.find(t => t.status === 'in_progress') || todos.find(t => t.status === 'pending')
  return task ? { text: task.content, state: task.status } : null
}

// The tool running now, else the last one seen. Map's own detail policy applies.
function lastTool(run) {
  const tool = run.currentTool || run.recentTools?.[0]
  return tool ? { name: tool.name, detail: tool.detail || null, running: tool === run.currentTool } : null
}

// One file can match several components, and an agent moves back and forth, so
// the raw trail repeats. Keep each component's latest visit, oldest first.
// A component no longer in the plan has no name to show and is left out.
export function recentPath(trail, titles) {
  const seen = new Set()
  const stops = []
  for (const stop of [...(trail || [])].reverse()) {
    if (seen.has(stop.c) || !titles.has(stop.c)) continue
    seen.add(stop.c)
    stops.push({ id: stop.c, title: titles.get(stop.c), at: stop.at })
    if (stops.length === PATH_STOPS) break
  }
  return stops.reverse()
}

export function panelRun(run, titles) {
  const task = openTask(run)
  const tool = lastTool(run)
  const path = recentPath(run.path, titles)
  return {
    id: run.id,
    agent: run.agent,
    provider: run.provider,
    source: run.source,
    status: run.status,
    terminalId: run.terminalId ?? null,
    parentId: run.parentId ?? null,
    cwd: run.cwd,
    startedAt: run.startedAt,
    lastEventAt: run.lastEventAt,
    task,
    tool,
    path,
    evidence: {
      status: 'reported',
      task: run.todosUpdatedAt ? 'reported' : 'unknown',
      tool: tool ? 'observed' : 'unknown',
      path: path.length ? 'inferred' : 'unknown',
      partial: Boolean(run.historyLimited),
    },
  }
}

export function panelFeed({ project, repoPath, port, hasPlan, components, runs, sources, now }) {
  const titles = new Map(components.map(c => [c.id, c.title]))
  return {
    app: 'agenttrail',
    schema: PANEL_SCHEMA,
    project,
    repoPath,
    port,
    url: `http://localhost:${port}`,
    now,
    hasPlan,
    sources,
    runs: runs.map(r => panelRun(r, titles)).sort((a, b) => b.lastEventAt - a.lastEventAt),
  }
}
