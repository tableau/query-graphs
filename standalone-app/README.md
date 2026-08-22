# `standalone-app` — The Query Graphs Web App

The `standalone-app` is the web app deployed at [tableau.github.io/query-graphs](https://tableau.github.io/query-graphs/).
It wraps the [`query-graphs`](../query-graphs/README.md) core library with everything the library does not provide itself:
Getting a plan into the browser (paste, file open, drag & drop), turning the current plan into a shareable link, keeping the plan in the URL, and working offline as an installable PWA.

It is a TypeScript + React app bundled with webpack.
All plan parsing and rendering is delegated to `@tableau/query-graphs`; the code here is the "shell" around it.

The app provides:

* **Loader dispatch** — `loadPlan` (`src/tree-loader.ts`), which tries each format loader from the core library in turn.
* **The plan in the URL** — `browserUrlHooks.ts`, which stores the open plan and title as URL parameters so history and link-sharing work.
* **Getting a plan in** — `FileOpener.tsx`, handling paste, drag & drop, and validation.
* **Persisting and sharing a plan** — `LocalStorageUrl.ts` plus the optional `upload-server` integration.
* **App chrome** — `TreeLabel` (editable title + metadata), `ErrorBoundary`, and the PWA/offline setup.

## Loader Dispatch

`loadPlan` (`src/tree-loader.ts`) is the bridge to the core library: it tries the various loaders in order and returns the first `TreeDescription` that parses.
The order is deliberate; see [Plan Formats and Loaders](../docs/PlanFormatsAndLoaders.md).
The same function doubles as the input validator in `FileOpener`, so the paste box can tell the user immediately whether their text is a recognized plan.

## The Plan Lives in the URL

The currently open plan is not React state that vanishes on reload — it is a URL parameter.
`QueryGraphsApp.tsx` reads a `file` parameter (the plan's URL) and a `title` parameter via the hooks in `browserUrlHooks.ts`, and renders either the `FileOpener` (no plan) or the `QueryGraph` (plan loaded).

Note that the `file` parameter can point to arbitrary valid URLs.
You can construct deeplinks — for example with a `data:` URL — to open a specific query plan directly:

```
#file=data:application/json,<url-encoded plan JSON>
```

This design buys three things for free:

* **Browser history** — opening a plan pushes a history entry, so Back returns to the previous plan; editing the title uses `replaceState` so it does not spam history.
* **Shareable links** — a URL fully describes what is on screen.
* **The examples page** — each entry on `examples.html` is just a `file=` link into the app.

Parameters are kept in the URL **hash**, not the query string.
We don't want to leak any (potentially confidential) query plans to the server.
Browsers never send the hash portion of a URL to the server, so `useUrlParam` keeps them in the URL hash.

## Getting a Plan In

`FileOpener.tsx` is the landing screen.
It accepts a plan by:

* **Pasting** into the textarea — pasting into an empty box auto-submits, and pasted files are read as text.
* **Drag & drop** of a file anywhere on the page.
* **Typing/pasting then clicking "Visualize Plan"**, or pressing Ctrl/Cmd-Enter.

It validates input live using `loadPlan` and shows parse errors before the user submits.

## Persisting and Sharing a Plan

When a plan is opened, the app has raw text but needs a URL to put in the address bar.
`openPickedData` in `QueryGraphsApp.tsx` picks a URL strategy in this order:

1. **Upload server** — if an `uploadServer` parameter is present, `PUT` the plan to it and use the returned shareable URL (see [`upload-server`](../upload-server/README.md)).
2. **Local storage** — otherwise `tryCreateLocalStorageUrl` (`LocalStorageUrl.ts`) stashes the plan under a `local:` URL, so it survives a page reload without a server.
3. **Blob URL** — as a last resort, an in-memory `blob:` URL that lasts only for the current page.

The upload-server flow starts when someone visits an `upload-server` instance: it redirects to the app with `?uploadServer=…`, after which opened plans become shareable links.
Because plans can contain sensitive SQL, the default local-storage/blob strategies keep everything on the user's machine — nothing is uploaded unless an upload server is explicitly in play.

## App Chrome, Offline, and Examples

* `TreeLabel.tsx` renders the editable graph title (persisted via the `title` URL param) and any plan `metadata`.
* `ErrorBoundary.tsx` catches render-time crashes and shows the error text with a link to file a GitHub issue.
* Production builds register a [Workbox](https://developer.chrome.com/docs/workbox) service worker (configured via `GenerateSW` in `webpack/prod.config.ts`) and ship a web-app manifest (`src/manifest.json`), so the app is installable and works fully offline; the favicons are generated at build time.
  The service-worker cache is a common source of confusion: a locally served production build (`prod-server`) can keep serving a **stale** `bundle.js`/`index.html` even after a rebuild.
  If a change is not showing up, clear the site's service worker and cache in your browser's dev tools, or use the `dev-server`, which does not register a service worker.
* `examples.html` is generated at build time by `webpack/webpack-create-examples-list.ts`, which walks `examples/` and emits a linked index. The example plans themselves are regenerated by [`plan-dumper`](../plan-dumper/README.md).
