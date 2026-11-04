// Agenttrail for Herdr: which part of the project each agent touched, beside its
// terminal, with every claim labelled reported, observed or inferred. Read-only:
// the only things it starts are a browser tab and, when asked, a Map terminal.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, exec, focused, home, notify, panes, props, run, settings, spaces, terminals, theme, window } from "herdr";
import { POLL_MS, PORT_BASE, Poller } from "./feed.js";
import { buildView, pathText } from "./view.js";
import { sampleWorld } from "./sample.js";

const NARROW = 260;
const CHAR_PX = 6.1; // of the 11.5px path line, near enough to fit it by length
const TAG_COLOR = { reported: "done", observed: "accent", inferred: "working" };
const START_COMMAND = ["npx", "-y", "agenttrail@latest"];

const shortFolder = (folder, home) => (home && folder.startsWith(home) ? `~${folder.slice(home.length)}` : folder);

export default class Agenttrail extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.width = 340;
    this.sample = p.sample ?? null;
    this.pinnedSample = Boolean(p.sample);
    this.command = p.command ?? START_COMMAND;
    this.starting = new Set();
    this.poller = new Poller({
      fetch: (url) => fetch(url),
      sleep: (ms) => this.sleep(ms),
      now: () => Date.now(),
      base: p.portBase ?? PORT_BASE,
    });
    if (this.pinnedSample) return;
    cx.spawn(async (cx) => {
      this.sleep = (ms) => cx.sleep(ms);
      this.poller.changed = () => cx.notify();
      for (;;) {
        await this.poller.tick();
        await cx.sleep(POLL_MS);
      }
    });
  }

  openMap(url) {
    const os = window()?.platform;
    const [program, args] = os === "macos" ? ["open", [url]] : os === "windows" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
    exec(program, args).catch(() => notify({ title: "Couldn't open the map", body: url, level: "error" }));
  }

  // Map outlives this panel in a terminal of its own; `exec` would stop it after 30 seconds.
  startMap(folder, cx) {
    this.starting.add(folder);
    cx.notify();
    cx.spawn(async (cx) => {
      const git = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: folder }).catch(() => null);
      const repo = git?.code === 0 ? git.stdout.trim() : folder;
      run("terminal.open", { argv: [...this.command, repo, "--no-open"], folder: repo, place: "tab", name: "Agenttrail Map" });
      this.poller.wake();
      cx.notify();
    });
  }

  jump(row) {
    if (this.sample || !row.address) return;
    if (row.agent) run("agent.focus", { terminal: row.address });
    else run("pane.focus", { terminal: row.address });
  }

  tag(t, label, id, narrow) {
    return div()
      .id(id)
      .flex_none()
      .px(4)
      .h(14)
      .flex()
      .items_center()
      .rounded(4)
      .border(1)
      .border_color(t.border)
      .text_size(9.5)
      .text_color(t[TAG_COLOR[label]] ?? t.dim)
      .tooltip(label)
      .child(narrow ? label[0].toUpperCase() : label);
  }

  status(t, row, narrow) {
    const word = (text) => div().flex_none().text_size(10.5).text_color(t.dim).child(text);
    if (row.status === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).mx(1).flex_none().text_color(t.working).spin(900);
    if (row.status === "blocked") return div().flex_none().px(6).h(18).rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).flex().items_center().child(narrow ? "!" : "Needs you");
    if (row.status === "done") return div().size(7).mx(3).flex_none().rounded(4).bg(t.done);
    if (row.status === "idle") return div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
    return word(row.status === "interrupted" ? "Interrupted" : row.status === "ended" ? "Ended" : "Unknown");
  }

  icon(t, row) {
    const known = row.program ?? { claude: { icon: "icons/claude.svg" }, codex: { icon: "icons/codex.svg" } }[row.provider];
    if (known?.icon) return known.tint ? svg(known.icon).size(16).flex_none().text_color(t.foreground) : image(known.icon).w(16).h(16).flex_none();
    return div().size(16).flex_none().rounded(4).bg(t.raised).text_size(10).font_bold().text_color(t.muted).flex().items_center().justify_center().child(String(row.provider ?? "?")[0].toUpperCase());
  }

  row(t, row, narrow) {
    const line = (text, color, size, label, id) => h_flex().pl(23).gap(7).items_center().min_w(0)
      .child(div().flex_1().min_w(0).truncate().text_size(size).text_color(color).child(text))
      .when(Boolean(label), (el) => el.child(this.tag(t, label, id, narrow)));
    const fits = Math.floor((this.width - 90) / CHAR_PX);
    const path = row.path.length ? pathText(row.path, { keep: narrow ? 2 : 5, max: fits }) : null;
    const clickable = Boolean(row.address) && !this.sample;
    return v_flex()
      .id(`row-${row.key}`)
      .px(8)
      .py(6)
      .gap(2)
      .flex_none()
      .rounded(8)
      .when(clickable, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => this.jump(row)))
      .child(h_flex().gap(7).items_center().min_w(0)
        .child(this.icon(t, row))
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.foreground).child(row.name))
        .child(this.status(t, row, narrow)))
      .child(line(row.line.text, row.line.label ? t.foreground : t.dim, row.line.label ? 12.5 : 11.5, row.line.label, `line-${row.key}`))
      .child(path ? line(path, t.muted, 11.5, "inferred", `path-${row.key}`) : line(row.pathEmpty, t.dim, 11.5, null, `path-${row.key}`))
      .when(Boolean(row.unlinked), (el) => el.child(line(row.unlinked, t.dim, 10.5, null, `why-${row.key}`)));
  }

  linkText(t, id, text, action) {
    return div().id(id).flex_none().text_size(11).text_color(t.accent).cursor_pointer()
      .hover((s) => s.text_color(t.foreground))
      .on_click(action)
      .child(text);
  }

  group(t, g, narrow) {
    return v_flex().flex_none().gap(0)
      .child(h_flex().px(12).pt(8).pb(3).gap(6).items_center().text_size(11).font_medium()
        .child(div().min_w(0).truncate().text_color(t.muted).child(g.project))
        .child(div().flex_none().text_color(t.dim).child(String(g.rows.length)))
        .child(div().flex_1())
        .when(Boolean(g.url), (el) => el.child(this.linkText(t, `map-${g.key}`, narrow ? "Map ↗" : "Open full map ↗", () => this.openMap(g.url)))))
      .when(Boolean(g.note), (el) => el.child(div().px(12).pb(5).text_size(11).text_color(t.dim).child(g.note)))
      .child(v_flex().px(4).pb(4).children(g.rows.map((r) => this.row(t, r, narrow))))
      .when(g.older > 0, (el) => el.child(div().px(12).pb(5).text_size(10.5).text_color(t.dim).child(`${g.older} older ${g.older === 1 ? "run" : "runs"} in the full map`)));
  }

  unwatched(t, u, narrow) {
    const started = this.starting.has(u.folder);
    return h_flex().id(`dir-${u.folder}`).px(12).pt(8).pb(3).gap(6).items_center().text_size(11).font_medium()
      .child(div().min_w(0).truncate().text_color(t.muted).child(shortFolder(u.folder, home())))
      .when(u.count > 0, (el) => el.child(div().flex_none().text_color(t.dim).child(String(u.count))))
      .child(div().flex_1())
      .child(started
        ? div().flex_none().text_size(11).text_color(t.dim).child("Starting…")
        : this.sample
          ? div().flex_none().text_size(11).text_color(t.dim).child(narrow ? "Start" : "Start Map here")
          : this.linkText(t, `start-${u.folder}`, narrow ? "Start ↗" : "Start Map here", (_e, cx) => this.startMap(u.folder, cx)));
  }

  button(t, id, text, action) {
    return div().id(id).h(24).px(9).flex().flex_none().items_center().rounded(5).border(1).border_color(t.border)
      .text_size(11).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover)).on_click(action).child(text);
  }

  world() {
    if (this.sample) return sampleWorld(this.sample);
    const f = focused();
    const here = !spaces().find((s) => s.id === f?.space)?.machine;
    return {
      boards: this.poller.list(),
      agents: agents(),
      terminals: terminals(),
      panes: panes(),
      now: Date.now(),
      fallbackFolder: here ? f?.cwd ?? null : null,
    };
  }

  render() {
    const t = theme();
    const narrow = this.width < NARROW;
    const view = buildView(this.world());
    const looking = !this.sample && !this.poller.scanned;
    for (const u of [...this.starting]) if (!view.unwatched.some((x) => x.folder === u)) this.starting.delete(u);
    return v_flex()
      .id("root")
      .on_size_change((size, cx) => {
        if (size.width === this.width) return;
        this.width = size.width;
        cx.notify();
      })
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .text_size(12.5)
      .child(h_flex().h(36).px(12).gap(7).flex_none().items_center()
        .child(image(`mods/agenttrail/mark-${settings().dark ? "dark" : "light"}.svg`).w(14).h(14).flex_none())
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).font_medium().text_color(t.dim).child("Agenttrail"))
        .when(Boolean(this.sample) && !this.pinnedSample, (el) => el.child(this.linkText(t, "leave-sample", "Back to live", (_e, cx) => { this.sample = null; cx.notify(); }))))
      .when(Boolean(this.sample), (el) => el.child(div().mx(8).mb(6).px(8).py(5).flex_none().rounded(6).bg(t.working + "26").text_size(11).font_semibold().text_color(t.working).child("Sample data. Nothing here is real.")))
      .child(v_flex().id("at-list").flex_1().min_h(0).overflow_y_scrollbar()
        .when(looking, (el) => el.child(div().px(12).py(10).text_size(12).text_color(t.dim).child("Looking for Map…")))
        .when(!looking && view.off, (el) => el.child(v_flex().px(12).pt(10).pb(6).gap(3).flex_none()
          .child(div().text_size(12).font_semibold().text_color(t.foreground).child("Map isn't running"))
          .child(div().text_size(12).text_color(t.muted).child("Start it in a repo to see what each agent touched."))))
        .children(view.groups.map((g) => this.group(t, g, narrow)))
        .children(looking ? [] : view.unwatched.map((u) => this.unwatched(t, u, narrow)))
        .when(!looking && view.off && !this.sample, (el) => el.child(h_flex().px(12).pt(8).pb(10).flex_none()
          .child(this.button(t, "show-sample", "Show sample", (_e, cx) => { this.sample = "all"; cx.notify(); })))))
      .when(view.remote > 0, (el) => el.child(div().flex_none().border_t(1).border_color(t.border).px(12).py(6).text_size(10.5).text_color(t.dim)
        .child(`${view.remote} ${view.remote === 1 ? "agent" : "agents"} on other machines aren't shown. This version reads this computer only.`)));
  }
}
