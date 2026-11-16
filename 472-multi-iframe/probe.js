// Diagnostics probe injected into each iframed site's PAGE main world by the
// content-script `inject` command. Lives here (served by server.py at
// /probe.js) so it can be iterated WITHOUT reloading the extension — edit this
// file, run ./build.sh, the page auto-reloads and re-injects.
//
// Runs in the page world (not the content-script isolated world), so it CAN
// see the page's console and uncaught errors. Posts {event:'diag'} up to the
// parent (localhost:8765). The content script is the one that injects this;
// CSP must allow inline scripts — the extension strips script-src for
// whatsapp/muse and Slack's CSP already allows it.
(function () {
  if (window.__agenttopDiag) return; // only once per frame
  window.__agenttopDiag = true;
  const SITE = window.__agenttopSite || location.hostname;
  // Direct CORS beacon to the dev server: proves the probe EXECUTED at all
  // (independent of postMessage). server.py sets ACAO:*.
  try { fetch("http://localhost:8765/__log__", { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ kind: "beacon", site: SITE, href: location.href, isFramed: window !== window.top }) }); } catch (e) {}
  const send = (kind, data) => {
    try { window.parent.postMessage({ from: "agenttop-cs", event: "diag", site: SITE, kind: kind, data: data, ts: Date.now() }, "*"); } catch (e) {}
  };
  const safe = (a) => {
    try {
      if (a == null) return String(a);
      if (typeof a === "string") return a.slice(0, 500);
      if (a instanceof Error) return (a.stack || a.message || String(a)).slice(0, 500);
      return JSON.stringify(a).slice(0, 500);
    } catch (e) { return String(a).slice(0, 500); }
  };
  // frame state — the thing we most want to know for whatsapp
  try {
    send("frame", {
      href: location.href, isFramed: window !== window.top,
      topIsSelf: window.top === window.self, parentIsSelf: window.parent === window.self,
      outerHeight: window.outerHeight, opener: !!window.opener,
    });
  } catch (e) { send("frame", { error: String(e) }); }
  // uncaught errors + rejections
  window.addEventListener("error", (e) => send("error", { msg: e.message, src: (e.filename || "") + ":" + (e.lineno || 0) + ":" + (e.colno || 0), stack: (e.error && e.error.stack) || "" }), true);
  window.addEventListener("unhandledrejection", (e) => send("rejection", { reason: safe(e.reason) }), true);
  // console capture (page world)
  ["log", "warn", "error", "info", "debug"].forEach((fn) => {
    const orig = console[fn] ? console[fn].bind(console) : null;
    if (!orig) return;
    console[fn] = function () {
      try { send("console", { level: fn, args: Array.prototype.slice.call(arguments).map(safe).slice(0, 6) }); } catch (e) {}
      return orig.apply(null, arguments);
    };
  });
  // report what the page rendered (the "something went wrong" text) at a few
  // points so we catch fast-bail and slow-render cases.
  const snapshot = () => {
    try {
      send("loaded", {
        href: location.href, title: document.title,
        bodyText: (document.body && document.body.innerText || "").slice(0, 800),
        isFramed: window !== window.top,
      });
    } catch (e) {}
  };
  if (document.readyState === "complete") { snapshot(); setTimeout(snapshot, 1500); setTimeout(snapshot, 4000); }
  else window.addEventListener("load", () => { snapshot(); setTimeout(snapshot, 1500); setTimeout(snapshot, 4000); });
})();
