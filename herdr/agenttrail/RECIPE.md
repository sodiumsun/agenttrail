# Agenttrail

Agenttrail Map, drawn natively beside your agents: the project as cards with connectors, each card's tasks and progress, which card an agent is on right now, and the path it took to get there. It opens as a panel on the right, expands to full size, and follows the repo of the focused terminal. The graph comes from the repo's `PLAN.md`; with no plan it falls back to a simple view of branches and worktrees from git, labelled as inferred. The mod only reads: it never writes to agents, plans, repos or settings.

![Agenttrail](preview.png)

## What you see

One view, normally a 340px panel, full height, on Map's own colours rather than the Herdr theme. Dark: `#000000` background, `#181818` cards, `#313131` lines, `#ffffff` text, `#9b9b9b` dim, `#686868` faint, `#e9a23b` accent, `#3f7f57` done, `#db6b67` danger. Light is the same set from Map's light tokens, chosen by `settings().dark`. Type is Geist and Geist Mono. Below 560px wide the view is *narrow*. Top to bottom:

- **Header**, 64px high, 24px side padding (narrow: 44px, 12px): the Agenttrail mark at 28px (narrow 22px; `mark-dark.svg` on dark, `mark-light.svg` on light); the project name in 14px semibold; below it, unless narrow, the repo path in 12px dim with the home folder as `~`. On the right a 24px outlined pill with a 6px dot: `Working · 13s ago` in `#7aa36a` (narrow `13s ago`) when a file changed in the last minute, else in dim `Plan is live` (narrow `Live`), `Inferred` for a graph from git, or `Watching` with nothing to draw. Then a 28px expand or collapse button.
- **Hand-picked strip**, 30px, only when a Map was picked by hand: `Not your terminal's repo, <repo>` and **Back** in accent.
- **Inferred note**, only for a graph from git, 30px (narrow 46px, two lines) in 12px dim on `#181818`: `Inferred from git, last 7 days: 6 of 6 active branches and worktrees shown, 0 left out. A plan adds tasks and progress: npx agenttrail init`.
- **The canvas**, the rest of the height, black, with a dot every 24px fixed to the screen: the dots neither pan nor zoom.
  - **Region**, radius 26, 1.5px `#313131` border, `#18181880` fill, the project name in capitals in 15px mono faint at the top left, with ` · INFERRED` after it for a graph from git.
  - **Cards**, 400 by 128 at 100%, radius 12, 1px `#313131` border, in columns by `needs:`, 120 apart and 48 between rows, each scaled by the zoom. Top to bottom: the `tech:` line (or `#id`) in 11px mono faint; the title in 15px semibold, cut at 28 characters; `2 of 5 tasks · In progress` in 12px dim; a 4px bar of tasks done; `SHOW TASKS ↓` in 11px mono, `HIDE TASKS ↑` in accent when open. Top right: the status icon, with up to three agent marks and the word `Editing`, `Revising` or `Retrying` beside it when live. A small port sits on each side edge.
  - **Open card**: a 400px panel 24 below the card, radius 16, joined by a 1px line. One 44px row a task: a 22px numbered circle or green check, the title, the agent's mark, then `Editing now`, or a `Completed` or `Blocked` pill. A task opens to its recent files and `tech:` line in 11px mono. Session todos follow with a pink `#e08bb8` pill, and the card shows `SESSION PLAN` at its bottom right.
  - **Connectors**: `needs:` is a solid 1.5px `#313131` curve with an arrowhead; dashed `[5, 8]` in accent when either end is active. `links:` is a dotted `[2, 7]` faint curve. An edge an agent crossed in the last 45 minutes is a 2.5px dashed `[9, 7]` curve in that agent's colour, labelled `claude ⇢`. Each run's path is a dotted `[2.5, 5.5]` trail through the cards it visited, fainter once it ended.
  - **Tools**, top left, inset 24px (narrow 8px): `−`, the zoom as a percentage in 11px mono, `+`, a divider, fit, and a target that returns to the live card, shown only when something is live.
  - **Run dock**: up to four session cards at the top right, 340px wide, each with the agent's mark and name, source, project, age, the card it is in, its current todo, and its last tool and file in mono. Under 1040px wide it moves along the bottom and shows one.
- **A graph from git**, only when there is no `PLAN.md`: the same frame with a card for the trunk and for each active branch or worktree. The third line is the latest commit with its age on the right, the bar is commits in the window against the busiest branch, and the bottom row is `SHOW COMMITS ↓` with a line such as `6 commits in 7 days`. An open card lists up to six commits, with `Landed` pills. This is a simple fallback, not a plan.
- **Nothing to draw**: `Watching <project>`, then `SESSIONS` and `RECENT FILES` lists.
- **No Map**: `Map isn't running for <repo>` with an outlined **Start Map here** in accent (`Starting…` in dim once pressed, for at most 60 seconds). Also `Not in a git repo`, `No terminal in focus`, and `Scanning for Map…`. Below any of these, under `RUNNING ELSEWHERE`, every other Map found, each with **Show**.

