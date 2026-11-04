// Map's graph, as data. A line-for-line port of boardLayout, graphNodeMetrics,
// graphDetailHeight, graphEdge and graphLinkEdge in public/index.html, so a card
// lands where it lands in the browser. No Herdr imports: node tests compare it
// against the page's own code.

export const REGION_X = 80;
export const REGION_Y = 80;
export const REGION_HEAD = 56;
export const LIVE_MS = 60000;
const TRAIL_MS = 45 * 60e3;

export const kids = (b, id) => b.plan.filter((n) => n.parent === id);
export const touched = (p, now) => Boolean(p.touchedAt && now - p.touchedAt < LIVE_MS);
export const compLive = (b, p, now) => p.status === "active" || touched(p, now) || (b.runs ?? []).some((r) => !r.ended && r.componentId === p.id);
export const isUnfolded = (b, p, ui, now) => !ui.closed.has(p.id) && (ui.open.has(p.id) || compLive(b, p, now));
export const taskIsOpen = (task, ui) => ui.openTasks.has(task.id) || (!ui.closedTasks.has(task.id) && task.status === "active");

export function taskDetails(b, task, ago) {
  const comp = b.plan.find((x) => x.id === task.parent);
  const compActive = b.plan.some((x) => x.parent === task.parent && x.status === "active");
  const live = Boolean(comp && (comp.recent ?? []).length && (task.status === "active" || task.status === "blocked" || (task.status === "done" && !compActive)));
  const rows = live ? comp.recent.slice(0, 4).map((a) => ({ label: a.file + (a.n > 1 ? ` ×${a.n}` : ""), meta: ago(a.at) })) : [];
  if (task.tech) rows.push({ label: task.tech, meta: "" });
  if (!rows.length) rows.push({ label: "No activity recorded yet", meta: "" });
  return { rows, live };
}

export function detailHeight(b, p, ui, now) {
  const list = kids(b, p.id);
  const openRows = list.filter((t) => taskIsOpen(t, ui)).reduce((a, t) => a + 16 + Math.max(taskDetails(b, t, () => "").rows.length, 5) * 20, 0);
  const sessN = (b.runs ?? []).filter((r) => r.componentId === p.id).reduce((a, r) => a + (r.todos ?? []).length, 0)
    + (touched(p, now) && !list.some((k) => k.status === "active" || k.status === "blocked") ? 1 : 0);
  const n = list.length + sessN;
  return n ? n * 44 + Math.max(0, n - 1) + openRows : 64;
}

export function nodeMetrics(b, p, ui, now) {
  const nodeW = 400;
  const nodeH = 128;
  if (!isUnfolded(b, p, ui, now)) return { w: nodeW, h: nodeH, nodeW, nodeH, detailW: 0, detailH: 0 };
  const detailH = detailHeight(b, p, ui, now);
  return { w: 400, h: nodeH + 24 + detailH, nodeW, nodeH, detailW: 400, detailH };
}

export function boardLayout(b, ui, now) {
  const phases = b.plan.filter((n) => n.level === "component");
  const byId = Object.fromEntries(phases.map((p) => [p.id, p]));
  const depth = {};
  const visiting = new Set();
  const getDepth = (p) => {
    if (depth[p.id] != null) return depth[p.id];
    if (visiting.has(p.id)) return 0;
    visiting.add(p.id);
    const preds = p.needs.filter((id) => byId[id]);
    depth[p.id] = preds.length ? 1 + Math.max(...preds.map((id) => getDepth(byId[id]))) : 0;
    visiting.delete(p.id);
    return depth[p.id];
  };
  phases.forEach(getDepth);
  const cols = {};
  phases.forEach((p) => (cols[depth[p.id]] ??= []).push(p));
  const gx = 120, gy = 48, pad = 64;
  const metrics = Object.fromEntries(phases.map((p) => [p.id, nodeMetrics(b, p, ui, now)]));
  const columnWidths = {};
  for (const [col, list] of Object.entries(cols)) columnWidths[col] = Math.max(...list.map((p) => metrics[p.id].w));
  const columnX = {};
  let nextX = pad;
  for (const col of Object.keys(cols).map(Number).sort((a, c) => a - c)) {
    columnX[col] = nextX;
    nextX += columnWidths[col] + gx;
  }
  const pos = {};
  let maxBottom = pad;
  for (const [col, list] of Object.entries(cols)) {
    let nextY = pad;
    for (const p of list) {
      const size = metrics[p.id];
      const x = columnX[col] + (columnWidths[col] - size.w) / 2;
      pos[p.id] = { x, y: nextY, ...size, nodeX: x + (size.w - size.nodeW) / 2, nodeY: nextY };
      nextY += size.h + gy;
    }
    maxBottom = Math.max(maxBottom, nextY - gy + pad);
  }
  return { phases, byId, pos, width: Math.max(nextX - gx + pad, 560), height: Math.max(maxBottom, 300) };
}

