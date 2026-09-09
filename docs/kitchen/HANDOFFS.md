# Explicit plates and receipts

Ordinary provider logs and hooks report agent activity. They do not currently establish artifact identity, revisions, or receipts. The kitchen provides an optional local metadata endpoint for an integration that has this evidence. It does not infer a handoff from two agents touching the same path.

The endpoint accepts four kinds: `produced`, `offered`, `received`, and `failed`. Every event needs a unique event ID, watched project directory, producer provider/session, artifact ID, and exact revision ID. Transfer events additionally need a stable handoff ID and recipient provider/session. A receipt means the emitting integration attests that the recipient received that revision.

```json
{
  "id": "event-unique-1",
  "kind": "produced",
  "cwd": "/absolute/project",
  "provider": "codex",
  "sessionId": "actual-producer-session",
  "artifactId": "gallery-layout",
  "revisionId": "sha256-exact-revision",
  "type": "json",
  "file": "layout.json",
  "label": "Gallery layout"
}
```

Send this JSON on stdin to `node bin/plate.mjs`. Use `--state-dir /path/to/state` when running a separately configured service. The relay reads the local service registration; its connector key is never exposed in the browser. It does not read or hash the artifact body. The producing integration must provide a trustworthy revision.

For a transfer, keep the artifact/producer fields identical, use a new event ID, and add:

```json
{
  "kind": "received",
  "handoffId": "handoff-unique-1",
  "recipientProvider": "claude",
  "recipientSessionId": "actual-recipient-session"
}
```

An offer can precede the receipt. A received event can also arrive first; a delayed offer will not rewind it. Terminal states cannot change identity or return to offered. Use a new handoff ID for a retry after failure. Multiple receivers use separate handoff IDs referencing the same artifact revision.

Only whitelisted metadata enters the ledger. Raw bodies, prompts, and arbitrary extra fields are discarded. Paths must remain in the watched project. Known producer/recipient sessions cannot cross project boundaries. IDs, provider values, event kinds, duplicates, and changing transfer identities are validated.

The service keeps up to 200 artifact revisions, 400 transfers, and 4,000 deduplication keys in memory. Restarting the service clears this ledger; the source integration must restore current metadata if needed. Browser reconnection restores the current service snapshot without replaying old animations. A new receipt briefly presents the plate arriving at its recipient's station, using the sender's position when visible or the central pass for an incoming cross-room receipt. This presentation lasts about 0.7 seconds and does not take over either chef's current action. Reduced motion places the plate directly; historical receipts are not replayed on room entry. The ledger updates immediately, including while motion is paused.

Supported ingredient types are `json`, `image`, `text`, `code`, and `table`. Unknown types use a cloche. Native log-based revision matching, persistent artifact history, and provider-specific automatic receipt integrations are not implemented in this first release.

## Attach inputs and outputs to a shared dish

Add `orderId` to the first artifact event, using the exact ID from a native order's details or the local state API. The order must exist in the same watched project. The artifact revision retains that order link; later events cannot reassign it. Its inputs/outputs and receipts then appear in the dish's details.

An explicitly bound producer role is captured when `produced` is observed. A recipient's explicit role is captured when the transfer event is observed. These historical labels survive later role changes, including Researcher → Writer within one Codex session. When the producer role was not observed, keep it unknown. Ordinary file activity still does not establish a receipt.
