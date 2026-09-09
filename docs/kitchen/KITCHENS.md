# One project, several kitchens

The order rail follows ephemeral native todos. Durable Agenttrail components remain in **Project map**, where they describe ownership, dependencies and configured outcomes. A chef represents a persistent responsibility; actual sessions execute that work. [Shared dishes](SHARED-OUTCOMES.md) explains the distinction.

## Group a larger project

A workflow room holds up to eight components. Related roles share preparation, cooking, checking and assembly counters. Explicit room groups keep a large repo navigable without creating separate projects or duplicating its task history. Unlisted components remain visible in additional rooms; changing task status does not regroup rooms.

Put this optional configuration in the watched repo's `.office/kitchen.json`:

```json
{
  "version": 1,
  "kitchens": [
    {"id":"main","title":"The product kitchen","components":["ui","api"]},
    {"id":"service","title":"The service kitchen","components":["jobs"]}
  ],
  "deliverables": [
    {"id":"launch","title":"Launch the gallery","icon":"image","tasks":["upload","gallery","thumbnail-job"]}
  ]
}
```

`components` references stable PLAN.md component IDs; `tasks` references globally unique task IDs in that plan. These configured deliverables are project-map context, not a replacement for the native todo collection. Missing references leave completion unknown. Available icons are `map`, `image`, `network`, `gear` and `box`.

The [portable role example](../../examples/kitchen-workflow) shows how one 3D project can retain a Researcher, World builder, Simulation engineer, Gameplay engineer, Reviewer and Producer in a shared kitchen. It contains configuration only and does not launch agents or supply activity.

## Move between rooms

A role has a stable home based on its first component. Keep that role's components together when authoring room groups. Actual session assignments determine which role is working; changing rooms does not move agents between tools or start execution.

Room tabs show working counts and attention. Selecting related work can open another kitchen. Agent names, colors and badges persist; details retain session identities and evidence. The scene prioritizes working or urgent chefs if more than twelve are available, while the roster retains the others.

Plate histories preserve sender, recipient and revision identities across kitchens. A newly received artifact can animate at the receiving station. Room entry and reconnection do not replay historical receipts. Ordinary file activity does not prove a transfer.

The first preview displays at most twelve chefs and eight individual artifact plates per room. Room layout editing, dragging components between rooms and cross-machine observation are future work.