const curveH = (x1, y1, x2, y2, bend) => ({ x1, y1, ax: x1 + bend, ay: y1, bx: x2 - bend, by: y2, x2, y2 });

function needEdge(source, target, pos, handoff) {
  const a = pos[source.id], c = pos[target.id];
  const x1 = a.nodeX + a.nodeW, y1 = a.nodeY + a.nodeH / 2, x2 = c.nodeX, y2 = c.nodeY + c.nodeH / 2;
  const active = source.status === "active" || target.status === "active";
  const curve = curveH(x1, y1, x2, y2, Math.max(48, (x2 - x1) / 2));
  return { kind: handoff ? "handoff" : active ? "active" : "need", agent: handoff?.agent ?? null, arrow: true, curve };
}

function linkEdge(a, c, pos, handoff) {
  const A = pos[a.id], B = pos[c.id];
  const kind = handoff ? "handoff" : "link";
  if (Math.abs(A.nodeX - B.nodeX) > 24) {
    const L = A.nodeX < B.nodeX ? A : B, R = A.nodeX < B.nodeX ? B : A;
    const x1 = L.nodeX + L.nodeW, y1 = L.nodeY + L.nodeH / 2, x2 = R.nodeX, y2 = R.nodeY + R.nodeH / 2, mx = (x1 + x2) / 2;
    return { kind, agent: handoff?.agent ?? null, arrow: false, curve: { x1, y1, ax: mx, ay: y1, bx: mx, by: y2, x2, y2 } };
  }
  const T = A.nodeY < B.nodeY ? A : B, Bt = A.nodeY < B.nodeY ? B : A;
  const x1 = T.nodeX + T.nodeW / 2, y1 = T.y + T.h, x2 = Bt.nodeX + Bt.nodeW / 2, y2 = Bt.nodeY, my = (y1 + y2) / 2;
  return { kind, agent: handoff?.agent ?? null, arrow: false, curve: { x1, y1, ax: x1, ay: my, bx: x2, by: my, x2, y2 } };
}

export function boardEdges(b, L, now) {
  const { phases, byId, pos } = L;
  const seen = new Set();
  const pairs = [];
  for (const p of phases) for (const l of p.links ?? []) {
    if (!byId[l]) continue;
    const key = [p.id, l].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push([byId[l], p]);
  }
  const traveled = {};
  for (const r of b.runs ?? []) {
    const path = r.path ?? [];
    for (let i = 1; i < path.length; i++) {
      if (now - path[i].at > TRAIL_MS) continue;
      traveled[`${path[i - 1].c}|${path[i].c}`] = { agent: r.agent, at: path[i].at };
    }
  }
  const trails = (b.runs ?? []).flatMap((r) => {
    const ids = (r.path ?? []).map((x) => x.c);
    if (r.componentId && ids.at(-1) !== r.componentId) ids.push(r.componentId);
    const points = ids.map((id) => pos[id]).filter(Boolean).map((q) => [q.nodeX + 200, q.nodeY + 64]);
    return points.length > 1 ? [{ agent: r.agent, ended: Boolean(r.ended), points }] : [];
  });
  const edges = [
    ...phases.flatMap((p) => p.needs.filter((n) => byId[n] && pos[n] && pos[p.id]).map((n) => needEdge(byId[n], p, pos, traveled[`${n}|${p.id}`]))),
    ...pairs.map(([a, c]) => linkEdge(a, c, pos, traveled[`${a.id}|${c.id}`] ?? traveled[`${c.id}|${a.id}`])),
  ];
  return { trails, edges };
}

// Which agents are on a card: tasks that name one (Map's chips), plus live runs Map
// pinned to this component, which the page only shows in the run dock.
export function cardAgents(b, p) {
  const names = b.plan.filter((n) => n.parent === p.id && (n.status === "active" || n.status === "blocked") && n.by).map((n) => n.by);
  for (const r of b.runs ?? []) if (!r.ended && r.componentId === p.id) names.push(r.agent);
  return [...new Set(names)].slice(0, 3);
}

export const statusLabel = (s) => (s === "done" ? "Complete" : s === "active" ? "In progress" : s === "blocked" ? "Blocked" : "Not started");
export const ago = (ms, now) => {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`;
};
