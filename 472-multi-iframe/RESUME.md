# RESUME — 472-more-iframe-demo (read this first next session)

> Continuation of `../457-iframe-slack`. Goal (from `instr`): iframe
> **WhatsApp Web + muse.ai** (same framing-bypass + cookie-imbuing as Slack),
> run **two iframes at once**, and relay chat text between them, a desktop
> `pi` CLI agent, and you. This doc is the honest status so we don't re-derive.

## TL;DR — where things stand (end of day 1)

- **Slack iframe**: ✅ works fully (full UI, cookies imbued, diag probe captures console).
- **pi bridge** (`bridge/bridge.js` → `pi --mode rpc`): ✅ works end-to-end (verified earlier; streamed replies).
- **Page auto-reload** + **extension self-reload** (`browser.runtime.reload()` polling `build.json`): ✅ works. **I can iterate both page and ext without a human reloading.** Loop: edit files → `./build.sh` → page auto-reloads + ext self-reloads → I read `ext.log`.
- **WhatsApp iframe**: got **far**, then hit a wall. Past: error page → QR login → splash screen. Current wall: **storage partitioning + `navigator.storage.persist()` denied**. App stuck on splash. See "WhatsApp deep-dive" below.
- **muse.ai**: NOT yet tested with the new treatment (whole-CSP-drop + sec-fetch). It's in the same `shouldStripScriptCsp` set, so it gets the same header treatment; just needs a live test.
- **Slack intermittent breakage**: reload-correlated but probabilistic (see "Slack breakage" below). Not yet isolated.

## The architecture (what's built)

```
472-more-iframe-demo/
  index.html          "Agenttop" — 2 iframe panes (site dropdowns) + relay console + bridge WS client
                     + watchBuild (polls /build.json, auto-reloads page on hash change)
  server.py           static on :8765 + POST /__log__ -> ext.log
  ff-ext/
    manifest.json     MV2; name shows [build:HASH]; content_scripts run_at document_start
    background.js      header strip (XFO + whole-CSP for whatsapp/muse) + cookie imbue
                       + Sec-Fetch-Dest:document override (whatsapp) + ext self-reload poller
    content.js         per-site bridge (ping/snapshot/probe/getChat/sendChat) + click observer
                       + chat watcher + INLINE diag probe (document_start) + SW-neuter (whatsapp)
                       + requestStorageAccess (whatsapp) + csBeacon diagnostics
  bridge/
    bridge.js          WS on :8770 -> spawns `pi --mode rpc`; forwards prompt/events
    package.json       (ws dep; npm installed)
  build.sh             stamps build hash into manifest/background/content/index + writes
                       build.json with `hash` AND `extHash` (sha of ext files)
  probe.js             (LEGACY — no longer used; probe is inlined in content.js. kept as ref.)
  build.json           {hash, builtAt, extHash, files}  (page + ext poll this)
  ext.log              live event log (gitignored; contains cookies/tokens — don't commit)
  INDEX.md / STARTUP.md  original docs (pre-whatsapp-deep-dive; still mostly accurate)
```

### The self-iteration loop (important — this is how I iterate without you)
- `build.sh` writes `build.json` with `hash` (page build) + `extHash` (sha of ext files).
- **Page** (`index.html` `watchBuild`): polls `/build.json` every 1.5s; on `hash` change → `location.reload()`.
- **Extension** (`background.js` `watchExtReload`): polls `/build.json` every 2s; on `extHash` change → `browser.runtime.reload()` (self-reload, no about:debugging needed).
- So: page-only edits (index.html) → page reloads, ext unchanged → no ext reload. Ext edits → ext self-reloads + page reloads.
- **Caveat**: this caused 19 page reloads + 11 ext reloads today, which destabilized Slack (see below). Next session, consider pausing the pollers during active debugging, or only building when ready to test.

## WhatsApp deep-dive (the layered defenses + what worked)

