// Finds the Map for the repo of the focused terminal and keeps its /board-lite model, the
// same one the page's world view reads. No Herdr imports: the host passes fetch, sleep and
// the repo lookup in. Never shows a Map that isn't this repo's unless someone picks it.

export const PORT_BASE = 5330;
export const PORT_COUNT = 15;
export const PATHS = ["/panel", "/board-lite"]; // the only things this mod ever asks a Map for
export const POLL_MS = 3000;
export const SCAN_MS = 15000; // while no Map matches: a scan is 15 fetches, and Herdr runs them nearly one at a time
const TIMEOUT_MS = 4000; // Herdr's fetch is nearly serial and has no timeout of its own
const MISSES_TO_DROP = 2; // one slow answer is not a stopped Map

export const norm = (p) => String(p ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
const inside = (p, root) => p === root || p.startsWith(`${root}/`);
export const repoName = (p) => norm(p).split("/").pop() || String(p ?? "");

// The folder Map should follow: the focused terminal's, on this computer. Focus anywhere
// else (this view, another mod, a terminal on another machine) keeps the last one.
export function focusFolder(focus, spaces, last = null) {
  if (!focus?.terminal || !focus.cwd) return last;
  return spaces.find((s) => s.id === focus.space)?.machine ? last : norm(focus.cwd);
}

// The Map watching this folder: the deepest one, and never one outside the repo, so a
// Map on a parent folder does not stand in for a repo nested inside it. Git gives the real
// path and a terminal may have got there through a symlink, so then the root is the spot.
export function pickMap(maps, folder, root) {
  if (!folder) return null;
  const spot = root && !inside(folder, root) ? root : folder;
  const roots = maps.filter((m) => !root || inside(norm(m.repoPath), root));
  return roots.filter((m) => inside(spot, norm(m.repoPath))).sort((a, b) => norm(b.repoPath).length - norm(a.repoPath).length)[0] ?? null;
}

// A port is a whole number in range, never text from a reply: a url is built from it.
export const validPort = (p) => Number.isInteger(p) && p >= 1 && p <= 65535;
export const portOf = (v) => {
  const n = typeof v === "string" && /^\d{1,5}$/.test(v) ? Number(v) : v;
  return validPort(n) ? n : null;
};
export const baseOf = (v) => {
  const n = portOf(v);
  return n && validPort(n + PORT_COUNT - 1) ? n : PORT_BASE;
};

// Map's replies are data from a port anyone on this machine could answer, so they are
// rebuilt into the shapes the view draws: wrong types become empty, entries without an id
// go, and an id can't name a built-in object key. A reply with no plan list is no board.
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v.filter(isObj) : []);
const text = (v, d = "") => (typeof v === "string" ? v.slice(0, 2000) : typeof v === "number" && Number.isFinite(v) ? String(v) : d);
const time = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const count = (v) => time(v) ?? 0;
const safeId = (v) => { const id = text(v); return id && !(id in Object.prototype) ? id : ""; };
const ids = (v) => (Array.isArray(v) ? v.map(safeId).filter(Boolean) : []);
const touch = (a) => ({ file: text(a.file), n: count(a.n), at: count(a.at) });
const tool = (t) => ({ name: text(t.name), detail: text(t.detail), at: count(t.at) });

function cleanNode(n) {
  const id = safeId(n.id);
  return {
    ...n, id, level: text(n.level), parent: safeId(n.parent) || null, title: text(n.title) || id, status: text(n.status) || "pending",
    tech: text(n.tech), needs: ids(n.needs), links: ids(n.links), by: text(n.by) || null, src: text(n.src),
    kind: typeof n.kind === "string" ? n.kind : undefined, col: Number.isInteger(n.col) && n.col >= 0 && n.col < 1000 ? n.col : null,
    touchedAt: time(n.touchedAt), recent: list(n.recent).map(touch).filter((a) => a.file),
    derived: Boolean(n.derived), commits: list(n.commits).map((c) => ({ s: text(c.s), at: count(c.at), landed: Boolean(c.landed) })),
    meta: text(n.meta), at: time(n.at), landed: count(n.landed), bar: isObj(n.bar) ? { n: count(n.bar.n), of: count(n.bar.of) } : null, foot: text(n.foot),
  };
}

function cleanRun(r) {
  return {
    ...r, agent: text(r.agent) || "agent", ended: time(r.ended) ?? Boolean(r.ended), componentId: safeId(r.componentId) || null,
    source: text(r.source), startedAt: count(r.startedAt),
    path: list(r.path).map((x) => ({ c: safeId(x.c), at: count(x.at) })).filter((x) => x.c),
    todos: list(r.todos).map((t) => ({ content: text(t.content), status: text(t.status) })),
    currentTool: isObj(r.currentTool) ? tool(r.currentTool) : null, recentTools: list(r.recentTools).map(tool),
  };
}

export function cleanBoard(raw) {
  if (!isObj(raw) || !Array.isArray(raw.plan)) return null;
  const seen = new Set();
  const plan = list(raw.plan).map(cleanNode).filter((n) => n.id && !seen.has(n.id) && seen.add(n.id));
  const d = raw.derived;
  const at = isObj(raw.activity) ? time(raw.activity.at) : null;
  return {
    ...raw, project: text(raw.project), now: count(raw.now), plan, runs: list(raw.runs).map(cleanRun),
    activity: at == null ? null : { file: text(raw.activity.file), at }, recentActivity: list(raw.recentActivity).map(touch).filter((a) => a.file),
    derived: isObj(d) ? { ...d, git: typeof d.git === "boolean" ? d.git : null, mode: text(d.mode), days: time(d.days), shown: count(d.shown), active: count(d.active), commits: count(d.commits), quiet: count(d.quiet), worktrees: count(d.worktrees) } : null,
  };
}

