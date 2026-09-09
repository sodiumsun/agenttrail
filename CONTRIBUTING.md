# Contributing to Agenttrail

Agenttrail has a lightweight project map and an experimental 3D kitchen. Both use the same repository and issue tracker. The map's existing command remains independent of the kitchen's graphics dependencies.

## Find the relevant code

| Area | Location |
| --- | --- |
| Map daemon, plans, hooks and fleet | `bin/agenttrail.mjs` |
| Map interface | `public/index.html` |
| Kitchen launcher and local relays | `packages/kitchen/bin/` |
| Provider adapters and workflow state | `packages/kitchen/src/` |
| Kitchen scene, characters and interface | `packages/kitchen/public/src/` |
| Kitchen automated checks | `packages/kitchen/test/` |

The views currently have separate local services. The kitchen can read the map's local board context; it also has standalone observation. Consolidating the duplicated parsers and adapters is future work. Keep provider interpretation out of the scene renderer so future themes can reuse the evidence model.

## Run and check the kitchen

```sh
cd packages/kitchen
npm ci
npm run build
npm start -- --example
```

The example is scripted and labeled. Live provider validation should use your own disposable project. Do not install hooks into unrelated repos or submit real transcripts as test fixtures.

```sh
npm run check
npm test
npm pack
node scripts/check-package.mjs ./agenttrail-kitchen-0.1.0-alpha.1.tgz
```

Keep fixtures synthetic, small and focused on a real failure mode. The package smoke check verifies a clean install with no development dependencies or lifecycle scripts. Run `node --check bin/agenttrail.mjs` at the repository root for changes touching the existing map daemon, and manually check the relevant view.

## Preserve the meaning of activity

- Sessions are actual executors; chefs are responsibilities. Never infer parallel execution from the number of visible chefs.
- Native todos remain the source of dish identity and completion. Never replace missing task progress with an invented checklist.
- A turn ending, tool finishing or file changing does not prove an outcome shipped.
- Explicit receipt metadata is required for confirmed artifact transfers. Clearly distinguish inferred associations.
- Keep pending human actions in the provider's own tool. This project observes; it does not approve or run those actions.

## Report a problem

Use the [issue tracker](https://github.com/sodiumsun/agenttrail/issues). Include the package version, OS, Node version, provider and a short reproduction. Describe whether the problem affects live data, example mode or both. Redact project paths, task titles and private data from screenshots. Useful labels are `kitchen`, `provider-adapter` and `first-run`.

In a pull request, explain the trigger, resulting behavior and relevant checks. Include a screenshot or short silent clip for visible scene changes. Preserve the project's visual direction. New dependencies should have a concrete purpose and their license notices must accompany bundled assets.

## License

Project code and original assets are MIT. Preserve the root license and third-party notices. Do not add game assets, soundtrack recordings, personal logs, secrets or local connection state. Contributions must be yours to contribute under the relevant license.
