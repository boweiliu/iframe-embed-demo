# SESSION-SUMMARY — 472-more-iframe-demo (multi-iframe agent relay)

> Continuation of `../457-iframe-slack`. See also `RESUME.md` (the resume/continuation
> doc, written at the end of this session with the deep technical state).

## 1. Original Ask & Evolution

**Starting ask** (`instr`): extend the 457 Slack-in-an-iframe work to (1) also embed
`web.whatsapp.com` and `muse.ai` (same framing-bypass + cookie-imbuing), (2) run
**two iframes at once** and relay bidirectional chat between them, a desktop CLI
agent (`pi-coding-agent`), and the operator, and (1.5) get a web extension to talk
to a desktop CLI agent like pi.

**How it evolved:** the "embed WhatsApp" sub-goal turned into a multi-layer
reverse-engineering deep-dive that consumed most of the session. The relay/bus
architecture was built but never exercised end-to-end with real chat, because we
got stuck (and ultimately paused) on WhatsApp's layered framing/storage defenses.
A second, un-asked goal emerged mid-session: **make iteration autonomous** (auto
page-reload + extension self-reload) because the operator was the bottleneck
manually reloading the extension each change.

## 2. Questions Asked & Answered

- **"i hit reload on the ext, did it work?"** → debugging via `ext.log` + the
  background's "loaded" self-ping beacon. Discovery: the *old 457 server* was
  still bound to `:8765`, serving the stale Slacktop page. Method: `lsof -nP -i`,
  `curl` the served `<title>`, `ps` the PID's cwd.
- **"is there prior art online for whatsapp iframe?"** → GitHub + web search.
  Found `cprcrack/WAToolkit` (2015): iframed web.whatsapp.com via X-Frame-Options
  strip + `?watRnd=` cache-buster (for old Application Cache, not a service
  worker). All modern "embed WhatsApp Web" projects use a top-level webview, not
  a cross-origin iframe. Method: `gh api search/code`, `gh api search/repositories`,
  curl'd web.whatsapp.com headers/HTML.
- **"could our web ext edit the code the service worker runs? don't we control
  the browser code e2e?"** → yes, via `webRequest` + `filterResponseData`, but the
  cleaner move is neutering (unregister + block re-register). Turned out there
  was NO SW registered (`sw-regs n:0`) — red herring.
- **"you're sure you cant hot reload your own extensions?"** → yes you can:
  `browser.runtime.reload()` self-reload, polled via `build.json` `extHash`.
  Answered by implementing it and verifying.
- **"can't we just manually port over the indexeddb one-off?"** → mechanically
  possible but likely breaks auth (WhatsApp multi-device uses per-device Signal
  keys; copying = duplicate device identity → server invalidates). Recommended
  Storage Access API instead.
