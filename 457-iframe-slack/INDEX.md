# Index / discoverability — Slack in an iframe on localhost (web extension demo)

> Pointer file. Rich with keywords so this line of work shows up in searches.
> If you found this by searching, you're in the right place.

## What this is

A localhost HTML page ("Slacktop") that embeds **Slack inside an iframe**, made
to work by a **Firefox dev/temporary web extension** that:
- strips `X-Frame-Options` / CSP `frame-ancestors` (framing bypass), and
- copies your real `*.slack.com` cookies into the iframe requests (cookie imbuing),
- bridges DOM read/write both ways (outside↔inside) via `postMessage` + content script.

Served from `http://localhost:8765` (`server.py`), optionally exposed via an
anonymous **Cloudflare tunnel** (`*.trycloudflare.com`).

## Where everything lives (this directory)

- `STARTUP.md` — slim run-it-again cheat sheet (start here to relaunch).
- `PROGRESS.md` — v1 writeup (framing + cookie bypass).
- `PROGRESS-v2.md` — full architecture, three bypasses, bidirectional bridge, Slack DOM findings.
- `SUMMARY.md` — the long session-summary doc.
- `index.html` — the "Slacktop" desktop UI (iframe + log + widget windows, grassy field).
- `server.py` — static server + `POST /__log__` → `ext.log`.
- `ff-ext/manifest.json`, `ff-ext/background.js`, `ff-ext/content.js` — the Firefox MV2 extension.
- `ext.log` — live event log (gitignored; contains a live `xoxc-` token — don't commit).
- `ext.log.sample` — redacted sample.
- `instr` — original operator ask.

## How to relaunch

See `STARTUP.md`. Short version:
```bash
cd /Users/bowei/code/bowei-thoughts/working-sessions/457-iframe-slack
python3 server.py          # http://localhost:8765
# Firefox → about:debugging → Load Temporary Add-on → ff-ext/manifest.json
# Log into Slack normally once, then open http://localhost:8765/index.html
```

## Search keywords (so this surfaces next time)

This is the line of work for any of these searches:

- slack iframe, slack in an iframe, embed slack in iframe, iframe slack
- localhost slack, slack localhost demo, slack desktop shell, slacktop
- web extension, firefox extension, temporary addon, dev extension, MV2
- X-Frame-Options bypass, CSP frame-ancestors bypass, strip framing headers
- cookie imbuing, third-party cookie partitioning, imbue slack cookies, httpOnly cookies iframe
- cloudflare tunnel, trycloudflare, anonymous tunnel, reverse proxy localhost
- postMessage bridge, content script bridge, cross-origin DOM read/write, inside→outside clicks
- data-qa hooks, slack DOM selectors, message ts, virtual-list-item
- bypass slack framing, slack embed bypass, slack programmable surface

## How it was found originally

Searched the repo for the line of work:
```bash
find . -type d -iname "*slack*"        # → working-sessions/457-iframe-slack
find . -type f -iname "*slack*"
grep -rl "slack" --include="*.md" ...
```
The directory name `457-iframe-slack` and the `slack` keyword in these docs are
what made it findable. If you rename anything, keep "slack" + "iframe" in the
path/filenames so this stays discoverable.

## Related (other slack work in this repo, not this demo)

- `docs/slack/` — Slack API flow notes (channel resolution, search, draft/send, undo/reactions, channel/user ids).
- `docs/slack/2026-05-12-contact-scrape/` — contact/channel scrape.
- Other `working-sessions/*slack*` dirs — daily-update, gabe-slack, latchkey-slack, widget-board, detent-slack-files, etc. (different lines of work).
