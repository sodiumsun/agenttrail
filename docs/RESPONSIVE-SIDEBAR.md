# Repository sidebar at medium viewport widths

## Reproduce

1. Start Map in a disposable repository: `node bin/agenttrail.mjs /path/to/demo --no-open`.
2. Open the printed URL in a browser and set the viewport to 956 pixels wide.
3. Inspect `.workspace`, `#tree` and `#graph` after the page loads.

The current DOM has a repository sidebar in the first grid column and the map
in the second. The base layout assigns `272px minmax(0,1fr)` to those columns.
The `max-width:960px` rule instead assigns `minmax(0,1fr) 288px`, giving the
sidebar all remaining width and constraining the map.

At 956px, the result is a 668px sidebar and a 288px map. This is particularly
noticeable when the repository has many files. It does not require a particular
provider, session, operating system or plan.

## Result after the fix

The medium-width rule inherits the existing sidebar/map columns. At 956px the
sidebar remains 272px and the map receives the remaining 684px.

Browser checks:

| Viewport | Expected sidebar | Expected map |
| --- | ---: | ---: |
| 721px | 272px | 449px |
| 956px | 272px | 684px |
| 960px | 272px | 688px |
| 1440px | 272px | 1168px |

The separate `max-width:720px` stacked layout is unchanged. This fix does not
introduce sidebar collapsing, resizing or new persisted settings, and does not
change the floating run cards.
