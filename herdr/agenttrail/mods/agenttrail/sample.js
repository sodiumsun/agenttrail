// Made-up worlds for people with nothing running, and for reviewing each state.
// They go through the same buildView as live data; the panel marks them as sample
// and does nothing when one is clicked.

const CLAUDE = { key: "claude", name: "Claude Code", icon: "icons/claude.svg", tint: false };
const CODEX = { key: "codex", name: "Codex", icon: "icons/codex.svg", tint: false };
const REPO = "/sample/shop";
const NOW = 1_800_000_000_000;

const stops = (...titles) => titles.map((title, i) => ({ id: title, title, at: NOW - (titles.length - i) * 60e3 }));
const evidence = (run) => ({ status: "reported", task: run.task ? "reported" : "unknown", tool: run.tool ? "observed" : "unknown", path: run.path?.length ? "inferred" : "unknown", partial: false });
const run = (id, extra) => {
  const r = { id, agent: "claude", provider: "claude", source: "hook", status: "active", terminalId: null, parentId: null, cwd: REPO, startedAt: NOW - 3600e3, lastEventAt: NOW - 30e3, task: null, tool: null, path: [], ...extra };
  return { ...r, evidence: evidence(r) };
};
const board = (runs, extra = {}) => ({ port: 5330, project: "shop", repoPath: REPO, url: null, hasPlan: true, sources: { hooks: true, claudeLogs: true, codexLogs: true }, runs, ...extra });
const agent = (address, status, tabName, program = CLAUDE, extra = {}) => ({ address, pane: `p-${address}`, space: "s1", space_name: "shop", tab: "b1", tab_index: 1, tab_name: tabName, status, app: null, program, title: tabName, seq: 1, pinned: false, focused: false, ...extra });
const panesFor = (agents, cwd = REPO) => agents.map((a) => ({ pane: a.pane, terminal: a.address, tab: a.tab, title: a.title, cwd, branch: null, status: a.status, app: null, program: a.program, focused: false, zoomed: false, movable: true }));
const world = (boards, agents, extra = {}) => ({ boards, agents, terminals: agents.map((a) => ({ address: a.address, state: "live" })), panes: panesFor(agents), now: NOW, ...extra });

const login = (extra = {}) => run("a1f0", { terminalId: "t1", task: { text: "Add the session check", state: "in_progress" }, path: stops("Watch repo", "Hooks", "Panel"), ...extra });
const one = (status, extra) => world([board([login(extra)])], [agent("t1", status, "fix login")]);

const blocked = { task: { text: "Waiting to run migrations", state: "in_progress" } };
const noTask = { task: null, tool: { name: "Read", detail: "src/login.ts", running: false } };
const search = run("c2e1", { agent: "codex", provider: "codex", source: "codex-log", terminalId: "t2", tool: { name: "Edit", detail: "src/search.ts", running: true }, path: stops("Search") });
const tidy = run("3f2a", { source: "claude-log", task: { text: "Tidy the error page", state: "in_progress" }, path: stops("Panel") });
const earlier = run("77de", { source: "claude-log", status: "idle", tool: { name: "Read", detail: "README.md", running: false } });

export const SCENARIOS = {
  all: () => world([board([login(blocked), search, tidy, earlier])], [agent("t1", "blocked", "fix login"), agent("t2", "working", "search", CODEX), agent("t3", "working", "3"), agent("t4", "idle", "4")]),
  off: () => world([], [agent("t1", "working", "fix login"), agent("t2", "idle", "api", CODEX)], { panes: [...panesFor([agent("t1", "working", "fix login")], "/sample/shop"), ...panesFor([agent("t2", "idle", "api", CODEX)], "/sample/api")] }),
  old: () => world([board([], { tooOld: true })], []),
  noplan: () => world([board([run("a1f0", { terminalId: "t1", tool: { name: "Edit", detail: "src/login.ts", running: true } })], { hasPlan: false })], [agent("t1", "working", "fix login")]),
  nohooks: () => world([board([], { sources: { hooks: false, claudeLogs: false, codexLogs: false } })], []),
  working: () => one("working"),
  blocked: () => one("blocked", blocked),
  done: () => one("done"),
  idle: () => one("idle", noTask),
  nolink: () => world([board([tidy, run("91bc", { agent: "codex", provider: "codex", source: "codex-log", terminalId: "t9", status: "ended", tool: { name: "Edit", detail: "src/api.ts", running: false }, path: stops("Panel") })])], []),
  shared: () => SCENARIOS.all(),
  remote: () => world([board([login()])], [agent("t1", "working", "fix login"), agent("vps/t7", "working", "deploy"), agent("vps/t8", "idle", "logs")]),
};

export const sampleWorld = (name) => (SCENARIOS[name] ?? SCENARIOS.all)();
