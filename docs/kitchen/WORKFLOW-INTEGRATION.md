> Current order presentation: ephemeral native todos now appear as shared dishes, with a completion conveyor and deliverable table. Permanent components are background context. See [SHARED-OUTCOMES.md](SHARED-OUTCOMES.md).

# Connect a workflow to its chefs

Any local repo can be opened without a project map; it receives a persistent crew adapted from its structure, with inferred responsibility assignments. Sessions supply execution evidence and can move between several chefs. When a map is present, its persistent roles take precedence. The Reddit component map produces Researcher, Writer, Evaluator, Publisher, and Head chef, plus human review and knowledge counters. Other mapped projects receive roles from their own components. See [Open a working repo](CONNECTING.md) for the basic connection flow.

## Configure names and responsibilities

The optional `.office/kitchen.json` retains version 1. Add a `workflow` object alongside the existing `kitchens` and `deliverables` arrays:

```json
{
  "version": 1,
  "kitchens": [],
  "deliverables": [],
  "workflow": {
    "id": "project",
    "title": "Build the gallery",
    "roles": [
      {"id": "designer", "title": "Designer", "components": ["gallery", "uploads"]},
      {"id": "reviewer", "title": "Reviewer", "components": ["review"]}
    ]
  }
}
```

Component IDs must exist in PLAN.md. Unclaimed ordinary components receive their own roles, so a partial configuration cannot hide work. Human components never become chefs; knowledge components become pantry counters and may also be included among a role's responsibilities. Invalid/duplicate role entries are skipped; their unclaimed components use the fallback mapping.

For a repo without PLAN.md, the configuration can instead declare roles with `id`, `title`, `description`, `files` (relative glob patterns), and an optional `category` of `coordinate`, `research`, `build`, `simulation`, `review`, or `publish`. Keep `version: 1`, `kitchens: []`, and `deliverables: []`. Explicit roles override the inferred crew; `workflow: false` deliberately opts back into session-only presentation. Opening a repo never writes this file automatically.

An empty `kitchens` array uses one coherent group, with up to eight components per room. Explicit room groups remain supported. A role has one home based on its first component; keep that role's components together when authoring room groups. The scene adds counters at the same scale, up to eight station positions. A room without an explicit workflow map can still use the legacy session presentation by setting `"workflow": false`.

## Automatic association

An explicit role binding takes precedence. Otherwise the kitchen uses a unique exact match between the current session task and a plan task, then the available component association. Those automatic links remain labeled inferred. File and board conflicts stay uncertain.

Without components, a unique role file pattern wins, followed by a supported operation category. The Head chef holds unclassified activity when that role exists. Recent completed desktop operations add context and a per-chef last contribution; they do not start an executor or claim simultaneous work. One session has at most one current chef assignment. All inferred roles share the same native order collection, so switching roles never duplicates the dish.

The normal snapshot includes both `crew` (the presentation roles, plus unlinked session entries) and `executors` (the original observed sessions). Each role carries its own stable ID, owned components, current assignments, source evidence, and working count. Its visible name and color remain stable as sessions change. A role shared by two sessions still has one character and exposes both assignments in details.

Unlinked sessions appear both in the roster and as named session chefs on the floor until a project role is known. The scene prioritizes working/urgent chefs when more than twelve are available; the roster keeps the rest. Empty roles remain visible without pretending to be running. A role covering several goals shows live activity on the associated goal, rather than claiming that every owned goal is active.

## Report an explicit role

For orchestration that cannot be identified from ordinary tool/file metadata, send a role event after the session has been observed. `bin/role.mjs` reads JSON from stdin and uses the existing local connector registration:

```json
{
  "provider": "codex",
  "sessionId": "the-observed-session-id",
  "cwd": "/absolute/path/to/watched/project",
  "workflowId": "project",
  "roleId": "writer",
  "runId": "optional-cycle-id",
  "itemId": "optional-work-item-id"
}
```

Pass that JSON to `node bin/role.mjs`, optionally with `--state-dir /path/to/state`. Supported providers are codex, claude, and cursor. Use the unprefixed `sessionId` from `executors`, rather than the composite `id`.

Send another binding when the session changes role. Send `roleId: null` to clear it. The event changes the display association only: it neither starts work nor refreshes a stale execution signal. A native turn/tool event still determines the actual activity. Cross-project bindings and bindings for unobserved sessions are rejected. Unknown configured role IDs remain visibly unlinked.

Bindings are in memory; integrations should announce the current role after the companion restarts. Role character identities persist in the browser. Optional run/item identifiers are retained as metadata; this version does not derive batch completion or provide a run-filtered queue from them.

## Read the Reddit queue

The local adapter reads bounded draft frontmatter, matching evaluation verdicts, and the recorded dispatch block. The browser receives titles, paths, item states, and revision digests; draft/evaluation bodies stay on the local server. Cached reads update when files change. Files resolving outside the project are excluded.

The queue distinguishes revision, evaluation, human review, dispatch, history, and unknown state. Recorded posting is labeled as such, rather than being declared verified delivery. Schedule and approval fields are observations, not permission to publish. Human review opens the existing console; there is no approval or posting action in the kitchen.

Counts cover the recorded queue, independently of PLAN checkboxes. The view is bounded to 500 files and labels limited/unavailable input. The digest identifies title/body changes; if a previously observed draft changes without a new evaluation, it returns to evaluation. This is an in-memory freshness check, not a replacement for revision-aware approval in the source workflow.

Individual plates expose item details. The room displays at most eight plates; the queue retains the rest. Reading files establishes item state, not a proven handoff between actors. Explicit artifact transfers keep their original session identities and are never rewritten to whichever role that session serves now. Native provider role/receipt coverage remains dependent on emitted metadata.

## Controls

Select a chef to inspect its responsibilities and executing sessions. Select a goal to find its contributing role. Room view gives the scene more space; Show goals brings the tickets back. Motion pause preserves live text updates. The festival art, level camera, and uniform object scale remain unchanged; the transparent canvas shares one continuous page backdrop.

### Share a native order

The role relay additionally accepts `orderId`, copied from the order's details. This explicitly associates that executing session with the same dish, including when another session owns the native todo. Cross-project links are ignored. The native todo's owner still controls its status; role bindings do not complete work. Bindings and contribution history are currently in memory.
