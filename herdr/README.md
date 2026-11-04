# Agenttrail for Herdr

A [Herdr](https://herdr.dev) mod: a panel beside your agents showing which part of the project each one touched. Each row has the agent, its current task, its recent path through the project and its status, with each claim labelled reported, observed or inferred. Click a row to jump to that agent's terminal.

![Agenttrail for Herdr](agenttrail/preview.png)

The picture is the real panel reading a real Map, with stand-in agents in a sample repo.

[`agenttrail/`](agenttrail/) is the shareable folder: `mods/agenttrail/`, the [`RECIPE.md`](agenttrail/RECIPE.md) another agent can build it from, and `preview.png`.

## Install

Ask the agent running in Herdr:

```text
Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/sodiumsun/agenttrail/tree/main/herdr/agenttrail
```

By hand: copy `agenttrail/mods/agenttrail/` to `~/.config/herdr-app/mods/agenttrail/` and run `herdr-app check ~/.config/herdr-app/mods/agenttrail`. In a layout of your own it docks on the right the first time Herdr sees it. Herdr's shipped layouts (`main`, the default) don't take new docks, so open it beside your terminal there:

```sh
herdr-app do pane.split --direction right --mod agenttrail
```

## Use

- Run Map in a repo (`npx agenttrail`), or press **Start Map here** in the panel. It finds every Map on this computer.
- It needs a Map with the `/panel` feed; an older one shows a note.
- Click a row to jump to its terminal. A row the panel can't tie to one terminal says so and does nothing: it never guesses between two agents in a repo.
- **Open full map** opens Map in the browser.
- **Show sample** shows made-up data, clearly marked, when nothing is running.

The panel is read-only. It talks only to Map on `127.0.0.1`, ports 5330 to 5344, and the only things it starts are a browser tab and, when asked, a Map terminal. It reads this computer only; agents on other machines are counted, not shown.
