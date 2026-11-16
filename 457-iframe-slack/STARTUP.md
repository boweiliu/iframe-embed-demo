# Slacktop — startup cheat sheet

Slack in an iframe on localhost, via a Firefox dev extension that strips framing
headers and imbues your real Slack cookies. Bidirectional DOM bridge (outside
can read/write inside; inside reports clicks to outside).

## One-time setup

1. Use Firefox (MV2 dev extension). Chrome won't load this as a temporary add-on.
2. Log into Slack normally in this Firefox profile once — this seeds the cookies
   the extension will copy into the iframe. Workspace used last: `imbue-ai.slack.com`.

## Run (each session)

```bash
cd /Users/bowei/code/bowei-thoughts/working-sessions/457-iframe-slack
python3 server.py            # serves http://localhost:8765, writes ext.log
```

In Firefox:
1. `about:debugging` → "This Firefox" → "Load Temporary Add-on" → pick
   `ff-ext/manifest.json`. (Temporary add-ons unload when Firefox quits — reload
   each session.)
2. Open http://localhost:8765/index.html
3. Pick the workspace from the dropdown, click Load. Slack should render inside
   the iframe window (not blank = cookies imbued correctly).

Optional public host page (the bypass only fires for parent `localhost:8765`,
so use localhost for the working setup; the tunnel is just for showing the shell):
```bash
cloudflared tunnel --url http://localhost:8765   # prints a *.trycloudflare.com URL
```

## Verify it's working

- Iframe is **not blank** → framing bypass + cookie imbuing both succeeded.
- "Widget — DOM R/W POC" window: `ping` / `snapshot` / `toggle` buttons reach into
  the Slack iframe. `toggle` drops a banner over real Slack.
- Click anything inside Slack → click path + text appears in the widget.
- `ext.log` grows with `imbue` events (one per Slack request, ~26 cookies each):
  `tail -f ext.log`  (gitignored — contains a live xoxc- token, don't commit it).

## Cleanup

```bash
pkill -f "server.py"
pkill -f "cloudflared tunnel"
```

## If it breaks

- **Iframe blank / stuck on signin** → you skipped the normal Slack login in this
  profile. Log into Slack normally first, then reopen localhost.
- **Extension not firing** → confirm it's loaded (`about:debugging` shows it) and
  you're on `localhost:8765` (bypass is scoped to that parent origin).
- **`curl` can't resolve `*.trycloudflare.com`** → Tailscale MagicDNS quirk; use
  `curl --resolve` against the Cloudflare IP, or just test in the browser.
- **Another workspace hits a wall after cookies** → predicted next wall is
  partitioned `localStorage`; not needed for `imbue-ai` but possible for others.
- **Content script not reaching the iframe** → the iframe needs
  `sandbox="allow-same-origin allow-scripts"` (it has it); without `allow-same-origin`
  the iframe is opaque-origin and content scripts won't match.

## Files

- `index.html` — "Slacktop" desktop UI (iframe window + log window + widget window).
- `server.py` — static server + `POST /__log__` → `ext.log`.
- `ff-ext/manifest.json` — MV2 extension (v1.3).
- `ff-ext/background.js` — header stripping + cookie imbuing + reporting + badge.
- `ff-ext/content.js` — inside-slack bridge: cmd handling + click observer.
- `ext.log` — live event log (gitignored). `ext.log.sample` is the redacted sample.
