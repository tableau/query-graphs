# `upload-server` — Shareable Links for Query Plans

The `upload-server` is a small, optional [Express](https://expressjs.com/) server that turns an uploaded query plan into a shareable URL.
It exists so a team can host their own endpoint for sharing plans; the public app at [tableau.github.io/query-graphs](https://tableau.github.io/query-graphs/) works without it, storing plans locally in the browser instead (see [`standalone-app`](../standalone-app/README.md)).

The whole server is a single file, `upload-server.js`.

## How Sharing Works

The server plays two roles, wiring itself to the deployed app:

1. **Entry redirect** — a `GET /` redirects to the app's `index.html` with a `?uploadServer=<this-server>/uploads` parameter.
   From then on, the app knows to upload opened plans here (see the sharing flow in [`standalone-app`](../standalone-app/README.md)).
2. **Upload endpoint** — a `PUT /uploads` accepts the raw plan body (up to 2 MB), writes it to a file with a random name, and responds with that file's public URL.
   `GET /uploads/<file>` then serves it back, with CORS enabled so the app can fetch it from another origin.

The returned URL is what makes a plan shareable: anyone who opens it loads the same plan.

## Retention and Privacy

Uploaded plans are stored as files under `uploads/`.
The server keeps only the most recent `KEEP_FILES` (currently **50**) and deletes older ones on each upload, so it is a rolling cache, not permanent storage.

Uploading a plan sends it to whoever operates the server — unlike the app's default local-storage sharing, which never leaves the browser.
Only run plans through an upload server you trust.

## Running It

```shell
cd upload-server
pnpm install
node upload-server.js
```

The server listens on port 3000.
Set `DEBUG=upload-server:*` to see per-request logging (it uses the [`debug`](https://www.npmjs.com/package/debug) module).
The app it redirects to is configured by the `GUI_URL` constant at the top of `upload-server.js`.
