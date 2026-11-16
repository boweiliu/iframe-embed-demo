// Throwaway dev extension: allow Slack / WhatsApp Web / muse.ai to be iframed
// from http://localhost:8765 by (1) stripping framing headers and (2) imbuing
// your real first-party cookies into the iframe's third-party requests, defeating
// Firefox's third-party cookie partitioning.
//
// Reporting: every imbue / relax / no-cookie event is POSTed to
// http://localhost:8765/__log__ (appended to ext.log) and the badge shows the
// count of imbued+relaxed requests.

const PARENT = "localhost:8765";
const LOG_URL = "http://localhost:8765/__log__";
// Build hash stamped by build.sh. Shown in console, the "loaded" self-ping, and
// the badge title so you can confirm from about:debugging + the toolbar that
// you're running the latest build.
const BUILD = "build:20260925-054903-fe14";
const trackedTabs = new Set();
const counts = { imbue: 0, relax: 0, nocookie: 0 };

// Site config is inlined here (and a parallel copy in content.js) so we don't
// depend on cross-script global sharing in the background page. sites.js is
// kept as reference but no longer loaded by the manifest.
const SITES = [
  {
    id: "slack", cookieDomain: "slack.com",
    hostTest: h => h === "slack.com" || h.endsWith(".slack.com"),
  },
  {
    id: "whatsapp", cookieDomain: "whatsapp.com",
    hostTest: h => h === "web.whatsapp.com" || h.endsWith(".whatsapp.com"),
  },
  {
    id: "muse", cookieDomain: "muse.ai",
    hostTest: h => h === "muse.ai" || h.endsWith(".muse.ai"),
  },
];

function siteForHost(host) {
  return SITES.find(s => {
    try { return s.hostTest(host); } catch { return false; }
  }) || null;
}
function isTrackedHost(host) { return !!siteForHost(host); }

function hostOf(url) { try { return new URL(url).hostname; } catch { return ""; } }
function pathOf(url) { try { return new URL(url).pathname; } catch { return ""; } }
function fromOurDevServer(d) {
  const src = d.originUrl || d.initiator || "";
  return src.includes(PARENT);
}

function setBadge() {
  const n = counts.imbue + counts.relax;
  browser.browserAction.setBadgeText({ text: String(n) });
  browser.browserAction.setBadgeBackgroundColor({ color: n > 0 ? "#0a7d2c" : "#666" });
}

function report(kind, url, extra = "") {
  counts[kind] = (counts[kind] || 0) + 1;
  setBadge();
  const msg = `${kind} ${url}${extra ? "  " + extra : ""}`;
  console.debug("[iframe-bypass]", msg);
  try {
    fetch(LOG_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ kind, url, extra, t: Date.now() }),
    }).catch(() => {});
  } catch (e) {}
}

// ---- cookie scoping (generalized per-site cookieDomain) ----
function cookieMatchesHost(c, host) {
  const cd = (c.domain || "").replace(/^\./, "");
  if (!cd) return false;
  if (c.hostOnly) return host === cd;
  return host === cd || host.endsWith("." + cd);
}
function cookieMatchesPath(c, path) {
  const cp = c.path || "/";
  if (cp === "/") return true;
  if (path === cp) return true;
  return path.startsWith(cp) && (cp.endsWith("/") || path.charAt(cp.length) === "/");
}

async function buildCookieHeader(url) {
  const host = hostOf(url);
  const site = siteForHost(host);
  if (!site) return null;
  const all = await browser.cookies.getAll({ domain: site.cookieDomain });
  const path = pathOf(url);
  const matches = all.filter(c => cookieMatchesHost(c, host) && cookieMatchesPath(c, path));
  if (!matches.length) return null;
  return { header: matches.map(c => `${c.name}=${c.value}`).join("; "), n: matches.length, site: site.id };
}

// ---- track which tabs are our dev-server page ----
browser.webRequest.onBeforeRequest.addListener(
  (d) => {
    if (d.type !== "main_frame") return;
    if (d.url.startsWith("http://localhost:8765") || d.url.startsWith("http://127.0.0.1:8765")) {
      trackedTabs.add(d.tabId);
    } else {
      trackedTabs.delete(d.tabId);
    }
  },
  { urls: ["*://localhost/*", "*://127.0.0.1/*"] }
);
browser.tabs.onRemoved.addListener(id => trackedTabs.delete(id));

