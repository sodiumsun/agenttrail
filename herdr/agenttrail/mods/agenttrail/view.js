// Turns Map boards and Herdr's agents into the rows the panel draws. Pure.

import { RECENT_MS, isRemote, linkRuns, norm, repoOf, runKey } from "./link.js";

// Most urgent first; matches Herdr's blocked > done > working > idle.
const RANK = { blocked: 6, done: 5, working: 4, idle: 3, interrupted: 2, unknown: 1, ended: 0 };
const FROM_MAP = { active: "working", idle: "idle", ended: "ended", interrupted: "interrupted", unknown: "unknown" };
const UNLINKED = {
  none: "No terminal link",
  closed: "Terminal closed",
  replaced: "Earlier session in this terminal",
  ambiguous: "Can't tell which terminal",
};

const capital = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "Agent");
const clean = (s) => String(s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

// A row's name: what the agent is, and the tab it's in when someone named one.
function agentName(a) {
  const tab = /^\d+$/.test(a.tab_name ?? "") ? clean(a.title) : a.tab_name;
  const label = tab && tab !== a.program?.name ? tab : a.space_name;
  return [a.program?.name || capital(a.app), label].filter(Boolean).join(" · ");
}

function lineTask(run, hasRun) {
  if (!hasRun) return { text: "Nothing seen from this agent yet", label: null };
  if (run.task) return { text: run.task.text, label: "reported" };
  if (run.tool) return { text: [run.tool.name, run.tool.detail].filter(Boolean).join(" "), label: "observed" };
  if (run.evidence?.task === "reported") return { text: "No open tasks", label: "reported" };
  return { text: "No task reported", label: null };
}

// Keeps the end of the path, which is where the agent is now. `keep` caps the
// stops; `max` drops older ones until the line fits in that many characters.
export function pathText(titles, { keep = 5, max = Infinity } = {}) {
  let stops = titles.slice(-keep);
  let cut = stops.length < titles.length;
  const line = () => [...(cut ? ["…"] : []), ...stops].join(" → ");
  while (stops.length > 1 && line().length > max) {
    stops = stops.slice(1);
    cut = true;
  }
  return line();
}

function runRow(board, run, link) {
  const agent = link.agent ?? null;
  const status = agent ? agent.status : FROM_MAP[run.status] ?? "unknown";
  return {
    key: `${board.port}:${run.id}`,
    name: agent ? agentName(agent) : `${capital(run.provider)} · ${String(run.id).slice(0, 4)}`,
    program: agent?.program ?? null,
    provider: run.provider,
    status,
    statusFrom: agent ? "herdr" : "map",
    line: lineTask(run, true),
    path: (run.path ?? []).map((s) => s.title),
    pathEmpty: board.hasPlan ? "No project path yet" : "No path without a plan",
    partial: Boolean(run.evidence?.partial),
    address: link.address,
    agent: Boolean(agent),
    how: link.how ?? null,
    unlinked: link.address ? null : UNLINKED[link.why] ?? UNLINKED.none,
    at: run.lastEventAt ?? 0,
  };
}

function agentRow(board, a) {
  return {
    key: `${board.port}:${a.address}`,
    name: agentName(a),
    program: a.program ?? null,
    provider: a.program?.key ?? null,
    status: a.status,
    statusFrom: "herdr",
    line: lineTask(null, false),
    path: [],
    pathEmpty: board.hasPlan ? "No project path yet" : "No path without a plan",
    partial: false,
    address: a.address,
    agent: true,
    how: "repo",
    unlinked: null,
    at: 0,
  };
}

function boardNote(board, rows, older) {
  if (board.tooOld) return "This Map is too old for the panel. Restart it with the latest agenttrail.";
  if (board.tooNew) return "This Map is newer than the panel. Update the panel.";
  const notes = [];
  if (!board.hasPlan) notes.push("No PLAN.md yet, so no path. Run agenttrail init in this repo.");
  if (!rows.length && !older) {
    const { hooks, claudeLogs, codexLogs } = board.sources ?? {};
    notes.push(hooks || claudeLogs || codexLogs
      ? "Watching this repo. No agent sessions in the last two hours."
      : "Watching this repo. No hooks or agent logs found yet. Map follows Claude and Codex logs by itself; agenttrail init --hooks-only adds terminal links.");
  }
  return notes.join(" ") || null;
}

export function buildView({ boards, agents, terminals = [], panes = [], now, fallbackFolder = null, remoteExtra = 0 }) {
  const { links, contested, claimed } = linkRuns({ boards, agents, terminals, panes, now });
  const paneOf = new Map(panes.map((p) => [p.pane, p]));
  const roots = boards.map((b) => b.repoPath);
  const local = agents.filter((a) => !isRemote(a.address));
  const groups = boards.map((board) => {
    const rows = [];
    let older = 0;
    for (const run of board.runs ?? []) {
      if (run.parentId) continue; // a sub-agent belongs to its parent's row
      const link = links.get(runKey(board, run)) ?? { address: null, why: "none" };
      if (!link.address && link.why !== "ambiguous" && now - run.lastEventAt > RECENT_MS) { older += 1; continue; }
      rows.push(runRow(board, run, link));
    }
    for (const a of local) {
      if (claimed.has(a.address) || contested.has(a.address)) continue;
      if (repoOf(paneOf.get(a.pane)?.cwd, roots) === norm(board.repoPath)) rows.push(agentRow(board, a));
    }
    rows.sort((x, y) => (RANK[y.status] ?? 0) - (RANK[x.status] ?? 0) || y.at - x.at);
    return {
      key: String(board.port),
      project: board.project,
      url: board.url ?? null,
      note: boardNote(board, rows, older),
      older,
      rows,
    };
  });

  // Agents here in no watched repo, by folder: each folder can start a Map.
  const folders = new Map();
  for (const a of local) {
    const cwd = paneOf.get(a.pane)?.cwd;
    if (!cwd || claimed.has(a.address) || contested.has(a.address) || repoOf(cwd, roots)) continue;
    folders.set(cwd, (folders.get(cwd) ?? 0) + 1);
  }
  const unwatched = [...folders].map(([folder, count]) => ({ folder, count }));
  if (!unwatched.length && !boards.length && fallbackFolder) unwatched.push({ folder: fallbackFolder, count: 0 });

  return {
    off: boards.length === 0,
    groups,
    unwatched,
    remote: agents.filter((a) => isRemote(a.address)).length + remoteExtra,
  };
}
