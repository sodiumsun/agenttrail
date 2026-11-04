// Which Herdr terminal a Map run belongs to. Pure: node tests run it directly.
// The rule: a terminal id is exact. A repo is a hint, good only when exactly one
// agent and exactly one live run could match. Anything else stays unlinked.

export const RECENT_MS = 30 * 60e3;

export const isRemote = (address) => String(address).includes("/");

export const norm = (p) => String(p ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
const inside = (p, root) => p === root || p.startsWith(`${root}/`);

// The watched repo a folder is in: the deepest, so a repo nested in another
// belongs to the inner one.
export function repoOf(cwd, roots) {
  const p = norm(cwd);
  if (!p) return null;
  return roots.map(norm).filter((r) => r && inside(p, r)).sort((a, b) => b.length - a.length)[0] ?? null;
}

// An agent running a known other program can't be this run. An unknown one might be.
const sameProgram = (run, agent) => {
  const key = agent.program?.key;
  return !key || key === "agent" || key === "program" || key === run.provider;
};

export const runKey = (board, run) => `${board.port}:${run.id}`;

// Returns { links: Map(runKey -> link), contested, claimed }: sets of addresses.
// link: { address, agent, how: "terminal" | "repo" } when linked, else
// { address: null, why: "none" | "closed" | "replaced" | "ambiguous" }.
export function linkRuns({ boards, agents, terminals, panes, now }) {
  const local = agents.filter((a) => !isRemote(a.address));
  const byAddress = new Map(local.map((a) => [a.address, a]));
  const live = new Set(terminals.filter((t) => t.state === "live" && !isRemote(t.address)).map((t) => t.address));
  const links = new Map();
  const contested = new Set();
  const claimed = new Set();

  // Exact ids. Several sessions can pass through one terminal: the newest owns it.
  const owners = new Map();
  for (const board of boards) for (const run of board.runs ?? []) {
    if (!run.terminalId) continue;
    const held = owners.get(run.terminalId);
    if (!held || run.lastEventAt > held.lastEventAt) owners.set(run.terminalId, run);
  }
  for (const board of boards) for (const run of board.runs ?? []) {
    if (!run.terminalId) continue;
    const key = runKey(board, run);
    const agent = byAddress.get(run.terminalId) ?? null;
    if (!agent && !live.has(run.terminalId)) links.set(key, { address: null, why: "closed" });
    else if (owners.get(run.terminalId) !== run) links.set(key, { address: null, why: "replaced" });
    else {
      links.set(key, { address: run.terminalId, agent, how: "terminal" });
      claimed.add(run.terminalId);
    }
  }

  // Repo hints, for runs with no id that are recent enough to still be the agent there.
  const roots = boards.map((b) => b.repoPath);
  const paneOf = new Map(panes.map((p) => [p.pane, p]));
  const free = local.filter((a) => !claimed.has(a.address));
  const repoOfAgent = new Map(free.map((a) => [a.address, repoOf(paneOf.get(a.pane)?.cwd, roots)]));
  const wants = new Map(); // address -> keys of the runs that could be it
  const options = new Map(); // run key -> candidate agents
  for (const board of boards) {
    const root = norm(board.repoPath);
    for (const run of board.runs ?? []) {
      if (run.terminalId || run.parentId) continue;
      const key = runKey(board, run);
      const fresh = ["active", "idle"].includes(run.status) && now - run.lastEventAt <= RECENT_MS;
      if (!fresh) { links.set(key, { address: null, why: "none" }); continue; }
      const found = free.filter((a) => repoOfAgent.get(a.address) === root && sameProgram(run, a));
      options.set(key, found);
      for (const a of found) wants.set(a.address, [...(wants.get(a.address) ?? []), key]);
    }
  }
  for (const [key, found] of options) {
    if (found.length === 0) links.set(key, { address: null, why: "none" });
    else if (found.length === 1 && wants.get(found[0].address).length === 1) {
      links.set(key, { address: found[0].address, agent: found[0], how: "repo" });
      claimed.add(found[0].address);
    } else {
      links.set(key, { address: null, why: "ambiguous" });
      for (const a of found) contested.add(a.address);
    }
  }
  return { links, contested, claimed };
}