Each layer we defeated, in order:
1. **`X-Frame-Options: DENY`** → stripped in `cleanHeaders` (easy; same as Slack).
2. **CSP `script-src 'self' 'nonce-…'`** → had to **drop the ENTIRE CSP header** for whatsapp/muse (`shouldStripScriptCsp` → `cleanHeaders` returns null for CSP). Removing only `script-src` fell back to `default-src 'self'`, which STILL blocked our nonce-less inline probe. **This was a non-obvious gotcha.**
3. **Server-side "Sorry, something went wrong" error page** → caused by `Sec-Fetch-Dest: iframe`. Fixed by overriding in `onBeforeSendHeaders` for whatsapp: `Sec-Fetch-Dest: document`, `Sec-Fetch-Mode: navigate`, `Sec-Fetch-Site: none`, `Sec-Fetch-User: ?1`. After this, the server served the real app (QR login screen).
4. **Cookies** → imbued (only 3 cookies for whatsapp — session isn't in cookies; see #6).
5. **Service worker** → `sw-regs n: 0` (no SW registered in this profile). The SW-neuter code (`content.js`, whatsapp-only: unregister + `navigator.serviceWorker.register` override) is still in place but turned out NOT to be the blocker. Keep it (harmless, whatsapp-only).
6. **Storage partitioning (the current wall)**: WhatsApp multi-device stores session keys in **IndexedDB**, partitioned by top-level origin. Iframe top-level is `localhost:8765`, so it gets an **empty partition** → QR login (no session).
   - Tried **`document.requestStorageAccess()`** in the probe → **granted** (after adding `allow-storage-access-by-user-activation` to the iframe sandbox, then a click for the gesture; after first grant it auto-grants on load).
   - BUT now the app is **stuck on the splash screen** ("WhatsApp / End-to-end encrypted") with `navigator.storage.persist()` **denied (138×)** ("aquire-persistent-storage-denied"). Either `requestStorageAccess` didn't fully unpartition IndexedDB, or the app can't init without persistent storage.

### WhatsApp — open decision (pick one next session)
- **A. Global Firefox pref** (zero-click, most likely to work): `about:config` → `network.cookie.cookieBehavior` = `0` or `4` (disable storage partitioning) so the iframe uses the first-party `web.whatsapp.com` storage directly. Possibly also persist-permission prefs. Global, but dev machine. **Recommended to try first.**
- **B. Scope relay to Slack + muse + pi**; drive WhatsApp via API (Baileys) if needed. We already have working Slack + pi bridge + relay console.
- **C. Keep digging**: call `navigator.storage.persist()` from the probe with a gesture; or port the IDB (duplicate-device risk — WhatsApp may invalidate). Diminishing odds.

### WhatsApp — prior art (confirmed)
- **WAToolkit (2015, github.com/cprcrack/WAToolkit)** iframed web.whatsapp.com via X-Frame-Options strip + `?watRnd=` cache-buster. Worked THEN (no SW, weak CSP). Cache-buster was for old Application Cache, NOT a service worker.
- All modern "embed WhatsApp Web" projects (Electron `altus`, Qt `qtsapp`, GTK `Chawa`, Android `wa4tablets`) load it as a **top-level page in a webview**, not a cross-origin iframe — because of the CSP+SW+storage walls.
- No recent (2023+) project found that iframes web.whatsapp.com cross-origin successfully.

## Slack breakage (intermittent) — evidence + hypothesis

**Hard evidence** (from `ext.log` slack `loaded` diag + reload beacons):
- Slack goes "trouble loading your workspace" **within seconds of an ext-reload/page-boot**, but **not every time** (survived the 22:47 reload; broke at 22:45 and 22:49 and stayed bad).
- Today's churn: **19 page reloads + 11 ext-reloads**. Correlation with breakage is clear; causation is probabilistic/compounding.

**Hypotheses** (not isolated):
1. Reload churn drops Slack's WebSocket; Slack can't reconnect fast enough → "trouble loading." (Likely primary.)
2. The diag probe wraps Slack's `console.*` in the page world + adds error/rejection listeners — could interfere with Slack's app. (Possible secondary; the probe runs in Slack too.)
3. Cookie-imbue churn on each ext-reload (re-imbues 26 cookies) might trip Slack's session protection. (Possible.)

**To isolate next session**: pause `watchBuild` + `watchExtReload` (or stop running `build.sh` repeatedly), load Slack once, and observe if it stays stable for 5+ min. If stable → it's churn. If it still breaks → investigate the probe's console-wrapping in Slack (try disabling the probe for Slack).

## How to relaunch (next session)

```bash
cd /Users/bowei/code/bowei-thoughts/working-sessions/472-more-iframe-demo
python3 server.py                         # :8765
cd bridge && node bridge.js &              # :8770 -> pi --mode rpc
# Firefox: about:debugging -> Load Temporary Add-on -> ff-ext/manifest.json
#          (or, if the self-reload build is still loaded, it'll self-reload on build)
# Open http://localhost:8765/index.html
# Log into Slack + WhatsApp normally once (seeds cookies), then Load panes.
```

The running extension's build hash is in `about:debugging` (name prefix `[build:…]`) and confirmed via `ext.log` `kind:"loaded"` self-ping. The page build is on the bottom-left badge + `kind:"page"` beacon.

## Known gotchas
- **Don't remove just `script-src`** from CSP — falls back to `default-src 'self'`, still blocks inline. Drop the whole CSP header (whatsapp/muse) or replace script-src with `'unsafe-inline'`.
- **`Sec-Fetch-Dest: iframe`** makes WhatsApp's server return the error page. Override to `document`.
- **`requestStorageAccess()`** needs (a) `allow-storage-access-by-user-activation` in the iframe sandbox, and (b) a user gesture for the first call; after that it auto-grants. (We removed the sandbox entirely later — re-check whether that's needed for the storage-access token.)
- **WhatsApp `?watRnd=` cache-buster** (`bustCache` in index.html) — kept; harmless now (we're past the error page). IndexedDB is per-origin, not per-URL.
- **`ext.log` contains live cookies/tokens** — gitignored, don't commit.
- **Slack + the probe**: the probe wraps console in Slack's page world. If Slack misbehaves, suspect this.

## Next-session checklist
1. Relaunch (above). Confirm Slack works + ext self-reload still works (stamp a build, watch for `ext-reload` + new `loaded` ping).
2. **Decide WhatsApp path (A/B/C above)** — recommend trying A (global pref) first.
3. **Isolate Slack breakage** — pause the auto-reloaders, load Slack once, observe 5 min.
4. **Test muse.ai** with the current treatment (whole-CSP-drop + sec-fetch are already enabled for muse via `shouldStripScriptCsp`). Just load muse in a pane and read the `loaded`/`console` diag.
5. Once two panes work, return to the actual goal: the **chat relay** (muse ↔ whatsapp/slack ↔ pi ↔ you) — the relay console + routing matrix in `index.html` is built but untested end-to-end with real chat.

## Build hashes (last this session)
- Last disk build: see `build.json` (`hash` + `extHash`).
- Last confirmed-running ext: `build:20260925-054903-fe14` (from `ext.log` loaded ping) — but the tab was closed at end of session; reload next time.
