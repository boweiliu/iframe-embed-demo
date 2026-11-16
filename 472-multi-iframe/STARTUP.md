> ⚠️ Read RESUME.md first for current status (WhatsApp deep-dive, self-reload, Slack breakage).

# Agenttop — startup cheat sheet

Two iframes at once (Slack / WhatsApp Web / muse.ai) on localhost, via a
Firefox dev extension that strips framing headers and imbues your real
first-party cookies. A relay console routes chat text between the two
iframed agents, a desktop `pi` coding agent, and you.

## One-time setup

1. Use Firefox (MV2 dev extension). Chrome won't load a temporary add-on.
2. **Log into each site normally** in this Firefox profile once — Slack,
   WhatsApp Web, muse.ai. This seeds the cookies the extension copies into the
   iframes. (Slack workspace used last: `imbue-ai.slack.com`.)
3. Bridge deps:
   ```bash
   cd /Users/bowei/code/bowei-thoughts/working-sessions/472-more-iframe-demo/bridge
   npm install
   ```
4. Make sure `pi` is on your PATH and configured (`pi --version`; a provider
   selected via `pi` interactive once, or `--provider`/`--model` flags). The
   bridge runs `pi --mode rpc --no-session`.

## Run (each session)

Three terminals:

```bash
# 1) static + log server
cd /Users/bowei/code/bowei-thoughts/working-sessions/472-more-iframe-demo
python3 server.py            # http://localhost:8765

# 2) desktop-agent bridge (WebSocket -> pi --mode rpc)
cd /Users/bowei/code/bowei-thoughts/working-sessions/472-more-iframe-demo/bridge
node bridge.js               # ws://127.0.0.1:8770
#   env overrides: PI_BIN, PI_ARGS, PORT, PI_CWD
```

In Firefox:
1. `about:debugging` → "This Firefox" → "Load Temporary Add-on" → pick
   `ff-ext/manifest.json`. (Temporary add-ons unload when Firefox quits.)
2. Open `http://localhost:8765/index.html`.
3. Each pane has a site dropdown + Load. Pick sites, click Load. If the iframe
   is **not blank** → framing bypass + cookie imbuing both succeeded for that
   site.
4. Watch the relay console (bottom-right). New chat messages observed inside
   either iframe are relayed per the routing matrix. The bridge status pill
   (bottom-left) shows the `pi` connection.

## Verify it's working

- **Iframe not blank** → bypass + imbue OK for that site.
- **Ping / Probe / GetChat** buttons on a pane reach into that iframe and
  print results in the relay log.
- **Bridge pill green** → page is connected to the WS bridge, which owns a
  `pi --mode rpc` process. Try the manual send box with destination `→ pi`
  and watch the streamed reply appear as `[pi] …` in the relay log.
- `ext.log` grows with `imbue`/`relax` events (one per tracked-site request):
  `tail -f ext.log` (gitignored — contains live cookies/tokens, don't commit).

## If it breaks

- **Iframe blank / stuck on signin** → you skipped the normal login in this
  profile for that site. Log in normally first, then reopen localhost.
- **WhatsApp Web blank even after login** → likely a JS-level framing guard on
  top of the headers we already strip. Next step: inspect the WhatsApp iframe
  console for the self-frame check and patch it in `content.js`.
- **muse.ai blank** → unknown framing posture; check its console.
- **GetChat/sendChat return "composer not found"** → selectors drifted. Click
  **Probe** on that pane; it dumps candidate composer + button elements. Fix
  `ff-ext/sites.js` `chat.inputSel` / `sendBtnSel` / `msgSel` and reload the
  add-on.
- **Bridge pill red / "bridge not connected"** → `bridge.js` isn't running, or
  `pi` isn't on PATH / not configured. Check `bridge.out`. The page auto-retries
  every 2s.
- **pi reply never streams** → `pi --mode rpc` may be waiting on a provider
  key. Run `pi` interactively once to configure a provider, or pass
  `PI_ARGS="--mode rpc --no-session --provider <name> --model <id>"`.
- **Content script not reaching an iframe** → the iframe needs
  `sandbox="allow-same-origin allow-scripts"` (it has it); without
  `allow-same-origin` the iframe is opaque-origin and content scripts won't
  match.

## Cleanup

```bash
pkill -f "server.py"
pkill -f "bridge.js"
# the bridge also leaves a `pi --mode rpc` child; killing bridge.js kills it.
```

## Files

- `index.html` — Agenttop UI (two iframe panes + relay console).
- `server.py` — static server + `POST /__log__` → `ext.log`.
- `ff-ext/manifest.json` — MV2 extension (v2.0).
- `ff-ext/sites.js` — per-site config (cookie domain, host test, chat selectors).
- `ff-ext/background.js` — header stripping + cookie imbuing + reporting.
- `ff-ext/content.js` — inside-site bridge + click observer + chat watcher.
- `bridge/bridge.js` — WS server → `pi --mode rpc` child process.
- `bridge/package.json` — `ws` dependency.
- `ext.log` — live event log (gitignored).
