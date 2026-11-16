# Slacktop — progress v2

Embedding Slack in a localhost `<iframe>`, defeating the framing + cross-origin walls, and bridging DOM read/write *both directions* between the parent page and the Slack iframe via a dev Firefox extension.

## Outcome

End-to-end working:
- `https://imbue-ai.slack.com/` renders **fully inside an iframe on `http://localhost:8765`**, logged into the real workspace, with the full client booting (conversations, messages, canvas, presence).
- The parent page can **read and write the Slack DOM** (cross-origin) through an extension-injected content script.
- Clicks **inside Slack are observed and reported out** to the parent, including a stable selector path, the clicked text, and the Slack **message `ts`**.

## Architecture

```
localhost:8765 (parent page, index.html)
   │  postMessage({from:'slacktop-parent', cmd, id})        ──► outside→inside
   │  ◄── postMessage({from:'slacktop-cs', event:'click',…})  inside→outside
   │  ◄── postMessage({from:'slacktop-cs', id, result})      response
   ▼
<iframe src="https://imbue-ai.slack.com/">   (cross-origin)
   │
   └─ extension content script (content.js) runs INSIDE *.slack.com origin
        • reads/writes DOM (same-origin to itself)
        • observes clicks (capture phase)
        • bridges to parent via window.parent.postMessage
            ▲
extension background.js
   • strips X-Frame-Options / CSP frame-ancestors  (onHeadersReceived)
   • imbues real first-party slack.com cookies     (onBeforeSendHeaders)
   • tracks the localhost:8765 tab; reports to server
```

The key insight: the parent page's own scripts are bound by Same-Origin Policy and **cannot** touch the cross-origin iframe DOM. But a content script with host permission runs **inside** the iframe's origin and is **not** bound by page SOP. `postMessage` is the one cross-origin call pages are allowed, so the parent ↔ content-script bridge is the tunnel that crosses the boundary. The extension is the privileged man-in-the-middle.

## What's in the repo

`/Users/bowei/code/bowei-thoughts/working-sessions/457-iframe-slack/`

| File | Role |
|---|---|
| `index.html` | "Slacktop" desktop UI: grassy-field background (Windows-XP-Bliss-style CSS gradients) + draggable windows (Slack iframe, ext.log tail, DOM R/W widget). |
| `server.py` | Static server on `127.0.0.1:8765` + `POST /__log__` → appends to `ext.log`. |
| `ff-ext/manifest.json` | MV2 extension: `webRequest`, `webRequestBlocking`, `cookies`, `tabs`, `<all_urls>`; content script on `*://*.slack.com/*` (all_frames, document_idle). |
| `ff-ext/background.js` | Header stripping + cookie imbuing + tab tracking + event reporting to `ext.log` + badge counter. |
| `ff-ext/content.js` | Inside-slack bridge: handles `ping`/`snapshot`/`toggle` cmds; observes clicks and reports path + text + href up to parent. |
| `ext.log` | Server-side log of extension `imbue`/`relax`/`nocookie` events. |
| `PROGRESS.md` | v1 writeup (framing + cookie bypass). |
| `PROGRESS-v2.md` | this file. |

## The three bypasses (each a separate defense layer)

1. **Framing block** — Slack sends `X-Frame-Options: SAMEORIGIN` (and CSP `frame-ancestors` on some hosts). Extension strips these in `onHeadersReceived` for `*.slack.com` responses in the localhost tab. → iframe paints.

2. **Cookie partitioning** — Firefox partitions third-party iframe cookies per top-level origin, so the iframe's requests to `app.slack.com` would carry no session. Extension reads your real first-party slack.com cookies via `browser.cookies.getAll({domain:"slack.com"})` (incl. `httpOnly` like `d`/`d-s`), filters by host+path scoping, and sets the `Cookie` header in `onBeforeSendHeaders`. → iframe is authenticated as you. Verified: 71 imbue events, each carrying 26 cookies, to `imbue-ai.slack.com/api/...` and `edgeapi.slack.com/...`.

3. **Same-Origin Policy (DOM)** — the parent can't read/write the cross-origin iframe DOM. Extension's content script runs inside `*.slack.com` and bridges via `postMessage`. → bidirectional DOM access.

## The bidirectional bridge

### Outside → inside (DOM read/write)

Parent calls `frame.contentWindow.postMessage({from:'slacktop-parent', id, cmd}, '*')`; content script handles and replies via `ev.source.postMessage({from:'slacktop-cs', id, result}, '*')`. Parent correlates by `id`.

Commands:
- `ping` → `{ok, url, origin}` (bridge liveness).
- `snapshot` → `{url, title, divCount, channelNames[], clientLinks[], bodyTextSample, hasBanner}` (DOM read).
- `toggle` / `toggleOn` / `toggleOff` → injects/toggles a full-width gradient banner `#slacktop-dumb-banner` at the top of Slack (DOM write). Visible over the real workspace.

### Inside → outside (click observation)

Content script installs `document.addEventListener('click', handler, true)` — **capture phase**, so it runs before Slack's handlers can `stopPropagation`. For each click it computes a path and `postMessage`s up to `window.parent`:

```
{from:'slacktop-cs', event:'click', ts, path, tag, classes, text, href, x, y}
```

Path format: `tag.class.class[idx] > ...`, each segment = tag + first 3 classes + `[childIndexAmongSameTag]` + `#id`/`[data-qa="..."]` hints, capped at 14 levels.

