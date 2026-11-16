# Slack-in-an-iframe on localhost — progress log

Goal: see whether Slack (web / desktop) can be embedded in an `<iframe>` from a localhost page, and if not, bypass the block for local dev.

## TL;DR

- Slack **cannot** be iframed by a third party out of the box — every `*.slack.com` host sends `X-Frame-Options: SAMEORIGIN`, so the browser refuses to paint the framed document from any non-`*.slack.com` origin.
- A throwaway **Firefox dev extension** strips that header (and CSP `frame-ancestors`/`frame-src`) and **imbues your real first-party Slack cookies** into the iframe's third-party requests, defeating Firefox's third-party cookie partitioning.
- Result: **`https://imbue-ai.slack.com/` renders fully inside an iframe on `http://localhost:8765`**, logged into the real workspace. Workspace selection and the full client load. ✅

## What was built

All in `/Users/bowei/code/bowei-thoughts/working-sessions/457-iframe-slack/`:

| File | Purpose |
|---|---|
| `index.html` | Host page with an `<iframe>` + a dropdown of Slack targets (`slack.com`, `app.slack.com`, `a.slack.com`, `slack.com/sign_in`, `imbue-ai.slack.com`). Probes framing headers and logs them. |
| `server.py` | Static file server on `127.0.0.1:8765` **plus** `POST /__log__` → appends JSON lines to `ext.log` (and stdout). |
| `ff-ext/manifest.json` | MV2 extension: `webRequest`, `webRequestBlocking`, `cookies`, `tabs`, `<all_urls>`. |
| `ff-ext/background.js` | The bypass logic (see below). |
| `ext.log` | Event log written by the extension via the server. |

## How the bypass works

The extension does two things, scoped to `*.slack.com` requests originating from the `http://localhost:8765` tab:

1. **Strip framing headers** (`webRequest.onHeadersReceived`, blocking):
   - drops `X-Frame-Options` entirely;
   - removes the `frame-ancestors` and `frame-src` directives from any `Content-Security-Policy` header, leaving the rest intact.
   - → the iframe is allowed to paint.

2. **Imbue cookies** (`webRequest.onBeforeSendHeaders`, blocking):
   - reads your real first-party Slack cookies via `browser.cookies.getAll({ domain: "slack.com" })` (includes `httpOnly` ones like `d` / `d-s`);
   - filters them by host + path scoping rules (so `imbue-ai.slack.com`-specific cookies aren't sent to `app.slack.com`, etc.);
   - builds a `Cookie` header and replaces the request's cookie header.
   - → defeats Firefox's third-party cookie partitioning (the iframe's requests carry your real session).

### Scoping

- A set of "tracked tabs" is maintained: tabs whose top-level URL is `http://localhost:8765` (or `127.0.0.1:8765`).
- Only `*.slack.com` requests in a tracked tab (or whose `originUrl` is the dev server) get imbued/relaxed — so your normal Slack tabs are untouched.

### Reporting

- Each `imbue` / `relax` / `nocookie` event is `POST`ed to `http://localhost:8765/__log__` (as `text/plain` to avoid preflight), appended to `ext.log`.
- The toolbar icon shows a green badge with the count of imbued+relaxed requests.

## How to use it

1. `python3 server.py` (serves `index.html` on `http://localhost:8765`).
2. In Firefox: `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → select `ff-ext/manifest.json`.
3. Log into Slack normally in this profile (e.g. visit `https://imbue-ai.slack.com/` once).
4. Open `http://localhost:8765/index.html`, pick `imbue-ai.slack.com`, click **Load into iframe**.
5. Watch the badge count climb; `tail -f ext.log` for details.

## Cloudflare tunnel (optional, for sharing)

An anonymous quick tunnel was used to expose the localhost page publicly:

```bash
cloudflared tunnel --url http://localhost:8765
# -> https://<random>.trycloudflare.com
```

Note: the **extension** only relaxes headers when the parent is `localhost:8765`, so the tunnel URL is useful for sharing the *host page* but the bypass won't fire from the tunnel origin unless you also add the tunnel host to `PARENT` / tracking. For the bypass itself, use `localhost:8765` directly.

## What did *not* need solving (this time)

- **localStorage partitioning**: Slack's SPA keeps its `xoxc-*` token in `localStorage`, which Firefox partitions per top-level origin. We expected the iframe to bounce to `/signin` despite cookie imbuing. In practice, with cookies attached, Slack's boot flow proceeded and the workspace loaded. If a future profile/workspace hits the localStorage wall, the next step is a content script that copies `app.slack.com` localStorage from a first-party visit into the iframe's partitioned storage before Slack's JS runs.

## Key gotchas hit

- `curl` on this machine failed to resolve `*.trycloudflare.com` via the default resolver (Tailscale MagicDNS at `100.100.100.100`); `--resolve` worked fine. The tunnel itself was healthy.
- Initial reporting `fetch` used `mode: "no-cors"` + `Content-Type: application/json`; the browser silently strips that content type in no-cors, so events didn't land. Switched to `text/plain` (simple request, no preflight) with the server sending `Access-Control-Allow-Origin: *`.
- `python -m http.server` doesn't handle `POST`; replaced with a small `server.py` that serves static + accepts `POST /__log__`.

## Cleanup

```bash
pkill -f "cloudflared tunnel"
pkill -f "server.py"
```

## Status

✅ `imbue-ai.slack.com` renders fully in an iframe on `http://localhost:8765`, logged in, via a dev Firefox extension. Cookie imbuing + header stripping confirmed working.
