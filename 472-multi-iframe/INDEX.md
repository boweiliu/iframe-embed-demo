> ⚠️ Read RESUME.md first for current status (WhatsApp deep-dive, self-reload, Slack breakage).

# Agenttop — multi-iframe agent relay (web extension + desktop CLI bridge)

> Continuation of `../457-iframe-slack` (Slack-in-an-iframe). This session
> generalizes it to **WhatsApp Web + muse.ai** (same framing-bypass + cookie
> imbuing), runs **two iframes at once**, and adds a **chat relay bus** that
> routes text between the two iframed agents, a desktop `pi` coding agent
> (via `pi --mode rpc`), and you.

## What this is

A localhost HTML page ("Agenttop") that embeds **two sites at once** in
iframes — Slack, WhatsApp Web, muse.ai — made to work by a **Firefox dev
extension** that:
- strips `X-Frame-Options` / CSP `frame-ancestors` (framing bypass), and
- copies your real first-party cookies for each site into the iframe requests
  (cookie imbuing), defeating Firefox third-party cookie partitioning, and
- bridges DOM read/write + **chat text** both ways (outside↔inside) via
  `postMessage` + content scripts.

A **relay console** window treats each iframed app as a "chat agent" source
and routes new messages to other destinations (the other iframe, the desktop
`pi` CLI agent, or just to you) via a configurable routing matrix.

A **Node WebSocket bridge** (`bridge/bridge.js`) connects the browser page to
a desktop `pi --mode rpc` coding agent running as a child process — so the
iframed apps / you can talk to a real local coding agent, and its streamed
replies come back into the relay. This is the answer to "can a web extension
talk to a desktop CLI agent like pi-coding-agent": yes, via pi's
**RPC mode** (JSONL over stdin/stdout, see `pi/packages/coding-agent/docs/rpc.md`),
fronted by a localhost WS server the page can reach.

## Directory layout

