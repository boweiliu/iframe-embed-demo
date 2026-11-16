// Throwaway dev extension: allow *.slack.com to be iframed from http://localhost:8765
// by (1) stripping framing headers and (2) imbuing your real first-party Slack
// cookies into the iframe's third-party requests, defeating Firefox's
// third-party cookie partitioning.
//
// Reporting: every imbue / relax / no-cookie event is POSTed to
// http://localhost:8765/__log__ (appended to ext.log) and the badge shows
// the count of imbued+relaxed requests.

const PARENT = "localhost:8765";
const LOG_URL = "http://localhost:8765/__log__";
const trackedTabs = new Set();
const counts = { imbue: 0, relax: 0, nocookie: 0 };

function hostOf(url) { try { return new URL(url).hostname; } catch { return ""; } }
function pathOf(url) { try { return new URL(url).pathname; } catch { return ""; } }
function isSlack(host) { return host === "slack.com" || host.endsWith(".slack.com"); }
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
  console.debug("[slack-iframe-bypass]", msg);
  try {
    fetch(LOG_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ kind, url, extra, t: Date.now() }),
    }).catch(() => {});
  } catch (e) {}
}

// ---- cookie scoping ----
function registrableSlackDomain(host) {
  if (host === "slack.com" || host.endsWith(".slack.com")) return "slack.com";
  return null;
}
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
  const reg = registrableSlackDomain(host);
  if (!reg) return null;
  const all = await browser.cookies.getAll({ domain: reg });
  const path = pathOf(url);
  const matches = all.filter(c => cookieMatchesHost(c, host) && cookieMatchesPath(c, path));
  if (!matches.length) return null;
  return { header: matches.map(c => `${c.name}=${c.value}`).join("; "), n: matches.length };
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

// ---- imbue cookies into *.slack.com requests coming from our iframe ----
browser.webRequest.onBeforeSendHeaders.addListener(
  async (d) => {
    if (!isSlack(hostOf(d.url))) return;
    if (!trackedTabs.has(d.tabId) && !fromOurDevServer(d)) return;
    const built = await buildCookieHeader(d.url);
    if (!built) {
      report("nocookie", d.url);
      return;
    }
    const headers = (d.requestHeaders || []).filter(h => h.name.toLowerCase() !== "cookie");
    headers.push({ name: "Cookie", value: built.header });
    report("imbue", d.url, `${built.n} cookies`);
    return { requestHeaders: headers };
  },
  { urls: ["*://*.slack.com/*", "*://slack.com/*"] },
  ["blocking", "requestHeaders"]
);

// ---- strip framing headers so the iframe actually paints ----
function cleanHeaders(headers) {
  return headers
    .map(h => {
      const name = h.name.toLowerCase();
      if (name === "x-frame-options") return null;
      if (name === "content-security-policy" || name === "content-security-policy-report-only") {
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
    if (!isSlack(hostOf(d.url))) return;
    if (!trackedTabs.has(d.tabId) && !fromOurDevServer(d)) return;
    report("relax", d.url);
    return { responseHeaders: cleanHeaders(d.responseHeaders || []) };
  },
  { urls: ["*://*.slack.com/*", "*://slack.com/*"], types: ["main_frame", "sub_frame"] },
  ["blocking", "responseHeaders"]
);

setBadge();
console.log("[slack-iframe-bypass] v1.2 loaded. Log into Slack normally, then open http://localhost:8765/index.html");
