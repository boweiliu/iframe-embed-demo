# iframe-embed-demo

Reference material for embedding third-party web apps inside a local, developer-controlled
browser shell, for the "use my work apps inside Studio" line of work.

Two session write-ups, each self-contained in its own directory:

- **`457-iframe-slack/`** — a localhost page that renders Slack inside an iframe, made to
  work by a Firefox *temporary* dev extension you load yourself. The extension relaxes the
  framing headers the browser would otherwise honor, attaches your own first-party cookies to
  the iframe's requests (so you stay logged in), and bridges the DOM both ways over
  `postMessage` + a content script (read the iframe, write into it, observe clicks). Includes a
  small "desktop of windows" UI and an on-disk event log. See `457-iframe-slack/SUMMARY.md`.

- **`472-multi-iframe/`** — generalizes 457 to two panes at once (Slack / WhatsApp Web /
  muse.ai), a config-driven extension (`ff-ext/sites.js`), a chat-relay bus between the panes
  and a local `pi` CLI agent (`bridge/`), and self-reload tooling. WhatsApp got past the
  error page and storage-access grant but stalled on Firefox's partitioned IndexedDB; details
  and the honest "where it stalled" in `472-multi-iframe/SESSION-SUMMARY.md` and `RESUME.md`.

## Scope and intent

This is **personal dev tooling**: your own browser, your own logged-in sessions, loaded as an
unsigned temporary add-on for local development. It is not a hosted product and does not touch
anyone else's account. Live event logs (`ext.log`) are gitignored because they can contain
your own session cookies; only a redacted `ext.log.sample` is checked in.

## Companion repo

`https://github.com/boweiliu/electron-webext` — the other approach: driving the real Slack
desktop (Electron) app over CDP to inject the same kind of widgets, used at session 687.

## Running

Each directory has a `STARTUP.md` with the exact steps (serve the page, load the temporary
add-on in Firefox via `about:debugging`, sign in to each site once, open localhost).
