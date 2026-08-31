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
tech: claude code hooks adapter — PostToolUse/TodoWrite → POST /events
needs: [plan-reader]
links: [map]
files: [bin/**, public/**]
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
  tech: Task/SubagentStop hooks -> run.subagents in bin/agenttrail.mjs; .run-sub rows
  by: claude
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
files: [README.md, docs/**, package.json]
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