## How it behaves

- **Agent status**. The mod doesn't read Herdr's agent status; it shows Map's, from the plan and from what Map sees. A card's icon, top right: `done`, a green check on an 18px disc; `active`, an 18px ring with an accent arc turning every 1100ms; `blocked`, a `!` on a `#db6b67` disc; `pending`, a faint ring. An agent working on a card (a file written in the last minute) puts an accent border and a `#2f271c` tint on it, a 30px arc turning every 1300ms, the word `Editing` (`Revising` on a done card, `Retrying` on a blocked one), and a file chip such as `feed.js ×3 · 12s`. A session in the run dock has a green dot that pulses every 1600ms while it runs, and a faint still one with `Idle, waiting for you` once ended.
- **Follows the focused terminal**. Focus a terminal and the view moves to that terminal's repo: the deepest Map watching it, never one on a parent folder standing in for a nested repo. Focus anywhere else, or on a terminal on another machine, keeps the last repo. A different Map starts fresh at fit.
- **Panel**. Under 560px it opens on the live card at a readable zoom (77% at 340px) and follows live work until someone moves the view. With nothing live it shows the whole graph; a graph from git opens on its newest branch. Each view is placed once, so a poll never moves it.
- **Expand and collapse**, the header button. In a docked block, it opens a tab named `Map` with the same view, or selects one already open. In a pane beside others, it runs `pane.zoom`. In the expanded tab, collapse goes back to the tab it came from and closes itself, handing the view back. If a terminal was split into that tab, collapse zooms instead, so it can never close a terminal. Alone in a tab it didn't expand into, there is no button.
- **Drag** the canvas to pan. **Scroll** pans too; with cmd or ctrl held it zooms at the pointer, from the page's floor up to 180%. Zooming in past 105% opens every card and zooming out past 85% folds them, as on the page. **Fit** shows the whole graph.
- **Click** a card to open or close it, and a task row to open or close its details. Open cards push what is below them. A card with live work opens by itself on a plan, never on a graph from git. Clicks don't reach terminals or agents.
- **Start Map here**: finds the folder's git root and opens a new tab named `Agenttrail Map` running `npx -y agenttrail@<this release> <repo> --no-open`, pinned so a later npm release never runs from a click. The mod notices the new Map by itself.
- **Show** on a Map elsewhere pins that Map until focus moves to another repo, or until **Back**.
- **Polling**: every 3 seconds the view asks its Map for `/board-lite`. With no Map for this repo, it scans the 15 ports every 15 seconds, or every round while a start is pending. A Map must miss two rounds before the view gives it up. Focus changes wake the loop at once.
- **Redraws** happen when the board really changed, not because its clock moved, and at the poll rate while there is recent work, so ages tick every 3 seconds. Rings and arcs spin. Dashed connectors stay still.
- **Commands**, for keys of your own or `herdr-app do`: `agenttrail.zoom-in`, `zoom-out`, `fit`, `live`, `expand`, `collapse`. No key is bound by default. Hovers lighten cards, tools and rows.

## Built from

- **One mod**, `mods/agenttrail/`, no layout. `mod.json`: `{ "place": "right", "size": 340, "title": "Agenttrail Map" }`. Beside a terminal in any tab: `pane.split {direction: "right", mod: "agenttrail"}`.
- `main.js`: the view (`gpui-kit` `View`, `div`, `svg`, `image`, `PathBuilder`; `gpui-base` `h_flex`, `v_flex`). Two `cx.spawn` loops for the copy's life: the feed, and `nextCommand()`. Size from `on_size_change` on the root. Every length is a world length times the zoom, since a mod has no transform.
- `feed.js`: `Feed`, `pickMap`, `focusFolder`. No Herdr imports; `fetch`, `sleep` and the repo lookup are passed in.
- `graph.js`: a line-for-line port of the page's `boardLayout`, `graphNodeMetrics`, `graphDetailHeight`, `graphEdge` and `graphLinkEdge` from Map's `public/index.html`, plus `hostOf`, which works out where a copy lives. Pure, and tested against the page's own code.
- **Art**: `mark-dark.svg`, `mark-light.svg`, `agent-claude.svg`, `agent-codex.svg`, `arc-live.svg`, `arc-status.svg`, `check.svg`, `chevron.svg`, `collapse.svg`, `expand.svg`, `fit.svg`, `live.svg`.
- **Props**, all optional: `portBase` (default 5330, for a Map moved with `AGENTTRAIL_PORT_BASE`), `port` (always show the Map on this port), `command` (argv that replaces the `npx` start, for a local checkout), `debug` (writes `map-stats-<id>.json` with render timings to the app home). `expanded` and `from` are set by the mod on its own tab.
- **Shared keys**: `agenttrail.view` (the view handed between panel and tab), `agenttrail.folder` (the last terminal folder).
- **Herdr functions**: `focused`, `spaces`, `panes`, `layout`, `props`, `settings`, `home`, `appHome`, `shared`, `setShared`, `nextCommand`, `exec`, `run`. **Commands**: `terminal.open`, `tab.new`, `tab.select`, `tab.close`, `pane.zoom`.
- **Programs**: `git rev-parse --show-toplevel` for each new folder; `npx` in a terminal when asked.
- **Network**: `fetch` GETs to `http://127.0.0.1:<port>` only, for ports 5330 to 5344 (the port fetched is always the one scanned or configured, a whole number, never one a reply names; a board without a `plan` list is dropped): `/panel` to find Maps (it reads `app`, `port`, `project`, `repoPath`) and `/board-lite` for the board.
- **The board**, `GET /board-lite`, read-only, behind Map's local request boundary: `project`, `now`, `plan[]` (components and tasks with `id`, `level`, `parent`, `title`, `status`, `tech`, `needs`, `links`, `by`, `touchedAt`, `recent`), `runs[]`, `handoffs`, `activity`, `recentActivity`, and `derived` when the cards came from git.

