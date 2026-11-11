# agenttrail

## Read the plan file {#plan-reader}
tech: PLAN.md parser + derived model
files: [bin/**]
- [x] Read the plan file into a live model {#plan-parse}
  by: claude
  tech: stable {#id}s, needs/links edges, [~] active marker
- [x] Re-read it the moment the agent edits it {#plan-watch}
  tech: fs watcher + 150ms debounce
- [x] Warn when the plan falls behind moving code {#plan-stale}
  by: claude
  from: agent
  tech: planStale in the model; topbar chip; SessionStart nudge injected via hooks
- [x] Lint the plan: structural warnings on the board {#plan-lint}
  by: claude
  tech: dup ids, unknown edge refs, uncited [x], missing files:, count governor

## Watch the repo {#watcher}
tech: recursive fs watcher
links: [explorer]
files: [bin/**]
- [x] Notice every file the agent touches {#watch-files}
  tech: heatFile/touchComponents in bin/agenttrail.mjs
  by: claude
- [x] Ignore editor droppings and junk folders {#watch-filter}
  tech: tmp/swap filter + .git, node_modules excludes

## Draw the live map {#map}
tech: svg flow diagram + task capsules
needs: [plan-reader]
links: [explorer]
files: [public/**, assets/brand/**]
- [x] Draw a map for any repo, with no plan needed {#map-inferred}
  tech: bin/lib/areas.mjs, areas chosen on a worker from git ls-files and activity
  by: claude
- [x] Show components and how they connect {#map-graph}
  tech: needs = arrows, links = dashed, deterministic layout
  by: claude
- [x] Unfold a component into its tasks {#map-capsules}
  tech: zoomUnfolded + expandedGraphNode in public/index.html
  by: codex
- [x] Name things for the owner, not the agent {#map-naming}
  tech: convention v2 — verb-led titles + tech: sublines
- [x] Put the selected logo in the header {#map-logo}
  tech: .brand mark swap in public/index.html
  by: codex
- [x] Match the header logo to each theme {#map-theme-logo}
  by: codex
  from: agent
  tech: automatic header-logo swap in public/index.html
- [x] Recolor the app icon for dark mode {#map-theme-icon}
  by: codex
  from: agent
  tech: identical rounded-square composition and route mark, rendered in a darker night palette
- [x] Keep the header compact and the current map in view {#map-frame}
  by: codex
  from: agent
  tech: valid encoded favicon; one-row status rail; viewport-bound app shell
- [x] Keep the repository sidebar narrow at medium widths {#map-sidebar-columns}
  by: pydemia
  from: agent
  tech: inherit the sidebar/map column order in public/index.html between 721px and 960px; docs/RESPONSIVE-SIDEBAR.md
- [x] Switch the whole app between dark and light {#map-theme}
  by: codex
  from: agent
  tech: persisted top-bar switch + tokenized HTML/SVG surfaces in public/index.html
- [x] Make the theme switch name its action {#map-theme-label}
  by: codex
  from: agent
  tech: Light in dark mode; Dark in light mode
- [x] Strengthen completed task colors in light mode {#map-light-complete}
  by: codex
  from: agent
  tech: higher-contrast completion pill + clearer completed-task agent marks
- [x] Make revising cards prominent in light mode {#map-light-revising}
  by: codex
  from: agent
  tech: warm card tint + stronger orange outline and label
- [x] Bring running cards forward in light mode {#map-light-running}
  by: codex
  from: agent
  tech: warm active surface + stronger outline + accent-tinted depth
- [x] Keep past cycles out of the live map {#map-cycle-history}
  by: codex
  from: agent
  tech: canvas history control + closed-by-default right drawer in public/index.html

- [x] Knowledge components render with a purple accent {#map-knowledge-kind}
  tech: kind: knowledge parsed by KIND_RE; .gnode.knowledge tokens both themes
  by: claude
- [x] Set up an unmapped repo from its card {#map-setup-button}
  tech: Set up the map button -> /setup-board relay -> sibling /setup runs init
  by: claude
- [x] Cards with live work auto-unfold at any zoom {#map-live-unfold}
  tech: isUnfolded/compLive in public/index.html; folds back ~60s after activity stops
  by: claude
- [x] Human steps render dashed with an attention badge until their work clears {#map-human-kind}
  tech: kind: human + url: in the convention; amber ! while open tasks remain; OPEN link on cards
  by: claude
## Show the repo like an editor {#explorer}
tech: vs-code-style file tree
needs: [watcher]
files: [public/**]
- [x] Folder tree with live "just touched" accents {#explorer-tree}
  tech: renderTree + tree-ago in public/index.html
  by: claude
- [x] Make recent file edits stand out in light mode {#explorer-light-activity}
  by: codex
  from: agent
  tech: warm row tint + bright orange edge + semibold activity text
- [x] Add a repo from the sidebar {#explorer-add-repo}
  tech: + add repo row -> /suggest (known repos + git siblings) -> POST /spawn spawns a sibling daemon
  by: claude

## Watch live runs {#runs}
tech: Claude Code hooks plus local Claude and Codex log readers — bin/lib/claude.mjs, bin/lib/codex.mjs
needs: [plan-reader]
links: [map]
files: [bin/**, public/**, test/**, herdr/**, .github/workflows/map.yml]
- [x] Restrict Map actions to trusted local requests {#runs-request-boundary}
  by: claude
  tech: requestProblem + action token in bin/agenttrail.mjs; test/request-boundary.test.mjs covers foreign Host/Origin, tokens, registered-board proxies, relays and sibling polling.
- [x] Keep Map and Kitchen hook setup independent {#runs-distinct-hooks}
  by: claude
  tech: isMapRelayCommand in bin/lib/hooks.mjs matches the relay command itself; test/hooks.test.mjs covers both orders, repeats and similar names.
- [x] Show current Claude task lists on run cards, only after the tool succeeded {#runs-modern-tasks}
  by: claude
  tech: claudeTaskEffect in bin/lib/tasks.mjs covers TaskCreate/TaskUpdate/TaskGet/TaskList and TodoWrite; test/tasks.test.mjs.
- [x] Follow Claude sessions from local logs, with or without hooks {#runs-claude-logs}
  by: claude
  tech: ClaudeLogReader in bin/lib/claude.mjs on the shared bounded reader in bin/lib/logtail.mjs; one run per session id when hooks and logs both see it; test/claude.test.mjs.
- [x] Show current sub-agents, whichever tool name Claude uses {#runs-agent-tool}
  by: claude
  tech: SUBAGENT_TOOL in bin/lib/claude.mjs matches Agent and Task; test/hooks.test.mjs and test/claude.test.mjs.
- [x] Follow Codex sessions in a watched repo as Map runs {#runs-codex}
  by: claude
  tech: CodexLogReader in bin/lib/codex.mjs reads ~/.codex/sessions read-only, bounded to the file tail, cursors saved with runs; test/codex.test.mjs.
- [x] Tell two agents in one repo apart by their Herdr terminal {#runs-terminal-id}
  by: claude
  tech: withTerminalId in bin/agenttrail.mjs; run.terminalId, tested in test/hooks.test.mjs.
- [x] Test Map automatically on every change {#runs-tests}
  by: claude
  tech: zero-dependency node:test suite in test/, root npm test, .github/workflows/map.yml.
- [x] Receive hook events and track sessions {#runs-endpoint}
  by: claude
  tech: /events endpoint; per-session todos, current tool, recent calls
- [x] Hook relay command + settings install {#runs-relay}
  by: claude
  tech: agenttrail hook (stdin → POST, fail-silent); init merges .claude/settings.json
- [x] Run cards on the board with the live tool line {#runs-ui}
  tech: renderRuns in public/index.html
  by: claude
- [x] Pin runs to components so the map glows where work happens {#runs-pin}
  tech: run.componentId + obs-ring in public/index.html
  by: claude
- [x] Explain missing run cards in-product {#runs-explain}
  by: claude
  tech: hooksInstalled flag; hints for no-hooks and pre-hook sessions

- [x] Group live sessions into cycles in the runs dock {#runs-cycle-groups}
  tech: temporal burst grouping in renderRuns, public/index.html
  by: claude
- [x] Save ended cycles as durable history {#runs-cycle-history}
  tech: archiveRun + cycles[] persisted in bin/agenttrail.mjs; Past cycles rows in the dock
  by: claude
- [x] Sub-agents show as child rows on their parent's run card {#runs-subagents}
  tech: Agent or Task calls and SubagentStop hooks -> run.subagents in bin/agenttrail.mjs; .run-sub rows
  by: claude
- [x] Draw every state of the Herdr panel for the owner to review {#herdr-mockup}
  by: claude
  from: agent
  tech: one HTML review page outside the repo; not a screenshot
- [x] Give the Herdr panel a small read-only feed from Map {#runs-panel-feed}
  by: claude
  from: agent
  tech: GET /panel in bin/agenttrail.mjs, shape in bin/lib/panel.mjs, schema 1, behind requestProblem; test/panel-feed.test.mjs
- [x] Show each agent's trail beside its terminal in Herdr {#herdr-panel}
  by: claude
  from: agent
  tech: since replaced by the Map mod {#herdr-map-mod}; seen rendering in a separate Herdr instance
- [x] Write the Herdr recipe, preview and install notes {#herdr-recipe}
  by: claude
  from: agent
  tech: herdr/agenttrail/RECIPE.md in Herdr's six-part order; herdr/agenttrail/preview.png; herdr/README.md
- [x] Fix what an independent review of the branch found {#runs-review-fixes}
  by: claude
  tech: test/regressions.test.mjs
- [x] Replace the Herdr panel with the Map itself {#herdr-map-mod}
  by: claude
  tech: herdr/agenttrail/mods/agenttrail; pure feed.js, graph.js with test/herdr-map.test.mjs; RECIPE.md and preview.png rewritten for it
- [x] Keep the Herdr mod to the ports it scanned, pin the Map it starts and survive a malformed board {#herdr-mod-hardening}
  by: claude
  tech: feed.js validPort, PATHS and cleanBoard; START_COMMAND pinned to the package version; test/herdr-map.test.mjs; issue 15
- [ ] List the Map mod on herdr.dev once its Map is on npm {#herdr-list}
  from: agent
  tech: publish 0.4.0 first; then main-branch merge and the herdr-mod repo topic; owner's call

## See the whole fleet {#fleet}
tech: /summary + /fleet aggregation; zoom-out altitude with live repo cards
needs: [runs]
links: [map]
files: [bin/**, public/**]
- [x] Zoom out past the map into the fleet view {#fleet-altitude}
  by: claude
  tech: repo cards — mini status map, live glow, agents present, current tool
- [x] Zoom is the detail dial: capsules auto-unfold as the camera closes {#fleet-semantic}
  by: claude
  tech: hysteresis 1.05/0.85; overlay toggles (activity, runs); run cards fly to their component
- [x] Draw each session's trail across the components it visited {#fleet-trails}
  by: claude
  tech: agent-colored dotted polylines under the edges, dimmed when the session ends
- [x] Show handoffs when one session picks up where another stopped {#fleet-handoffs}
  by: claude
  tech: daemon detects end-to-start ≤10min on a component; card shows from ⇄ to in agent colors
- [x] Zoom into a component's files {#fleet-l2}
  by: claude
  tech: L2 at 150% — files: globs ∩ tree, heat-sorted, agent mark on the hottest file
- [x] One world: repos as regions on a single map, no format switch {#fleet-world}
  by: claude
  from: agent
  tech: every board serves the merged world; regions LOD from card to components; multi-root sidebar; fleet page retired
- [x] Corner minimap with viewport jump {#fleet-minimap}
  by: claude
  tech: overview+detail per the research — status-colored nodes, click to jump

## Ship to GitHub and npm {#ship}
needs: [map, explorer]
files: [README.md, docs/**, package.json, CONTRIBUTING.md, .github/**]
- [x] Remove Kitchen and its files from the repository {#ship-retire-kitchen}
  by: claude
  tech: packages/kitchen, docs/kitchen, examples/kitchen-workflow and their workflow and issue template removed; local tag kitchen-final marks e4ba2da.
- [x] Rewrite the docs with Map as the whole product {#ship-map-docs}
  by: claude
  tech: README.md, docs/OBSERVABILITY.md, CONTRIBUTING.md, package.json.
- [x] Public repo and readme {#ship-repo}
  tech: github.com/sodiumsun/agenttrail + README.md
- [x] Fresh demo gif of the current look {#ship-gif}
  tech: docs/demo.gif
  by: claude
- [x] Publish to npm {#ship-npm}
  by: claude
  tech: agenttrail@0.1.0 — npx agenttrail
- [x] First screen is alive with zero convention {#ship-empty}
  by: claude
  from: agent
  tech: live activity feed as the no-plan hero, backfill banner demoted
- [x] Filmed real-session demo video {#ship-video}
  tech: docs/demo.gif filmed from live boards
  by: claude
  from: agent
- [x] One-command first run {#ship-onboard}
  by: claude
  tech: virgin repo → inline consented init, browser opens by default, prompt on clipboard
- [x] Keep boards alive across reboots {#ship-lifecycle}
  by: claude
  tech: agenttrail up (relaunch known repos) + autostart (launchd/systemd)
- [x] Survive machines that aren't this one {#ship-portable}
  by: claude
  from: agent
  tech: free-port pickup, linux watcher fallback, windows paths, no-git repos
- [x] Say the trust line in the readme {#ship-trust}
  by: claude
  tech: README quick-start — 127.0.0.1 only, no telemetry, one readable file
- [x] Make the repo explain itself at a glance {#ship-readme-magic}
  by: codex
  tech: README.md — felt problem, visual proof, one-command start, trust, then depth
- [x] Make agenttrail easy to find and describe {#ship-discovery}
  by: codex
  tech: README definition, sentence-case headings, npm metadata, GitHub description and topics

## decisions
- 2026-11-04: Retire Kitchen and make Map the whole product. The owner judged the 3D cooking view a gimmick. Map first gains what only Kitchen had that is worth keeping: reading Claude sessions from local logs with no hooks installed. Kitchen's last published commit is kept under the local tag kitchen-final, and agenttrail-kitchen stays on npm. Cursor hooks, artifact plates and receipts, and work categories are dropped on purpose.
- 2026-09-09: Review the public repository for concrete reliability and setup issues, recording reproducible findings separately from planned features. Describe Agenttrail as the local observability project with two views: Agenttrail Map for project structure and activity, and Agenttrail Kitchen for native tasks and role contributions. Document their current independent services and differing provider support rather than implying a unified event backend or agent orchestration.
- 2026-09-08: Publish Kitchen to npm now that the owner has restored registry login. Use alpha.3 for the refreshed package README instead of changing the existing alpha.2 archive; keep the experimental version explicit and use the latest tag so npx agenttrail-kitchen . works. Verify the exact public package from a fresh consumer environment, then publish matching GitHub release assets and setup instructions. The owner chose browser setup first; no editor extension is being added.
- 2026-09-08: Audit the downloadable public Kitchen release from an isolated consumer install, verify real repo observation and adapter behavior, fix launch gaps, and refresh the root README with Kitchen screenshots and exact install/support instructions. No editor extension currently exists; clarify whether the owner wants one built or wants the working browser setup documented. Keep unknown integration status explicit.
- 2026-09-08: The public archive check exposed a symlink entry-point bug: invoking the underlying file worked, but npm's installed command exited without calling main. Fix the entry-point detection and test actual npm exec. Supersede the first preview with alpha.2 rather than silently replacing the published archive.
- 2026-09-08: The owner approved bringing Kitchen into Agenttrail and releasing an experimental preview. Add the kitchen component because the working scene, observers and packaging own packages/kitchen/** and the release now depends on them. Keep the existing map package unchanged; share more runtime code in subsequent work. Import runtime assets, tests and relevant docs, excluding personal logs, reference screenshots and music. A separate video-editing sub-agent is preparing smooth camera moves from the real footage.
- 2026-09-08: Prepare a release-structure recommendation for bringing the built kitchen into Agenttrail. The proposal keeps one repository and an optional kitchen package; package migration and publication are not part of this planning change.
- 2026-09-08: Explore a visually distinct virtual office in sibling ../agent-office. This session produces research, proposed architecture, must-build scope, and comparable visual concepts only. Keep proposed future components in the companion brief until implementation makes them real; do not add speculative components to the existing map.
- 2026-08-30: cycles + kind: knowledge + card-setup graduated into the plan after the board flagged PLAN BEHIND — the observed layer caught an undeclared build burst
- 2026-08-21: spine is the codebase (fs watcher + PLAN.md), not agent hooks; hooks become an optional fidelity adapter
- 2026-08-21: serve index.html fresh per request (no startup cache) so UI edits land without daemon restart
- 2026-08-21: filter editor atomic-write tmp files from the activity signal
- 2026-08-21: graph is hand-rolled svg, not react-flow — keeps the daemon zero-dep and the page build-free
- 2026-08-23: K. removed the plan-changes mechanism entirely — agenttrail is a live read-only status monitor
- 2026-08-23: convention v2 — plan nodes are components (needs + links edges), titles are plain verb-led outcomes for the owner with tech: sublines; layout stays deterministic, the authoring agent is the generative part
- 2026-08-23: run foreground, map as stage — hooks adapter is core (the 30-minute question is the product); file spine stays the fallback for hook-less agents
- 2026-08-23: README leads with the moment agenttrail solves (returning to a long agent run and knowing exactly where it is), proves it with the live demo, then earns trust before exposing the full spec
- 2026-08-23: discovery position is "a local observability layer and live project map for AI coding agents"; distinguish it from LLM trace and cost dashboards with current plans, tool calls, file changes, progress, and revisions, using direct definitions and repository topics instead of keyword stuffing
- 2026-08-27: infinity map scoped as altitudes, not canvas soup — fleet (parallel agents) > board > capsules; zoom is the switcher; data-flow edges deferred until observable
- 2026-08-27: zoom model doc'd in docs/ZOOM.md — space is zoomable (containment only), work is overlay paint at its address; tasks are Plan-overlay annotations, never zoom destinations; symbols + data-flow deferred
- 2026-08-27: fleet page retired — the world IS the map; regions LOD from name-card to full board at 30%; tabs and run cards fly the camera instead of navigating; sidebar is multi-root with lazy sibling trees
- 2026-08-27: light mode is a token-only UI variant — dark stays the default, the top-bar switch persists locally, and no layout or product behavior changes
- 2026-08-27: theme branding uses one app-icon design — light keeps the colorful original; dark is the same rounded-square composition in a night palette
- 2026-08-29: archived cycles are secondary history, not live run cards — open them from the canvas controls in a right-side drawer so the map stays primary
- 2026-11-04: Map writes need a per-daemon token. The page gets it inside the served HTML; a board proxying setup to a sibling reads that sibling's token from ~/.agenttrail/tokens/<port>.token (0600), so a token only ever goes to the daemon that wrote it. /hook stays tokenless for installed relays and relies on the Origin check: browsers always attach Origin to a POST, so a foreign page cannot reach it
- 2026-11-04: a native task change commits only on a recognised success acknowledgement. Failed, unknown or interrupted results keep the last confirmed list. A task update with no known title is dropped rather than shown under an invented name
- 2026-11-04: Codex reading is bounded to the last 2 MiB per file (real logs reach 1 GB), limited to files touched in the last 2 hours (the same window a Map run lives), and its cursors are saved in the same state file as the runs so a restart cannot replay events twice. A run's evidence field says which of its facts are reported, observed, inferred or unknown
- 2026-11-04: the Herdr panel is tasks under Watch live runs, not a new component. It passes three parts of the convention's test (it changes what the product does, a second task is plain in remote machines, it owns herdr/**) but fails the first: nothing depends on it yet and it is unpublished. Promote it to a card if work keeps clustering in herdr/**. The panel reads only GET /panel, a versioned feed, so it never depends on Map's internal run shape. A run links to a terminal by terminal id first, then by repo only when exactly one local agent and one live run match; otherwise the row stays unlinked
- 2026-11-05: the native Map replaces the list panel in herdr/agenttrail, under the mod name agenttrail. One mod is simpler to list and install, and it shows what the panel only summarised. Map keeps GET /panel: the mod uses it to find Maps. The panel's row-to-terminal linking goes with it. Still tasks under Watch live runs, not a new component
- 2026-11-05: the Herdr mod treats every Map reply as untrusted data. It fetches only 127.0.0.1, a whole port it scanned or was given in props, and /panel or /board-lite; a reply is rebuilt into the shapes the view draws, and one without a plan list is no board. Start Map here runs the agenttrail version the mod was released with, so updating the mod is what moves it