- **"why does the slack also break sometimes" (operator doubted it was reload
  churn)** → hard evidence from `ext.log`: Slack breaks within seconds of an
  ext-reload/page-boot but not every time (probabilistic/compounding). Could not
  rule out a secondary cause (probe wraps Slack's console). Method: timestamped
  `loaded` diag vs reload beacons.

## 3. Thought Process & What I Did (chronological as observed)

1. **Read 457 + pi rpc.md.** Built the generalized system: `sites.js`
   (config-driven), `background.js` (header strip + cookie imbue for 3 sites),
   `content.js` (per-site bridge + chat watcher), dual-iframe `index.html` with a
   relay console + routing matrix, `bridge/bridge.js` (WS → `pi --mode rpc`),
   `server.py`, docs.
2. **Verified the bridge** with a fake-pi script and the real `pi --mode rpc`
   (`get_state` returned the configured Kimi K2.6 model). ✅
3. **Debugging "did the reload work"** → found stale 457 server on `:8765`;
   killed it, started 472 server (hit `EADDRINUSE` TIME_WAIT → added
   `allow_reuse_address=True`).
4. **Build hashes** → wrote `build.sh` stamping a `build:<hash>` into manifest
   name/title + background + content + page; wrote `build.json`. Operator asked
   to put the hash **first** in the name (about:debugging truncates the end).
5. **WhatsApp "something went wrong"** → built a diagnostics probe (inline
   `<script>` injected at `document_start`) capturing console/errors/rejections
   + frame state, piped to the relay log + `ext.log` via `/__log__`.
6. **Probe worked for Slack (468 console lines), 0 for WhatsApp** → diagnosed
   CSP `script-src 'nonce-…'` blocking the nonce-less probe. Added `script-src`
   strip for whatsapp/muse. Still `ran:false`.
7. **Operator: "remember to check logs and hashes to confirm yes/no"** →
   verified the running ext was still on an older build; my fix was staged but
   not loaded. (Key discipline moment.)
8. **Auto-iteration** → built page `watchBuild` (polls `/build.json`, auto
   `location.reload()` on hash change). Tried moving the probe to a served
   `probe.js` + an `inject` command (to iterate the probe without ext reload).
   Hit a `DataCloneError: Promise object could not be cloned` — I'd written
   `PROBE_CODE = (await fetch(...)).text();` (forgot to await `.text()`), so
   `PROBE_CODE` was a Promise. Fixed.
9. **Inject `ran:false`** → discovered the probe `<script>` appended after
   `load` is CSP-blocked, but the *inline document_start* probe ran for Slack.
   Restored the inline document_start probe. Then the key gotcha: **removing
   only `script-src` falls back to `default-src 'self'`, which still blocks
   inline**. Dropped the **entire** CSP header for whatsapp/muse → `ran:true`,
   WhatsApp diag captured.
10. **WhatsApp error page** → server returned a static "Sorry, something went
    wrong" page. Cause: `Sec-Fetch-Dest: iframe`. Overrode to `document` +
    `Sec-Fetch-Mode: navigate` + `Sec-Fetch-Site: none` → server served the real
    app → **QR login screen**.
11. **QR not logged-in** → WhatsApp session is in **IndexedDB**, not cookies;
    Firefox storage partitioning gives the iframe (top-level `localhost`) an
    empty partition. Tried `document.requestStorageAccess()`.
12. **`requestStorageAccess` NotAllowedError** → iframe `sandbox` was missing
    `allow-storage-access-by-user-activation`; added it → still needed a user
    gesture for the first grant → added a click-retry → **granted**. But then
    app stuck on splash screen with `navigator.storage.persist()` denied 138×.
13. **Slack broke** → the probe's `navigator.serviceWorker.register` override
    was global (broke Slack's SW registration). Restricted to whatsapp-only →
    Slack recovered. Later Slack broke again intermittently (reload churn).
14. **Paused.** Wrote `RESUME.md`. Operator closed the WhatsApp tab (crash-loop
    / rate-limit risk).

## 4. Results Observed

| Component | Status |
|---|---|
| Slack iframe embed | ✅ full UI (cookies imbued, probe captures console) |
| pi bridge (`pi --mode rpc` over WS) | ✅ verified with real pi + fake-pi |
| Page auto-reload (`watchBuild`) | ✅ reloads on `build.json` hash change |
| Extension self-reload (`browser.runtime.reload`) | ✅ reloads on `extHash` change; verified (ext-reload beacon + new loaded ping) |
| Build-hash labeling | ✅ `[build:HASH]` leads the about:debugging name + page badge |
| WhatsApp: past error page | ✅ via Sec-Fetch-Dest override + whole-CSP drop |
| WhatsApp: probe runs | ✅ `ran:true` after whole-CSP drop |
| WhatsApp: logged in | ❌ stuck on splash; `requestStorageAccess` granted but `persist()` denied; IndexedDB partitioning not fully defeated |
| muse.ai | ⏳ not tested with new treatment (it's in the same `shouldStripScriptCsp` set) |
| Chat relay end-to-end | ⏳ built (routing matrix + relay console), not exercised with real chat |

**WhatsApp defense layers defeated, in order:** X-Frame-Options → (whole) CSP →
Sec-Fetch-Dest → cookies → (no SW) → storage partitioning (partial: access
granted, persist denied).

## 5. Hiccups

- **Stale 457 server on `:8765`** masquerading as the 472 page → wasted a chunk of
  early debugging. Fix: `lsof` + kill + `SO_REUSEADDR`.
- **`DataCloneError: Promise object could not be cloned`** — `PROBE_CODE` was a
  Promise because `(await fetch()).text()` wasn't awaited. One-char fix.
- **Removing only `script-src` doesn't allow inline** — falls back to
  `default-src 'self'`. Must drop the whole CSP header (or use `'unsafe-inline'`).
  Non-obvious; cost several iterations.
- **`navigator.serviceWorker.register` override was global** → broke Slack's SW
  registration → "trouble loading your workspace." Restricted to whatsapp-only.
- **`requestStorageAccess` needs the `allow-storage-access-by-user-activation`
  sandbox token + a first gesture** — both required.
- **Operator reminder "check logs and hashes to confirm yes/no"** — caught me
  assuming a fix was live when the running ext was an older build. Changed my
  approach to always verify via `ext.log` beacons + build hashes.
- **Reload churn destabilized Slack** — 19 page reloads + 11 ext self-reloads.
  Slack is WebSocket-session-sensitive.

## 6. What's Next

1. **Decide WhatsApp path**: (A) global Firefox pref `network.cookie.cookieBehavior=0/4`
   to disable storage partitioning (zero-click, most likely to work); (B) scope
   relay to Slack + muse + pi, drive WhatsApp via Baileys API; (C) keep digging
   (`persist()` with gesture, or IDB port with duplicate-device risk). Recommend A.
2. **Isolate Slack breakage**: pause `watchBuild` + `watchExtReload`, load Slack
   once, observe 5 min. If stable → churn. If not → suspect the probe's
   console-wrapping in Slack (disable probe for Slack).
3. **Test muse.ai** with the current treatment (whole-CSP-drop + sec-fetch
   already enabled for it via `shouldStripScriptCsp`).
4. **Exercise the chat relay** end-to-end (muse ↔ slack/whatsapp ↔ pi ↔ you)
   once two panes work — the routing matrix + relay console are built but untested.
5. Consider **pausing the auto-reloaders during active debugging** to avoid churn;
   only build when ready to test.

## 7. Reflections & Gut Feelings

- We got **further than the prior art** on WhatsApp-in-iframe (past the error page,
  storage access granted) — real progress — but hit a genuine Firefox
  3rd-party-storage wall that an extension can't cleanly bypass. The honest read:
  WhatsApp-in-a-cross-origin-iframe is fighting the platform; the established
  path is a top-level webview. The operator's instinct ("surely others have done
  this?") was right to question — and the answer was "yes, in 2015, before
  CSP+SW+storage-partitioning hardening; not since."
- The biggest unlock of the session was **ext self-reload** — once the operator
  was out of the loop, iteration speed doubled and morale improved. Worth
  building early in any extension-dev session.
- The operator's "check logs and hashes" reminder was the single most useful
  course-correction; it changed me from assuming to verifying.

## 8. Future Improvements (TODO)

- **TODO: use `filterResponseData` (Firefox) to rewrite the SW script body**
  instead of unregister, if we ever need to neuter a SW that's already
  installed/cached (more robust than unregister). Investigate.
- **TODO: investigate the Storage Access API + `persist()` interaction** — does
  `requestStorageAccess` actually unpartition IndexedDB in this Firefox
  version, or only cookies/localStorage? If only the latter, the IDB port (or
  global pref) is unavoidable. Worth a focused test.
- **TODO: a `web-ext run`-based hot-reload** was rejected (fresh profile = no
  cookies). But `web-ext run --firefox-profile <real> --keep-profile-changes`
  might work if the real Firefox isn't running — investigate for a cleaner
  dev loop than `browser.runtime.reload()` (which re-runs the whole background).
- **TODO: move the probe back to a served `probe.js`** once CSP is reliably
  dropped, so the probe can be iterated without ext reload (the original
  self-iteration goal for the probe). Blocked on CSP-at-document_start being
  reliably relaxed (the after-load inject path is CSP-blocked).
- **TODO: reduce reload churn** — only auto-reload the page when an ext change
  happened (page-only changes could hot-swap via re-inject instead of full
  reload). Would help Slack stability.

## 9. Docs / scripts / meta written this session

- `RESUME.md` — the resume/continuation doc (deep technical state, WhatsApp
  defense layers, Slack breakage evidence, next-session checklist). **Read first next session.**
- `INDEX.md` — discoverability doc (keywords); patched to point at RESUME.md.
- `STARTUP.md` — relaunch cheat sheet; patched to point at RESUME.md.
- `SESSION-SUMMARY.md` — this file.
- `build.sh` — build-hash stamper (writes `build.json` with `hash` + `extHash`).
- `probe.js` — legacy (probe is now inlined in `content.js`); kept as reference.
- (All committed in this session's commit; no secrets — `ext.log`/`node_modules`
  excluded via `.gitignore`.)

## 10. Long-running servers / processes

- `python3 server.py` — static + `/__log__` on `127.0.0.1:8765`. **Left running.**
  Restart: `cd working-sessions/472-more-iframe-demo && python3 server.py`.
- `node bridge/bridge.js` — WS on `127.0.0.1:8770` → spawns `pi --mode rpc`.
  **Left running.** Restart: `cd bridge && node bridge.js` (needs `npm install`
  once for `ws`). Killing bridge.js also kills its `pi` child.
- A `logserver.py` (PID 5622) was running but is **not ours** (another session) —
  left alone.
- The Firefox WhatsApp tab was **closed by the operator** at end of session
  (crash-loop / rate-limit risk). Next session: reopen + reload the extension
  (or rely on ext self-reload once a build is stamped).

## 11. Code / commit / push provenance

- **Working dir**: `/Users/bowei/code/bowei-thoughts/working-sessions/472-more-iframe-demo`
  (the repo root is `/Users/bowei/code/bowei-thoughts`, on branch `main`).
- **Files written this session**: `index.html`, `server.py`, `ff-ext/{manifest.json,
  background.js, content.js, sites.js}`, `bridge/{bridge.js, package.json,
  package-lock.json}`, `build.sh`, `probe.js`, `build.json`, `.gitignore`,
  `INDEX.md`, `STARTUP.md`, `RESUME.md`, `SESSION-SUMMARY.md`.
- **Commit**: this session's commit is on local `main` (see `git log` for the
  `472:` commit). Local `main` was 3 commits ahead of `boweiliu/main` before this
  commit, 0 behind (clean fast-forward).
- **Push**: to `boweiliu/main` (=`origin/main`) on
  `https://github.com/boweiliu/bowei-thoughts` (GitHub). No PR/MR (direct to main,
  per repo convention seen in 473/474 commits).

## 12. Operator style

- **Hands-on but impatient with manual repetition** — quickly frustrated by being
  the reload bottleneck ("i feel like i'm the main blocker to progress here"),
  which productively pushed us to build self-reload. Cares about **removing
  themselves from the loop**.
- **Skeptical and evidence-demanding** — "i dont believe its reload churn but
  maybe you have hard evidence???" forced me to actually timestamp-correlate
  instead of hand-waving. Good instinct; improved the work.
- **Pragmatic about scope** — willing to pause and write docs rather than
  rabbit-hole ("let's pause here for today"). Closes tabs to avoid rate-limiting
  (operational awareness).
- **Zooms out at the right time** — "why is whatsapp so hard to embed, surely
  other ppl have done this?" reframed a debugging grind into a prior-art search,
  which correctly calibrated expectations.
- **Decisive** — picks a path and says "yes autogrant is exactly what i want"
  rather than deliberating endlessly.

## 13. High-level goals (my side)

The operator's real goal is a **local "agent desktop"** where multiple agent
surfaces (Slack, WhatsApp/instinct, muse.ai, a desktop `pi` CLI agent, and the
operator) are all iframed into one localhost shell and can **exchange chat text
through a relay bus** — so an agent in muse can talk to an agent in WhatsApp, or
to pi, or to the operator. The iframe-bypass + cookie-imbuing is the
plumbing; the relay bus is the product. This session got the plumbing working
for Slack + pi and most of the way for WhatsApp, but the WhatsApp storage wall
paused us before the relay could be exercised end-to-end. The self-reload
tooling was an unscheduled but high-leverage investment.

## 14. Earlier session-summary docs

- `../457-iframe-slack/SUMMARY.md`, `PROGRESS.md`, `PROGRESS-v2.md`,
  `INDEX.md`, `STARTUP.md` — the prior line of work this session extends.
- No earlier summary was requested *within* this 472 session; `RESUME.md` was
  written at the operator's request near the end (continuation doc), and this
  `SESSION-SUMMARY.md` is the formal session summary.

[agent:Boweis-MacBook-Pro.local/harness=pi/pi=A05DDC7E-8E01-4B51-8DD3-1ACE2B67E66F/unknown]