// ---- imbue cookies into tracked-site requests coming from our iframe ----
browser.webRequest.onBeforeSendHeaders.addListener(
  async (d) => {
    if (!isTrackedHost(hostOf(d.url))) return;
    if (!trackedTabs.has(d.tabId) && !fromOurDevServer(d)) return;
    const built = await buildCookieHeader(d.url);
    if (!built) {
      report("nocookie", d.url);
      return;
    }
    const headers = (d.requestHeaders || []).filter(h => h.name.toLowerCase() !== "cookie");
    headers.push({ name: "Cookie", value: built.header });
    // WhatsApp's server returns a static "Sorry, something went wrong" error
    // page for framed loads (Sec-Fetch-Dest: iframe). Pretend it's a top-level
    // navigation so the server serves the real app.
    if (built.site === "whatsapp") {
      const set = (n, v) => { const i = headers.findIndex(h => h.name.toLowerCase() === n); if (i >= 0) headers[i].value = v; else headers.push({ name: n, value: v }); };
      set("Sec-Fetch-Dest", "document");
      set("Sec-Fetch-Mode", "navigate");
      set("Sec-Fetch-Site", "none");
      set("Sec-Fetch-User", "?1");
    }
    report("imbue", d.url, `${built.site} ${built.n} cookies` + (built.site === "whatsapp" ? " +sec-fetch" : ""));
    return { requestHeaders: headers };
  },
  {
    urls: [
      "*://*.slack.com/*", "*://slack.com/*",
      "*://*.whatsapp.com/*", "*://web.whatsapp.com/*",
      "*://muse.ai/*", "*://*.muse.ai/*"
    ]
  },
  ["blocking", "requestHeaders"]
);

// ---- strip framing headers so the iframe actually paints ----
// Also strip script-src CSP directives for whatsapp/muse so our injected
// diagnostics <script> probe (nonce-less) can run and report what those apps
// log when they bail. Slack works without this, so we leave its CSP intact to
// avoid perturbing a working embed.
function shouldStripScriptCsp(host) {
  return host === "web.whatsapp.com" || host.endsWith(".whatsapp.com")
      || host === "muse.ai" || host.endsWith(".muse.ai");
}
function cleanHeaders(headers, url) {
  const stripScript = shouldStripScriptCsp(hostOf(url));
  return headers
    .map(h => {
      const name = h.name.toLowerCase();
      if (name === "x-frame-options") return null;
      if (name === "content-security-policy" || name === "content-security-policy-report-only") {
        // For whatsapp/muse: drop the ENTIRE CSP. Just removing the script-src
        // directive makes scripts fall back to default-src 'self', which STILL
        // blocks our nonce-less inline probe. Dropping the whole header lets
        // inline scripts run (relaxing CSP doesn't break the app, only security).
        if (stripScript) return null;
        const kept = h.value
          .split(";")
          .map(s => s.trim())
          .filter(dir => dir && !/^frame-ancestors\b/i.test(dir) && !/^frame-src\b/i.test(dir))
          .join("; ");
        if (!kept) return null;
        return { name: h.name, value: kept };
      }
      return h;
    })
    .filter(Boolean);
}

browser.webRequest.onHeadersReceived.addListener(
  (d) => {
    if (!isTrackedHost(hostOf(d.url))) return;
    if (!trackedTabs.has(d.tabId) && !fromOurDevServer(d)) return;
    const before = (d.responseHeaders || []).filter(h => /content-security-policy/i.test(h.name)).map(h => h.value).join(' | ');
    const cleaned = cleanHeaders(d.responseHeaders || [], d.url);
    const after = cleaned.filter(h => /content-security-policy/i.test(h.name)).map(h => h.value).join(' | ');
    const strippedScript = /script-src/i.test(before) && !/script-src/i.test(after);
    report("relax", d.url, strippedScript ? "stripped script-src" : "");
    return { responseHeaders: cleaned };
  },
  {
    urls: [
      "*://*.slack.com/*", "*://slack.com/*",
      "*://*.whatsapp.com/*", "*://web.whatsapp.com/*",
      "*://muse.ai/*", "*://*.muse.ai/*"
    ],
    types: ["main_frame", "sub_frame"]
  },
  ["blocking", "responseHeaders"]
);

setBadge();
try { browser.browserAction.setTitle({ title: `${BUILD} Multi-site iframe bypass (localhost dev)` }); } catch {}
console.log(`[iframe-bypass] ${BUILD} loaded. Sites:`, SITES.map(s => s.id).join(", "));
// Startup self-ping: writes a line to ext.log the moment the background runs,
// so we can tell from the outside whether the extension is actually loaded.
report("loaded", "http://localhost:8765/", `${BUILD} sites=` + SITES.map(s => s.id).join(","));

// ---- ext self-reload: poll build.json for extHash (hash of the extension files);
// when it changes (after ./build.sh touched content.js/background.js/manifest),
// reload THIS extension so I can iterate without a manual about:debugging reload.
// Page-only changes (index.html/probe.js) don't bump extHash, so they don't reload
// the ext (the page auto-reloads itself via watchBuild).
let lastExtHash = null;
async function watchExtReload(){
  try {
    const r = await fetch("http://localhost:8765/build.json", { cache: "no-store" });
    if (!r.ok) return;
    const h = (await r.json()).extHash;
    if (!h) return;
    if (lastExtHash === null) { lastExtHash = h; return; }
    if (h !== lastExtHash) {
      console.log(`[iframe-bypass] ext changed ${lastExtHash} -> ${h}; self-reloading`);
      try { report("ext-reload", "http://localhost:8765/", `${lastExtHash} -> ${h}`); } catch (e) {}
      browser.runtime.reload();
    }
  } catch (e) {}
}
setInterval(watchExtReload, 2000);
