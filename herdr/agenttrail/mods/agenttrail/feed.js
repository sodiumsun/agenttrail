// Finds the Map for the repo of the focused terminal and keeps its /board-lite model, the
// same one the page's world view reads. No Herdr imports: the host passes fetch, sleep and
// the repo lookup in. Never shows a Map that isn't this repo's unless someone picks it.

export const PORT_BASE = 5330;
export const PORT_COUNT = 15;
export const POLL_MS = 3000;
export const SCAN_MS = 15000; // while no Map matches: a scan is 15 fetches, and Herdr runs them nearly one at a time
const TIMEOUT_MS = 4000; // Herdr's fetch is nearly serial and has no timeout of its own
const MISSES_TO_DROP = 2; // one slow answer is not a stopped Map

export const validPort = (p) => Number.isInteger(p) && p > 0 && p < 65536;
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

async function getJson(fetch, url) {
  const res = await fetch(url);
  const body = res.ok ? await res.json() : null;
  return body && typeof body === "object" ? body : null;
}

// state.kind: scanning, first look | map, board is set | off, no Map for this repo
//   plain, folder is not in a repo | none, no terminal seen yet | gone, pinned Map not answering
export class Feed {
  constructor({ fetch, sleep, root = async () => null, folder = () => null, base = PORT_BASE, port = null, now = Date.now, eager = () => false }) {
    Object.assign(this, { fetch, sleep, root, folder, base, now, eager });
    this.fixed = port;
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
  get(port, path) {
    if (!validPort(port)) return Promise.resolve(null);
    const url = `http://127.0.0.1:${port}${path}`;
    if (this.open.has(url)) return Promise.resolve(null);
    this.open.add(url);
    return this.bounded(getJson(this.fetch, url).catch(() => null).finally(() => this.open.delete(url)));
  }

  async scan() {
    const ports = Array.from({ length: PORT_COUNT }, (_, i) => this.base + i);
    const seen = await Promise.all(ports.map((port) => this.get(port, "/panel")));
    // the port is the one scanned, never the one a server reports: a reply can't steer the next fetch
    this.maps = seen.map((m, i) => m && { ...m, port: ports[i] }).filter((m) => m?.app === "agenttrail" && typeof m.repoPath === "string")
      .map(({ port, project, repoPath }) => ({ port, project, repoPath }))
      .sort((a, b) => String(a.project).localeCompare(String(b.project)) || a.port - b.port);
    this.scannedAt = this.now();
  }

  async readBoard(port) {
    const b = await this.get(port, "/board-lite");
    return b && Array.isArray(b.plan) && b.plan.every((n) => n && typeof n === "object") ? b : null;
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
    let board = port ? await this.readBoard(port) : null;
    if (port && !board) {
      this.misses += 1;
      if (!moved && port === this.port && this.misses < MISSES_TO_DROP) return false;
      this.misses = 0;
      this.chosen = null;
      if (!this.fixed) {
        await this.scan();
        port = this.wanted(folder, root);
        board = port ? await this.readBoard(port) : null;
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
    this.chosen = port;
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