- `index.html` — the "Agenttop" desktop UI: two iframe panes + relay console.
- `server.py` — static server on `http://localhost:8765` + `POST /__log__` → `ext.log`.
- `ff-ext/manifest.json` — Firefox MV2 extension (v2.0).
- `ff-ext/sites.js` — shared per-site config (cookie domain, host test, chat DOM selectors).
- `ff-ext/background.js` — header stripping + cookie imbuing for slack/whatsapp/muse + reporting.
- `ff-ext/content.js` — inside-site bridge: cmd handling (ping/snapshot/probe/getChat/sendChat) + click observer + **chat watcher** (reports new messages up).
- `bridge/bridge.js` — Node WebSocket server on `ws://127.0.0.1:8770` that owns a `pi --mode rpc` child process and shuttles JSON between the page and the agent.
- `bridge/package.json` — `npm install` for the `ws` dependency.
- `ext.log` — live event log (gitignored; contains live cookies/tokens — don't commit).
- `INDEX.md` / `STARTUP.md` — this file / run-it cheat sheet.

## How to relaunch

See `STARTUP.md`. Short version:

```bash
cd /Users/bowei/code/bowei-thoughts/working-sessions/472-more-iframe-demo
python3 server.py                     # http://localhost:8765
cd bridge && npm install && node bridge.js   # ws://127.0.0.1:8770 -> pi
# Firefox → about:debugging → Load Temporary Add-on → ff-ext/manifest.json
# Log into Slack / WhatsApp / muse.ai normally once (seeds cookies), then
# open http://localhost:8765/index.html and Load each pane.
```

## What's verified vs. needs live testing

- ✅ **Extension plumbing** — generalized from the working 457 Slack bypass;
  same header-strip + cookie-imbue mechanism, now config-driven for 3 sites.
  Slack is known-good; WhatsApp/muse apply the identical mechanism.
- ✅ **Bridge to `pi --mode rpc`** — verified end-to-end: WS client → bridge →
  `pi --mode rpc` (real) → `get_state` returns configured model; and with a
  fake-pi that the text-delta streaming + `agent_settled` detection works.
- ⚠️ **WhatsApp Web in an iframe** — WhatsApp is famously hostile to framing
  (service workers, JS self-frame detection). The header/cookie bypass is
  necessary but may not be sufficient; expect to chase a JS-level framing
  guard next. Cookies for `web.whatsapp.com` live under `.whatsapp.com`.
- ⚠️ **muse.ai in an iframe** — framing posture unknown; same bypass applied.
- ⚠️ **Chat DOM selectors** for WhatsApp/muse are best-effort guesses. Run the
  **Probe** button on each pane (dumps candidate composer/button elements) and
  fix `ff-ext/sites.js` `chat.inputSel` / `sendBtnSel` / `msgSel` from what you
  see. The `sendChat` command uses `document.execCommand('insertText')` for
  contenteditable (most reliable for React apps) and a native setter for
  `<textarea>`/`<input>`, then Enter-key or button-click to send.
- ⚠️ **Chat watcher** reports the last message bubble's text on each DOM
  mutation; dedupes by exact text. Good enough for a demo; will fire on
  typing-indicator churn for some apps — tune `msgSel` to be specific.

## Routing model (relay console)

- Sources: `muse`, `whatsapp`, `slack`, `pi`. Destinations: same + `me`.
- A checkbox matrix sets, per source, which destinations a new message is
  forwarded to. Defaults: muse→{whatsapp, me}, whatsapp→{pi, me},
  slack→{me}, pi→{me, whatsapp}.
- Forwarding to an iframe = `sendChat` (types into that app's composer + sends).
- Forwarding to `pi` = a `prompt` to the desktop agent via the WS bridge.
- `me` = display only (always shown in the relay log).
- A 1.5s per-destination dedupe guards against feedback loops when two agents
  echo each other.
- Manual send box at the bottom: type text, pick a destination, Send.

## Bridge protocol (browser ↔ bridge, JSON over WS)

```
-> { to:"pi", type:"prompt", message:"..." }       forward a prompt to pi
-> { to:"pi", type:"abort" }                       abort current pi run
-> { to:"pi", type:"get_state" }                   query pi state
-> { to:"pi", type:"get_last_assistant_text" }     query last reply
-> { to:"pi", type:"new_session" }                 reset pi session
<- { from:"pi", kind:"event", event:{...} }        raw pi stdout event
<- { from:"pi", kind:"response", response:{...} } pi command response
<- { from:"pi", kind:"text", delta:"..." }        convenience: text_delta
<- { from:"pi", kind:"agent_settled" }             pi finished this run
<- { from:"pi", kind:"status", status:"..." }     bridge status
<- { from:"pi", kind:"stderr", text:"..." }       pi stderr (noisy)
```

Anything not addressed `to:"pi"` is ignored by the bridge — iframe↔iframe
relay happens entirely in the page via `postMessage`. The bridge is only the
path to the desktop CLI agent. Env: `PI_BIN` (default `pi`),
`PI_ARGS` (default `--mode rpc --no-session`), `PORT` (default `8770`),
`PI_CWD`.

## Search keywords (so this surfaces next time)

- whatsapp iframe, whatsapp web in iframe, embed whatsapp in iframe
- muse.ai iframe, muse in an iframe, embed muse.ai
- slack iframe, slack in an iframe (carried over from 457)
- multi-iframe, two iframes at once, dual iframe, agent relay, agent chat bus
- bidirectional agent chat, agents talking to each other
- web extension talk to desktop cli, browser to cli agent, pi rpc bridge
- pi --mode rpc, pi coding agent rpc, jsonl over stdin stdout
- cookie imbuing, third-party cookie partitioning, x-frame-options bypass,
  csp frame-ancestors bypass
- postMessage bridge, content script chat watcher, execCommand insertText

## Related

- `../457-iframe-slack` — the original Slack-in-an-iframe line this extends.
- `pi/packages/coding-agent/docs/rpc.md` — pi RPC mode protocol (the API the
  bridge speaks to the desktop agent).