async function getJson(fetch, url) {
  const res = await fetch(url);
  return res.ok ? res.json() : null;
}

// state.kind: scanning, first look | map, board is set | off, no Map for this repo
//   plain, folder is not in a repo | none, no terminal seen yet | gone, pinned Map not answering
export class Feed {
  constructor({ fetch, sleep, root = async () => null, folder = () => null, base = PORT_BASE, port = null, now = Date.now, eager = () => false }) {
    Object.assign(this, { fetch, sleep, root, folder, base: baseOf(base), now, eager });
    this.fixed = portOf(port);
    this.port = null;
    this.board = null;
    this.state = { kind: "scanning", repo: null, port: null, others: [], away: null };
    this.sig = "";
    this.maps = [];
    this.roots = new Map(); // folder -> repo root; a miss is asked again, git init is cheap to notice
    this.open = new Set(); // urls with a fetch still unanswered
    this.place = undefined;
    this.at = undefined;
    this.chosen = null; // a Map picked by hand, until focus moves to another repo
    this.misses = 0;
    this.scannedAt = -Infinity;
  }

  bounded(work) {
    return Promise.race([work, this.sleep(TIMEOUT_MS).then(() => null)]);
  }

  // One fetch per url at a time: one that never answers must not pile more up behind it.
  // Only loopback, a whole port and a known path: nothing a reply says can widen this.
  get(port, path) {
    if (!validPort(port) || !PATHS.includes(path)) return Promise.resolve(null);
    const url = `http://127.0.0.1:${port}${path}`;
    if (this.open.has(url)) return Promise.resolve(null);
    this.open.add(url);
    return this.bounded(getJson(this.fetch, url).catch(() => null).finally(() => this.open.delete(url)));
  }

  async scan() {
    const ports = Array.from({ length: PORT_COUNT }, (_, i) => this.base + i);
    const seen = await Promise.all(ports.map(async (port) => ({ port, m: await this.get(port, "/panel") })));
    // The port is the one asked, never the one a reply names.
    this.maps = seen.filter(({ m }) => isObj(m) && m.app === "agenttrail" && typeof m.repoPath === "string" && m.repoPath)
      .map(({ port, m }) => ({ port, project: text(m.project) || repoName(m.repoPath), repoPath: text(m.repoPath) }))
      .sort((a, b) => String(a.project).localeCompare(String(b.project)) || a.port - b.port);
    this.scannedAt = this.now();
  }

  async rootOf(folder) {
    if (!folder) return null;
    if (this.roots.has(folder)) return this.roots.get(folder);
    const root = norm(await this.bounded(this.root(folder).catch(() => null)));
    if (root) this.roots.set(folder, root);
    return root || null;
  }

  wanted(folder, root) {
    return this.fixed ?? this.chosen ?? pickMap(this.maps, folder, root)?.port ?? null;
  }

  async read(folder) {
    const root = this.fixed ? null : await this.rootOf(folder);
    const place = root ?? folder;
    const moved = place !== this.place;
    if (moved) Object.assign(this, { place, chosen: null, misses: 0 });
    let port = this.wanted(folder, root);
    if (!port && !this.fixed && (moved || this.eager() || this.now() - this.scannedAt >= SCAN_MS)) {
      await this.scan();
      port = this.wanted(folder, root);
    }
    let board = port ? cleanBoard(await this.get(port, "/board-lite")) : null;
    if (port && !board) {
      this.misses += 1;
      if (!moved && port === this.port && this.misses < MISSES_TO_DROP) return false;
      this.misses = 0;
      this.chosen = null;
      if (!this.fixed) {
        await this.scan();
        port = this.wanted(folder, root);
        board = port ? cleanBoard(await this.get(port, "/board-lite")) : null;
      }
    } else this.misses = 0;
    const kind = board ? "map" : this.fixed ? "gone" : !folder ? "none" : root ? "off" : "plain";
    return this.settle(kind, root ?? folder, board ? port : this.fixed, board);
  }

  settle(kind, repo, port, board) {
    const here = this.maps.find((m) => m.port === port);
    const state = { kind, repo: here?.repoPath ?? (this.fixed ? null : repo), port, others: this.maps.filter((m) => m.port !== port), away: this.chosen ? this.place : null };
    const sig = JSON.stringify({ state, board: board && { ...board, now: 0 } });
    if (sig === this.sig) return false;
    Object.assign(this, { sig, state, board, port: board ? port : null });
    return true;
  }

  choose(port) {
    this.chosen = portOf(port);
  }

  back() {
    this.chosen = null;
  }

  // Resolves true when what to show changed. Focus can move during a slow read, so that
  // read's answer is followed at once by one for where focus is now.
  async tick() {
    let changed = false;
    do {
      this.at = this.fixed ? null : this.folder();
      changed = (await this.read(this.at).catch(() => false)) || changed;
    } while (!this.fixed && this.folder() !== this.at);
    return changed;
  }
}
