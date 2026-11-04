// Prototype: Agenttrail Map drawn natively in Herdr. One question: can a mod look and
// feel like the real Map? Read-only. See graph.js for the layout, ported from the page.

import { View, div, svg, image, PathBuilder } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { appHome, focused, nextCommand, props, settings } from "herdr";
import * as fs from "fs/promises";
import { Feed, POLL_MS, PORT_BASE } from "./feed.js";
import { REGION_HEAD, REGION_X, REGION_Y, ago, boardEdges, boardLayout, cardAgents, kids, statusLabel, taskDetails, taskIsOpen, touched } from "./graph.js";

const ASSET = "mods/agenttrail-map";
const SANS = "Geist";
const MONO = "Geist Mono";
const DOT = 24; // Map's background dots: fixed to the screen, they neither pan nor zoom
const MAX_ZOOM = 1.8;
// Herdr kills a render at 50 ms and never calls it again, so a slow frame must shed
// detail rather than finish. Past this, task rows stop being drawn for that frame.
const RENDER_BUDGET_MS = 28;
const UNFOLD_AT = 1.05, FOLD_AT = 0.85; // zooming in opens every card, as on the page

// Map's own tokens (public/index.html :root), so the two read as one product.
const DARK = { bg: "#000000", surface: "#181818", raised: "#1f1f1f", hover: "#272727", line: "#313131", text: "#ffffff", soft: "#d1d1d1", dim: "#9b9b9b", faint: "#686868", accent: "#e9a23b", danger: "#db6b67", success: "#7aa36a", done: "#3f7f57", completeText: "#70a784", completeBg: "#3f7f572e", region: "#18181880", overlay: "#181818", card: "#181818", cardHover: "#1f1f1f", human: "#5fb8c9", knowledge: "#a189e0", dot: "#31313159", openai: "#e8e8ea" };
const LIGHT = { ...DARK, bg: "#ffffff", surface: "#f9f8f7", raised: "#f3f2f0", hover: "#eeecea", line: "#00000024", text: "#000000", soft: "#000000c7", dim: "#666666", faint: "#0000007a", accent: "#955f12", success: "#3f7f57", region: "#f9f8f780", overlay: "#ffffff", card: "#ffffff", cardHover: "#f9f8f7", dot: "#00000018", openai: "#111111" };
const AGENT = { claude: "#d97757", cursor: "#5b7fd6", human: "#8b8b93", k: "#8b8b93" };
const MARK = { claude: "claude", codex: "codex", chatgpt: "codex", openai: "codex" };
const SOURCE = { hook: "hooks", "claude-log": "local log", "codex-log": "local log", "hook+claude-log": "hooks + log" };

const lit = () => settings()?.dark === false;
const agentColor = (c, name) => {
  const k = String(name).toLowerCase();
  if (["codex", "chatgpt", "openai"].includes(k)) return c.openai;
  return AGENT[k] ?? c.dim;
};

