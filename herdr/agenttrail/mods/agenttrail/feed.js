// Finds Maps on this machine and keeps their /panel feeds. No Herdr imports: the
// host passes fetch, sleep and now in, so node tests drive it with a fake clock.

export const PORT_BASE = 5330;
export const PORT_COUNT = 15;
export const POLL_MS = 3000;
export const MAX_DELAY_MS = 30000;
export const SCAN_EVERY = 5; // rounds between looks at the ports no Map is on
export const MISSES_TO_DROP = 2;
export const SCHEMA = 1;
// Herdr runs fetches nearly one at a time, about 250 ms each, so a 15-port scan needs
// this long. Too short, and a Map on a late port is missed or counted as gone.
export const TIMEOUT_MS = 4000;

export const portsFrom = (base) => Array.from({ length: PORT_COUNT }, (_, i) => base + i);
export const delayAfter = (failures) => Math.min(POLL_MS * 2 ** Math.max(0, failures), MAX_DELAY_MS);

async function getJson(fetch, url) {
  const res = await fetch(url);
  if (!res.ok) return { status: res.status, body: null };
  return { status: res.status, body: await res.json() };
}

// One Map's feed, or null when nothing of ours is there. A Map from before the
// feed still answers /whoami, so the panel can say so instead of showing nothing.
export async function readBoard(fetch, port) {
  const base = `http://127.0.0.1:${port}`;
  try {
    const { status, body } = await getJson(fetch, `${base}/panel`);
    if (body?.app === "agenttrail") {
      if (body.schema === SCHEMA) return { ...body, port };
      return { port, project: body.project, repoPath: body.repoPath, url: body.url, tooNew: true, runs: [] };
    }
    if (status !== 404) return null;
    const who = (await getJson(fetch, `${base}/whoami`)).body;
    if (!who?.repoPath || !who?.project) return null;
    return { port, project: who.project, repoPath: who.repoPath, url: `http://localhost:${port}`, tooOld: true, runs: [] };
  } catch {
    return null;
  }
}

const withoutClock = (board) => ({ ...board, now: 0 });

export class Poller {
  constructor({ fetch, sleep, now, base = PORT_BASE, changed = () => {} }) {
    Object.assign(this, { fetch, sleep, now, changed });
    this.ports = portsFrom(base);
    this.boards = new Map(); // port -> feed
    this.misses = new Map();
    this.failures = 0;
    this.rounds = 0;
    this.scanned = false;
    this.next = 0;
    this.sig = "";
  }

  list() {
    return [...this.boards.values()].sort((a, b) => String(a.project).localeCompare(String(b.project)) || a.port - b.port);
  }

  // A fetch that never answers must not stall the round.
  read(port) {
    const late = this.sleep(TIMEOUT_MS).then(() => null);
    return Promise.race([readBoard(this.fetch, port), late]);
  }

  async round() {
    const scan = this.boards.size === 0 || this.rounds % SCAN_EVERY === 0;
    this.rounds += 1;
    const ports = scan ? this.ports : [...this.boards.keys()];
    const results = await Promise.all(ports.map((port) => this.read(port)));
    ports.forEach((port, i) => {
      if (results[i]) {
        this.boards.set(port, results[i]);
        this.misses.delete(port);
      } else if (this.boards.has(port)) {
        const missed = (this.misses.get(port) ?? 0) + 1;
        this.misses.set(port, missed);
        if (missed >= MISSES_TO_DROP) {
          this.boards.delete(port);
          this.misses.delete(port);
        }
      }
    });
    this.failures = this.boards.size ? 0 : this.failures + 1;
    this.next = this.now() + delayAfter(this.boards.size ? 0 : this.failures - 1);
    const first = !this.scanned;
    this.scanned = true;
    const sig = JSON.stringify(this.list().map(withoutClock));
    if (sig !== this.sig || first) {
      this.sig = sig;
      this.changed();
    }
  }

  // Look again at the next tick rather than wait out a backoff.
  wake() {
    this.failures = 0;
    this.next = 0;
  }

  async tick() {
    if (this.now() >= this.next) await this.round();
  }
}
