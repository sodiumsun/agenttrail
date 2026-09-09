# A crew for a small 3D project

`kitchen.json` adapts the role layout used in the recorded collaboration: Researcher, World builder, Simulation engineer, Gameplay engineer, Reviewer and Producer. It contains no real session IDs, saved connection state or personal paths.

To use it, copy this file to `.office/kitchen.json` in your own repo and adjust its component IDs and relative file patterns. Existing files should be reviewed before replacement. The component IDs refer to the durable headings in your PLAN.md. If your repo has no plan, use `"kitchens": []`, remove the role `components` arrays, and retain the role `files` mappings.

This config only describes responsibilities. It does not launch six agents, create todos or emit handoffs. Your actual sessions and supported native task metadata determine which chefs work and which dishes appear.

For an immediately active demonstration without any agent session, open the kitchen's labeled **Example** mode. For genuine multi-session contributions to a shared todo, see [explicit order bindings](../../docs/kitchen/WORKFLOW-INTEGRATION.md#share-a-native-order) and [artifact receipts](../../docs/kitchen/HANDOFFS.md).