The parent renders each click as a line in the Widget window and bumps a click counter badge.

## Real findings from Slack's DOM

A captured click on a message sender:

```
div[1]#message-list
 > div.c-virtual_list.c-virtual_list--scrollbar.c-message_list[1]#message-list
 > div.c-scrollbar__hider[1][data-qa="slack_kit_scrollbar"]
 > div.c-scrollbar__child[1]
 > div.c-virtual_list__scroll_container[1][data-qa="slack_kit_list"]
 > div.c-virtual_list__item[5]#message-list_1789787673.084379[data-qa="virtual-list-item"]
 > div.c-message_kit__background...p-message_pane_message__message[1][data-qa="message_container"]
 > div.c-message_kit__hover.c-message_kit__hover--hovered[1]
 > div.c-message_kit__actions.c-message_kit__actions--default[1]
 > div.c-message_kit__gutter[1]
 > div.c-message_kit__gutter__right[2][data-qa="message_content"]
 > span.c-message__sender.c-message_kit__sender[1][data-qa="message_sender"]
 > span.p-member_profile_hover_card[1]
 > button.c-link--button.c-message__sender_button[1][data-qa="message_sender_name"]   "Bowei Liu"
```

Takeaways:
- Slack ships **`data-qa` test hooks in production** — stable selectors: `message_container`, `virtual-list-item`, `message_content`, `message_sender`, `message_sender_name`, `slack_kit_list`, `slack_kit_scrollbar`, etc.
- The virtual-list item **id encodes the message `ts`**: `message-list_1789787673.084379` → `ts = "1789787673.084379"`. So a click alone recovers the exact message id needed for API calls (`conversations.replies`, `reactions.add`, …).
- `data-qa="message_sender_name"` gives the author without parsing text.
- The list is **virtualized** (`c-virtual_list__item` only for rendered rows) → scroll-to-load matters for bulk reads.

## UI ("Slacktop" desktop)

Pure HTML/CSS/JS, no frameworks:
- **Background**: Windows-XP-Bliss-style grassy field — layered radial + linear CSS gradients (blue sky over rolling green hill).
- **Draggable windows**: title bar with traffic-light dots, active/inactive title-bar gradient, click-to-focus with z-index stacking, drag via pointer events.
  - **Slack — iframe**: URL dropdown (incl. `imbue-ai.slack.com`), Load/Open buttons, the iframe.
  - **ext.log — live**: dark terminal panel that HTTP-tails `ext.log` every 800ms, color-coded (`imbue` blue, `relax` gold, `nocookie` red), with a count badge.
  - **Widget — DOM R/W POC**: ping/snapshot/toggle buttons + a streaming output panel; click events stream in green with blue paths.
- **Clock** in the bottom-right.

## How to run

```bash
cd /Users/bowei/code/bowei-thoughts/working-sessions/457-iframe-slack
python3 server.py                       # http://localhost:8765
# Firefox → about:debugging → Load Temporary Add-on → ff-ext/manifest.json
# Log into Slack normally in this profile once.
# Open http://localhost:8765/index.html, pick imbue-ai.slack.com, Load.
```

Optional public tunnel for the host page (note: the bypass only fires for parent `localhost:8765`, so use localhost for the working setup):
```bash
cloudflared tunnel --url http://localhost:8765
```

## Cleanup
```bash
pkill -f "cloudflared tunnel"
pkill -f "server.py"
```

## Gotchas hit along the way (for future reference)
- `curl` on this machine failed to resolve `*.trycloudflare.com` via the default resolver (Tailscale MagicDNS `100.100.100.100`); `--resolve` worked. Tunnel itself was healthy.
- `python -m http.server` doesn't handle `POST`; wrote `server.py` with a `do_POST` for `/__log__`.
- First reporting `fetch` used `mode:"no-cors"` + `Content-Type: application/json`; the browser silently strips that content-type in no-cors, so events didn't land. Switched to `text/plain` (simple request, no preflight) with the server sending `Access-Control-Allow-Origin: *`.
- `localStorage` partitioning was the expected next wall after cookie imbuing, but in practice Slack's boot proceeded with cookies attached — the workspace loaded without needing a localStorage-copy step. (Kept in mind if another profile/workspace hits it.)
- Content scripts inject into the sandboxed iframe only because the iframe keeps its origin (`sandbox="allow-same-origin allow-scripts"`). Without `allow-same-origin` the iframe would be opaque-origin and content scripts wouldn't match.

## Status

✅ Framing bypass — iframe renders.
✅ Cookie imbuing — iframe authenticated as the real user (26 cookies, full API access).
✅ Outside→inside — DOM read (`snapshot`) + DOM write (`toggle banner`) via content-script bridge.
✅ Inside→outside — click observation with selector path, text, href, and recoverable message `ts`.
✅ Desktop UI — draggable windows over a grassy field, live ext.log tail, widget panel.

## Possible next steps (not done)
- "Capture last clicked message" widget: pull `ts` from the click path, read `{sender, text, ts}` from that node.
- Write demo: type into Slack's compose box (`data-qa="msg_input"`) from the outside.
- Screenshot via `browser.tabs.captureVisibleTab` (extension-only; cross-origin pixels rasterize fine).
- Bulk message scrape by scrolling the virtual list and deduping by `ts`.
