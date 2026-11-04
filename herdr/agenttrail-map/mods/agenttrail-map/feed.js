// Finds one Map and keeps its /board-lite model, the same one the page's world view
// reads. No Herdr imports: the host passes fetch and sleep in.

export const PORT_BASE = 5330;
export const PORT_COUNT = 15;
export const POLL_MS = 3000;
const TIMEOUT_MS = 4000; // Herdr's fetch is nearly serial and has no timeout of its own

async function getJson(fetch, url) {
  const res = await fetch(url);
  return res.ok ? res.json() : null;
}

export class Feed {
  constructor({ fetch, sleep, base = PORT_BASE, port = null, folder = () => null }) {
    Object.assign(this, { fetch, sleep, base, folder });
    this.fixed = port;
    this.port = port;
    this.board = null;
    this.sig = "";
    this.waiting = false;
  }

  async find() {
    const ports = Array.from({ length: PORT_COUNT }, (_, i) => this.base + i);
    const seen = await Promise.all(ports.map((port) => getJson(this.fetch, `http://127.0.0.1:${port}/panel`).catch(() => null)));
    const maps = seen.filter((m) => m?.app === "agenttrail");
    const here = this.folder();
    return (maps.find((m) => here && (here === m.repoPath || here.startsWith(`${m.repoPath}/`))) ?? maps[0])?.port ?? null;
  }

  async read() {
    this.port ??= await this.find();
    if (!this.port) return false;
    const board = await getJson(this.fetch, `http://127.0.0.1:${this.port}/board-lite`).catch(() => null);
    if (!board?.plan) {
      this.port = this.fixed;
      this.board = null;
      return true;
    }
    const sig = JSON.stringify({ ...board, now: 0 });
    if (sig === this.sig) return false;
    this.sig = sig;
    this.board = board;
    return true;
  }

  // Resolves true when the board changed. One fetch at a time: one that never
  // answers must not pile more up behind it.
  async tick() {
    if (this.waiting) return false;
    this.waiting = true;
    const answer = this.read().catch(() => false).finally(() => { this.waiting = false; });
    return Promise.race([answer, this.sleep(TIMEOUT_MS).then(() => false)]);
  }
}