## Watch out

- **Herdr kills a render at 50 ms and never calls it again.** The pane then reads `This view could not be re-rendered; interrupted` until the app restarts, and a new tab doesn't help. So a slow frame must shed, not finish: past 28 ms `main.js` stops drawing task rows, then whole cards, for that frame. Cards and rows off screen are never built. Connectors are built once per zoom and only moved by a pan. A first dot grid of about 1500 polygons cost 40 ms and killed the view; it is now about 30 dashed lines, under 1 ms. A much larger plan or a slower machine could still reach the limit.
- **Dashes are static.** `PathBuilder` dashes can't travel, so active connectors don't crawl as they do on the page. Round caps, letter spacing and the page's soft card transitions aren't available either.
- **Read-only.** It reaches only loopback Maps, sends no POST, and runs the programs above. It reads no files. `debug` is the one thing that writes, and only to the app home. `npx` is the one thing that reaches the internet, and only after someone presses **Start Map here**.
- **A plan always wins.** `PLAN.md` draws the graph and the mod never changes how a plan reads. The git view only appears without one, needs a Map from 0.4.0, and is inferred, so it is labelled.
- `--no-open` matters twice: a Map in a terminal would otherwise open a browser, and would stop at its first-run setup prompt in a repo with no plan.
- `exec` stops after 30 seconds, so never start Map with it. Use `terminal.open`.
- `props()` gives no pane id, and `panes()` doesn't say which pane is this copy. `layout()` does list every block with `content.mod` and `content.props`, so `hostOf` looks for a matching visible block first, then the panes of the shown tab. An unclear case counts as a block, because a stray `pane.zoom` would zoom someone else's pane, while a stray `tab.new` only opens a tab.
- Herdr's `fetch` runs nearly one at a time and has no timeout. Every fetch here has a 4-second budget, and a url still waiting gets no second fetch.
- There is no focus callback. Render runs on every focus change, so that is where the follow is noticed.
- Git gives a repo's real path, and a terminal may have got there through a symlink, as `/tmp` is on macOS. Compare against the git root.
- Herdr's shipped layouts don't take a new mod's dock (0.1.12). On `main`, open it with `pane.split`.
- Each shown copy polls on its own. One copy is the intended setup; the expanded tab is the only reason for a second.
- A Map with no `/panel` isn't found, so the view offers **Start Map here**, which starts a new one on the next free port.
- This machine only. A terminal on another machine doesn't move the view.

## Done when

- `herdr-app check ~/.config/herdr-app/mods/agenttrail` passes.
- `npm test` in the Agenttrail repository passes.
- Focusing a terminal in a repo with no Map shows `Map isn't running for <repo>`, and **Start Map here** opens an `Agenttrail Map` tab, then the board replaces the message within a few seconds.
- A repo with a `PLAN.md` draws its components as cards in the same places as Map in the browser, with `needs:` and `links:` connectors.
- Clicking a card opens its tasks; clicking again closes it. Zooming past 105% opens every card.
- An agent writing a file in a component's `files:` puts the arc, `Editing` and the file chip on that card, and `Working` in the header.
- At 340px the view opens on the live card; the expand button opens a `Map` tab at the same place and collapse returns to it.
- Focusing a terminal in another repo with a Map moves the view there. Focusing this view doesn't.
- A repo with no `PLAN.md` shows the inferred note and a card per active branch, and adding a plan replaces them with the plan's cards.
- Stopping a Map returns the view to `Map isn't running for <repo>` within about 6 seconds.
- `debug` shows no render near 50 ms while sweeping zoom from fit to 180% and back.