export default class AgenttrailMap extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.debug = Boolean(p.debug);
    this.size = null;
    this.zoom = 1;
    this.minZoom = 0.06;
    this.pan = { x: 0, y: 0 };
    this.fitted = false;
    this.unfolded = false;
    this.ui = { open: new Set(), closed: new Set(), openTasks: new Set(), closedTasks: new Set() };
    this.press = null;
    this.stats = { renders: 0, totalMs: 0, maxMs: 0, moves: 0, wheels: 0 };
    this.feed = new Feed({ fetch: (url) => fetch(url), sleep: (ms) => this.sleep(ms), base: p.portBase ?? PORT_BASE, port: p.port ?? null, folder: () => focused()?.cwd ?? null });
    cx.spawn(async (cx) => {
      this.sleep = (ms) => cx.sleep(ms);
      for (;;) {
        const changed = await this.feed.tick();
        if (changed) this.reshape();
        // Ages ("13s") and the 60s live window move with the clock, so a board with
        // recent work redraws at the poll rate, not once a second as the page does.
        if (changed || this.isLive()) cx.notify();
        await cx.sleep(POLL_MS);
      }
    });
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "zoom-in") this.zoomBy(1.18);
        else if (command === "zoom-out") this.zoomBy(0.85);
        else if (command === "fit") this.fit();
        else continue;
        cx.notify();
      }
    });
    if (this.debug) cx.spawn(async (cx) => {
      for (;;) {
        await cx.sleep(500);
        await fs.writeFile(`${appHome()}/map-stats.json`, JSON.stringify({ ...this.stats, zoom: this.zoom, pan: this.pan, size: this.size, at: Date.now() }));
      }
    });
  }

  isLive() {
    const b = this.feed.board;
    return Boolean(b && (b.plan.some((n) => n.level === "component" && n.touchedAt && Date.now() - n.touchedAt < 120000) || (b.runs ?? []).some((r) => !r.ended)));
  }

  // Everything that does not depend on pan: done again only when the board, an open
  // card or a zoom threshold changes, never on a drag.
  reshape() {
    const b = this.feed.board;
    this.geo = null;
    this.edgeCache = null;
    if (!b) return;
    const now = Date.now();
    const L = boardLayout(b, this.ui, now);
    const width = REGION_X + L.width + 80, height = REGION_Y + L.height + REGION_HEAD + 80;
    this.minZoom = Math.max(0.06, Math.min(920 / width, 700 / height) * 0.75);
    this.geo = { L, ...boardEdges(b, L, now), region: { w: L.width, h: L.height + REGION_HEAD } };
    if (!this.fitted && this.size) this.fit();
  }

  applyThresholds() {
    if (!this.unfolded && this.zoom >= UNFOLD_AT) {
      this.unfolded = true;
      for (const n of this.feed.board?.plan ?? []) if (n.level === "component") this.ui.open.add(n.id);
      this.reshape();
    } else if (this.unfolded && this.zoom <= FOLD_AT) {
      this.unfolded = false;
      this.ui.open.clear();
      this.reshape();
    }
  }

  fit() {
    if (!this.geo || !this.size) return;
    this.fitted = true;
    const { w, h } = this.geo.region;
    const box = this.stage();
    this.zoom = Math.max(0.45, Math.min(1.2, (box.width - 128) / w, (box.height - 128) / h));
    this.pan = { x: (box.width - w * this.zoom) / 2 - REGION_X * this.zoom, y: (box.height - h * this.zoom) / 2 - REGION_Y * this.zoom };
    this.applyThresholds();
  }

  stage() {
    return { width: this.size?.width ?? 0, height: Math.max(0, (this.size?.height ?? 0) - 64) };
  }

  zoomBy(factor, origin) {
    const box = this.stage();
    const point = origin ?? { x: box.width / 2, y: box.height / 2 };
    const next = Math.max(this.minZoom, Math.min(MAX_ZOOM, this.zoom * factor));
    const wx = (point.x - this.pan.x) / this.zoom, wy = (point.y - this.pan.y) / this.zoom;
    this.pan = { x: point.x - wx * next, y: point.y - wy * next };
    this.zoom = next;
    this.applyThresholds();
  }

  toggle(p) {
    const live = this.geo.L.pos[p.id].h > 128;
    if (live) { this.ui.open.delete(p.id); this.ui.closed.add(p.id); }
    else { this.ui.closed.delete(p.id); this.ui.open.add(p.id); }
    this.reshape();
  }

  // ---- connectors: real GPU paths, built at this zoom and only moved by a pan.

  stroke(c, e) {
    const z = this.zoom;
    const { x1, y1, ax, ay, bx, by, x2, y2 } = e.curve;
    const style = { need: [1.5, null, c.line], active: [1.5, [5, 8], c.accent], link: [1.5, [2, 7], c.faint + "cc"], handoff: [2.5, [9, 7], agentColor(c, e.agent ?? "")] }[e.kind];
    const [width, dash, color] = style;
    let path = PathBuilder.stroke(width);
    if (dash) path = path.dash_array(dash);
    path = path.move_to(x1 * z, y1 * z).cubic_bezier_to(x2 * z, y2 * z, ax * z, ay * z, bx * z, by * z).build();
    return { path, color };
  }

  edgeLayer(c) {
    const key = `${this.zoom}|${lit()}`;
    if (this.edgeCache?.key !== key) {
      const z = this.zoom;
      const trails = this.geo.trails.map((t) => {
        let path = PathBuilder.stroke(2.5).dash_array([2.5, 5.5]);
        t.points.forEach(([x, y], i) => { path = i ? path.line_to(x * z, y * z) : path.move_to(x * z, y * z); });
        return { path: path.build(), color: agentColor(c, t.agent) + (t.ended ? "33" : "8c") };
      });
      const lines = this.geo.edges.map((e) => this.stroke(c, e));
      const heads = this.geo.edges.filter((e) => e.arrow).map((e) => {
        const { x2, y2 } = e.curve;
        const s = 7 * 1.5; // the page's marker: 7 units of a 1.5 stroke
        return PathBuilder.fill().add_polygon([[(x2 - s) * z, (y2 - s / 2) * z], [x2 * z, y2 * z], [(x2 - s) * z, (y2 + s / 2) * z]], true).build();
      });
      this.edgeCache = { key, paths: [...trails, ...lines, ...heads.map((path) => ({ path, color: c.line }))] };
    }
    const { w, h } = this.geo.region;
    const layer = (p) => window.paint_path(p.path, p.color).absolute().left(0).top(0).w(w * this.zoom + REGION_X * this.zoom).h(h * this.zoom + REGION_Y * this.zoom);
    return div().absolute().left(this.pan.x + REGION_X * this.zoom).top(this.pan.y + (REGION_Y + REGION_HEAD) * this.zoom).w(1).h(1).children(this.edgeCache.paths.map(layer));
  }

  grid(c) {
    const { width, height } = this.size;
    const key = `${width}x${height}|${lit()}`;
    if (this.gridCache?.key !== key) {
      let path = PathBuilder.stroke(2).dash_array([2, DOT - 2]);
      for (let y = 1; y < height; y += DOT) path = path.move_to(0, y).line_to(width, y);
      this.gridCache = { key, path: path.build() };
    }
    return window.paint_path(this.gridCache.path, c.dot).absolute().left(0).top(0).size_full();
  }

  // ---- cards: every length is a world length times the zoom, since a mod has no
  // transform to scale a group with.

  text(str, { x, y, size, color, mono = false, weight = 400, right = null }) {
    const z = this.zoom;
    const el = div().absolute().top((y - size * 0.975) * z).whitespace_nowrap().text_size(size * z).line_height(`${size * 1.25 * z}px`)
      .font_family(mono ? MONO : SANS).font_weight(weight).text_color(color).child(str);
    return right == null ? el.left(x * z) : el.right(right * z);
  }

  ring(size, x, y, color, width) {
    const z = this.zoom;
    return div().absolute().left((x - size / 2) * z).top((y - size / 2) * z).w(size * z).h(size * z).rounded(size * z).border(width * z).border_color(color);
  }

  statusIcon(c, p, w) {
    const z = this.zoom, x = w - 26, y = 26;
    const disc = (color) => div().absolute().left((x - 9) * z).top((y - 9) * z).w(18 * z).h(18 * z).rounded(18 * z).bg(color).flex().items_center().justify_center();
    const mark = (color) => disc(color).text_size(12 * z).font_weight(700).font_family(SANS).text_color(color === c.accent ? "#141414" : "#ffffff").child("!");
    if (p.kind === "human" && p.status !== "done") return [mark(c.accent)];
    if (p.status === "done") return [disc(c.done).child(svg(`${ASSET}/check.svg`).w(18 * z).h(18 * z).text_color("#ffffff"))];
    if (p.status === "active") return [this.ring(18, x, y, c.line, 2), svg(`${ASSET}/arc-status.svg`).absolute().left((x - 11) * z).top((y - 11) * z).w(22 * z).h(22 * z).text_color(c.accent).spin(1100)];
    if (p.status === "blocked") return [mark(c.danger)];
    return [this.ring(18, x, y, c.faint, 2)];
  }

  agentMark(c, name, x, y, size) {
    const z = this.zoom, key = MARK[String(name).toLowerCase()];
    const box = (el) => el.absolute().left((x - size / 2) * z).top((y - size / 2) * z).w(size * z).h(size * z);
    if (key) return box(svg(`${ASSET}/agent-${key}.svg`)).text_color(agentColor(c, name));
    return box(div()).flex().items_center().justify_center().text_size(11 * z).font_weight(700).font_family(SANS).text_color(agentColor(c, name)).child(String(name)[0].toUpperCase());
  }

  card(c, b, p, pos, now) {
    const z = this.zoom, w = pos.nodeW, h = pos.nodeH;
    const list = kids(b, p.id);
    const done = list.filter((n) => n.status === "done").length;
    const open = pos.h > h;
    const live = touched(p, now);
    const tint = p.kind === "knowledge" ? c.knowledge : p.kind === "human" ? c.human : c.accent;
    const edge = p.kind === "knowledge" ? c.knowledge : p.kind === "human" ? c.human : p.status === "blocked" ? c.danger : open || p.status === "active" ? c.accent : c.line;
    const strong = edge !== c.line;
    const word = p.status === "done" ? "Revising" : p.status === "blocked" ? "Retrying" : "Editing";
    const names = cardAgents(b, p);
    const label = p.title.length > 28 ? `${p.title.slice(0, 27)}…` : p.title;
    const recent = (p.recent ?? [])[0];
    const barW = (w - 32) * z;
    const hasPlan = list.some((k) => k.status === "pending" && k.src === "agent");
    const ports = [0, w].map((x) => div().absolute().left((x - 4) * z).top((h / 2 - 4) * z).w(8 * z).h(8 * z).rounded(8 * z).bg(c.raised).border(1).border_color(c.faint));
    return div().id(`n-${p.id}`).absolute()
      .left(this.pan.x + (REGION_X + pos.nodeX) * z).top(this.pan.y + (REGION_Y + REGION_HEAD + pos.nodeY) * z).w(w * z).h(h * z)
      .rounded(12 * z).bg(c.card).border(strong ? 1.5 : 1).border_color(edge).cursor_pointer()
      .when(p.kind === "human", (el) => el.border_dashed())
      .hover((s) => s.bg(c.cardHover).border_color(strong ? edge : c.faint))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { this.toggle(p); cx.notify(); })
      .child(this.text((p.tech || `#${p.id}`).slice(0, Math.min(42, Math.floor((w - 170) / 6.8))), { x: 16, y: 24, size: 11, color: p.kind ? tint : c.faint, mono: true, weight: 500 }))
      .children(this.statusIcon(c, p, w))
      .when(live, (el) => el
        .child(svg(`${ASSET}/arc-live.svg`).absolute().left((w - 41) * z).top(11 * z).w(30 * z).h(30 * z).text_color(tint).spin(1300))
        .child(this.text(word, { right: 44 + 24 * Math.min(names.length, 3), y: 30, size: 11, color: tint, weight: 600 }))
        .when(Boolean(recent), (e2) => e2.child(this.text(`${recent.file.split("/").pop()}${recent.n > 1 ? ` ×${recent.n}` : ""} · ${ago(recent.at, now)}`, { right: 16, y: 76, size: 11, color: tint, mono: true }))))
      .children(names.map((n, i) => this.agentMark(c, n, w - 26 - 24 * (i + 1), 26, 13)))
      .child(this.text(label, { x: 16, y: 52, size: 15, color: c.text, weight: 600 }))
      .child(this.text(`${done} of ${list.length} tasks · ${p.status === "pending" && done > 0 ? "Underway" : statusLabel(p.status)}`, { x: 16, y: 76, size: 12, color: c.dim }))
      .child(div().absolute().left(16 * z).top(92 * z).w(barW).h(4 * z).rounded(2 * z).bg(c.hover))
      .child(div().absolute().left(16 * z).top(92 * z).w(list.length ? barW * done / list.length : 0).h(4 * z).rounded(2 * z).bg(p.status === "active" ? c.accent : c.soft))
      .child(this.text(open ? "HIDE TASKS ↑" : "SHOW TASKS ↓", { x: 16, y: 116, size: 11, color: open ? c.accent : c.faint, mono: true, weight: 500 }))
      .when(hasPlan, (el) => el.child(this.text("SESSION PLAN", { right: 16, y: 116, size: 10, color: "#e08bb8", mono: true, weight: 700 })))
      .children(ports);
  }

  rowMarker(c, status, n) {
    const z = this.zoom;
    if (status === "done") return div().w(22 * z).h(22 * z).rounded(22 * z).bg(c.done).flex().items_center().justify_center().flex_none().child(svg(`${ASSET}/check.svg`).w(18 * z).h(18 * z).text_color("#ffffff"));
    return div().w(22 * z).h(22 * z).rounded(22 * z).border(1.5 * z).border_color(status === "active" ? c.accent : c.faint).flex().items_center().justify_center().flex_none().text_size(10 * z).font_weight(600).text_color(c.text).child(n);
  }

  plainRow(c, top, marker, copy, tail) {
    const z = this.zoom;
    return h_flex().absolute().left(0).top(top * z).w(400 * z).h(44 * z).px(8 * z).gap(8 * z).items_center()
      .child(div().w(24 * z).h(24 * z).flex().items_center().justify_center().flex_none().child(marker))
      .child(div().flex_1().min_w(0).truncate().text_size(12 * z).font_weight(500).font_family(SANS).text_color(c.text).child(copy))
      .child(tail);
  }

  taskRow(c, b, task, i, top, now) {
    const z = this.zoom;
    const open = taskIsOpen(task, this.ui);
    const details = taskDetails(b, task, (at) => ago(at, now));
    const rows = open ? 16 + Math.max(details.rows.length, 5) * 20 : 0;
    const marker = this.rowMarker(c, task.status, String(i + 1));
    const pill = task.status === "done" ? ["Completed", c.completeText, c.completeBg] : task.status === "blocked" ? ["Blocked", c.danger, c.danger + "2e"] : null;
    const chip = task.by ? MARK[String(task.by).toLowerCase()] : null;
    return v_flex().id(`t-${task.id}`).absolute().left(0).top(top * z).w(400 * z).h((44 + rows) * z).cursor_pointer()
      .on_click((_e, cx) => {
        if (open) { this.ui.openTasks.delete(task.id); this.ui.closedTasks.add(task.id); }
        else { this.ui.closedTasks.delete(task.id); this.ui.openTasks.add(task.id); }
        this.reshape();
        cx.notify();
      })
      .child(h_flex().h(44 * z).px(8 * z).gap(8 * z).items_center().flex_none()
        .child(div().w(24 * z).h(24 * z).flex().items_center().justify_center().flex_none().child(marker))
        .child(div().flex_1().min_w(0).truncate().text_size(12 * z).font_weight(500).font_family(SANS).text_color(c.text).child(task.title))
        .when(Boolean(chip), (el) => el.child(svg(`${ASSET}/agent-${chip}.svg`).w(14 * z).h(14 * z).flex_none().text_color(agentColor(c, task.by)).opacity(task.status === "done" ? 0.45 : 1)))
        .when(task.status === "active", (el) => el.child(div().flex_none().text_size(12 * z).text_color(c.dim).child("Editing now")))
        .when(Boolean(pill), (el) => el.child(div().flex_none().h(22 * z).px(8 * z).rounded(22 * z).bg(pill[2]).text_color(pill[1]).text_size(11 * z).flex().items_center().child(pill[0])))
        .child(svg(`${ASSET}/chevron.svg`).w(14 * z).h(14 * z).flex_none().text_color(c.faint)))
      .when(open, (el) => el.child(v_flex().px(40 * z).children(details.rows.map((r) => h_flex().h(20 * z).items_center().justify_between().gap(8 * z).text_size(11 * z).font_family(MONO).text_color(c.dim)
        .child(div().min_w(0).truncate().child(r.label)).child(div().flex_none().text_color(c.faint).child(r.meta))))));
  }

  detail(c, b, p, pos, now) {
    const z = this.zoom;
    const list = kids(b, p.id);
    const stageH = this.stage().height;
    const originY = this.pan.y + (REGION_Y + REGION_HEAD + pos.nodeY + pos.nodeH + 24) * z;
    let top = 0;
    const rows = list.flatMap((task, i) => {
      const height = 45 + (taskIsOpen(task, this.ui) ? 16 + Math.max(taskDetails(b, task, () => "").rows.length, 5) * 20 : 0);
      const y = originY + top * z;
      const onScreen = y < stageH && y + height * z > 0;
      const late = Date.now() - this.t0 > RENDER_BUDGET_MS;
      if (late && onScreen) this.shed += 1;
      const row = onScreen && !late ? [this.taskRow(c, b, task, i, top, now)] : [];
      top += height;
      return row;
    });
    for (const r of (b.runs ?? []).filter((x) => x.componentId === p.id)) (r.todos ?? []).forEach((t, i) => {
      const st = t.status === "completed" ? "done" : t.status === "in_progress" ? "active" : "pending";
      rows.push(this.plainRow(c, top, this.rowMarker(c, st, String(i + 1)), t.content, div().flex_none().h(22 * z).px(8 * z).rounded(22 * z).bg("#e08bb82e").text_color("#e08bb8").text_size(11 * z).flex().items_center().child("Session plan")));
      top += 45;
    });
    const declared = list.some((k) => k.status === "active" || k.status === "blocked");
    const liveSession = (b.runs ?? []).some((r) => r.componentId === p.id && !r.ended && (r.todos ?? []).length);
    const a0 = (p.recent ?? [])[0];
    if (touched(p, now) && !declared && !liveSession && a0) rows.push(this.plainRow(c, top, this.rowMarker(c, "pending", ""), `Revising · ${a0.file.split("/").pop()}${a0.n > 1 ? ` ×${a0.n}` : ""}`, div().flex_none().text_size(12 * z).text_color(c.dim).child(ago(a0.at, now))));
    const x = this.pan.x + (REGION_X + pos.x) * z, y = this.pan.y + (REGION_Y + REGION_HEAD + pos.nodeY + pos.nodeH + 24) * z;
    const cx0 = x + pos.nodeW / 2 * z;
    return [
      div().absolute().left(cx0).top(y - 24 * z).w(1).h(24 * z).bg(c.faint),
      div().id(`d-${p.id}`).absolute().left(x).top(y).w(pos.detailW * z).h(pos.detailH * z).rounded(16 * z).bg(c.surface).overflow_hidden()
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .children(list.length ? rows : [this.text("No tasks in this phase.", { x: 16, y: 38, size: 12, color: c.dim })]),
    ];
  }

  // ---- overlays: fixed to the pane, like the page's.

  tool(c, id, child, action) {
    return div().id(id).w(28).h(28).flex().flex_none().items_center().justify_center().rounded(8).text_color(c.dim).text_size(16).cursor_pointer()
      .hover((s) => s.bg(c.hover).text_color(c.text)).on_click(action).child(child);
  }

  tools(c) {
    return h_flex().id("tools").absolute().left(24).top(24).p(4).gap(4).items_center().rounded(12).border(1).border_color(c.line).bg(c.overlay).shadow_lg()
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(this.tool(c, "zoom-out", "−", (_e, cx) => { this.zoomBy(0.85); cx.notify(); }))
      .child(div().w(44).text_center().text_size(11).font_family(MONO).text_color(c.dim).child(`${Math.round(this.zoom * 100)}%`))
      .child(this.tool(c, "zoom-in", "+", (_e, cx) => { this.zoomBy(1.18); cx.notify(); }))
      .child(div().w(1).h(16).mx(4).bg(c.line))
      .child(this.tool(c, "fit", svg(`${ASSET}/fit.svg`).w(14).h(14), (_e, cx) => { this.fit(); cx.notify(); }));
  }

  runCard(c, b, r, now) {
    const cur = (r.todos ?? []).find((t) => t.status === "in_progress");
    const tool = r.currentTool ?? r.recentTools?.[0];
    const comp = r.componentId ? b.plan.find((x) => x.id === r.componentId) : null;
    const key = MARK[String(r.agent).toLowerCase()];
    return v_flex().px(14).py(12).rounded(14).border(1).border_color(c.line).bg(c.overlay).shadow_lg().flex_none()
      .child(h_flex().gap(8).items_center()
        .child(key ? svg(`${ASSET}/agent-${key}.svg`).w(16).h(16).flex_none().text_color(agentColor(c, r.agent)) : div().w(16).h(16).flex_none())
        .child(div().flex_none().text_size(13).font_weight(600).text_color(c.text).child(r.agent))
        .child(div().flex_none().text_size(11.5).text_color(c.faint).child(`· ${SOURCE[r.source] ?? "hooks"} · ${b.project}`))
        .child(div().flex_none().w(6).h(6).rounded(6).bg(r.ended ? c.faint : c.success).when(!r.ended, (el) => el.loop("opacity", { from: 0.35, to: 1, period: 1600 })))
        .child(h_flex().flex_1().min_w(0).justify_end().gap(4).text_size(11.5).text_color(c.faint)
          .child(div().flex_none().child(`${ago(r.startedAt, now)}${comp ? " · in" : ""}`))
          .when(Boolean(comp), (el) => el.child(div().min_w(0).truncate().text_color(c.accent).child(comp?.title ?? "")))))
      .when(Boolean(cur) || Boolean(r.ended), (el) => el.child(div().mt(6).truncate().text_size(12.5).text_color(cur ? c.text : c.dim).child(cur ? cur.content : "Idle, waiting for you")))
      .when(Boolean(tool), (el) => el.child(h_flex().mt(5).gap(8).text_size(11.5).font_family(MONO).text_color(c.dim).min_w(0)
        .child(div().flex_none().text_color(c.accent).child(tool.name))
        .child(div().flex_1().min_w(0).truncate().child(tool.detail ?? ""))
        .child(div().flex_none().text_color(c.faint).child(ago(tool.at, now)))));
  }

  runs(c, b, now) {
    const list = [...(b.runs ?? [])].sort((a, r) => a.startedAt - r.startedAt).slice(-4);
    return v_flex().id("runs").absolute().right(24).top(24).w(340).gap(10)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .when(list.length > 1, (el) => el.child(div().px(2).text_size(10.5).font_weight(600).font_family(MONO).text_color(c.faint).child(`${list.some((r) => !r.ended) ? "NOW" : "EARLIER"} · ${String(b.project).toUpperCase()} · ${list.length} SESSIONS`)))
      .children(list.map((r) => this.runCard(c, b, r, now)));
  }

  header(c, b, now) {
    const working = b?.activity && now - b.activity.at < 60000;
    return h_flex().h(64).px(24).gap(10).items_center().flex_none().bg(c.bg).border_b(1).border_color(c.hover)
      .child(image(`${ASSET}/mark-${lit() ? "light" : "dark"}.svg`).w(28).h(28).flex_none())
      .child(v_flex().child(div().text_size(14).font_weight(600).text_color(c.text).child(b?.project ?? "agenttrail"))
        .child(div().text_size(12).text_color(c.dim).child("workspace / PLAN.md")))
      .child(div().flex_1())
      .when(Boolean(b), (el) => el.child(h_flex().h(24).px(8).gap(6).items_center().rounded(8).border(1).border_color(c.line).text_size(12).text_color(working ? c.success : c.dim)
        .child(div().w(6).h(6).rounded(6).bg(working ? c.success : c.faint))
        .child(working ? `Working · ${ago(b.activity.at, now)} ago` : "Plan is live")));
  }

  canvas(c, b, now) {
    const { width, height } = this.stage();
    const z = this.zoom;
    const { L, region } = this.geo;
    const nodes = L.phases.flatMap((p) => {
      const pos = L.pos[p.id];
      const x = this.pan.x + (REGION_X + pos.x) * z, y = this.pan.y + (REGION_Y + REGION_HEAD + pos.y) * z;
      if (x > width || y > height || x + pos.w * z < 0 || y + pos.h * z < 0) return []; // a mod pays per element, so off-screen ones go
      return [this.card(c, b, p, pos, now), ...(pos.h > pos.nodeH ? this.detail(c, b, p, pos, now) : [])];
    });
    this.parts.nodes = Date.now() - this.t0;
    const edges = this.edgeLayer(c);
    this.parts.edges = Date.now() - this.t0;
    return [
      div().absolute().left(this.pan.x + REGION_X * z).top(this.pan.y + REGION_Y * z).w(region.w * z).h(region.h * z).rounded(26 * z).bg(c.region).border(1.5).border_color(c.line)
        .child(this.text(String(b.project ?? "").toUpperCase(), { x: 28, y: 38, size: 15, color: c.faint, mono: true, weight: 600 })),
      edges,
      ...this.geo.edges.filter((e) => e.agent).map((e) => {
        const mx = (e.curve.x1 + e.curve.x2) / 2, my = (e.curve.y1 + e.curve.y2) / 2 - (e.arrow ? 10 : 8);
        return div().absolute().left(this.pan.x + (REGION_X + mx - 60) * z).top(this.pan.y + (REGION_Y + REGION_HEAD + my - 11) * z).w(120 * z).text_center()
          .text_size(10.5 * z).font_weight(650).font_family(MONO).text_color(agentColor(c, e.agent)).child(`${e.agent} ⇢`);
      }),
      ...nodes,
    ];
  }

  render() {
    const started = Date.now();
    this.t0 = started;
    this.parts = {};
    this.shed = 0;
    const c = lit() ? LIGHT : DARK;
    const b = this.feed.board;
    const now = Date.now();
    const ready = Boolean(b && this.geo && this.size);
    const root = v_flex().id("root").size_full().min_h(0).bg(c.bg).font_family(SANS)
      .on_size_change((size, cx) => {
        if (size.width === this.size?.width && size.height === this.size?.height) return;
        this.size = size;
        if (b && !this.geo) this.reshape();
        if (!this.fitted) this.fit();
        cx.notify();
      })
      .child(this.header(c, b, now))
      .child(div().id("canvas").relative().flex_1().min_h(0).overflow_hidden().bg(c.bg)
        .when(Boolean(this.press), (el) => el.cursor_grabbing())
        .when(!this.press, (el) => el.cursor_grab())
        .on_mouse_down("left", (e, cx) => { this.press = { x: e.position.x, y: e.position.y, px: this.pan.x, py: this.pan.y }; cx.notify(); })
        .on_mouse_move((e, cx) => {
          if (!this.press) return;
          this.stats.moves += 1;
          this.pan = { x: this.press.px + e.position.x - this.press.x, y: this.press.py + e.position.y - this.press.y };
          cx.notify();
        })
        .on_mouse_up("left", (_e, cx) => { this.press = null; cx.notify(); })
        .on_hover((hovered, cx) => { if (!hovered && this.press) { this.press = null; cx.notify(); } })
        .on_scroll_wheel((e, cx) => {
          this.stats.wheels += 1;
          if (e.modifiers.platform || e.modifiers.control) {
            const local = e.local_position ?? { x: e.position.x, y: e.position.y - 64 };
            this.zoomBy(Math.exp(Math.max(-60, Math.min(60, e.delta.y)) * 0.004), local);
          } else this.pan = { x: this.pan.x + e.delta.x, y: this.pan.y + e.delta.y };
          cx.notify();
        })
        .when(Boolean(this.size), (el) => { const g = el.child(this.grid(c)); this.parts.grid = Date.now() - this.t0; return g; })
        .when(ready, (el) => el.children(this.canvas(c, b, now)).child(this.tools(c)).child(this.runs(c, b, now)))
        .when(!ready, (el) => el.child(div().absolute().left(24).top(24).text_size(13).text_color(c.dim).child("Looking for Map…"))));
    const ms = Date.now() - started;
    this.stats.renders += 1;
    this.stats.totalMs += ms;
    this.stats.shed = (this.stats.shed ?? 0) + (this.shed ? 1 : 0);
    if (ms >= this.stats.maxMs) { this.stats.maxMs = ms; this.stats.worst = { ...this.parts, ms }; }
    return root;
  }
}
