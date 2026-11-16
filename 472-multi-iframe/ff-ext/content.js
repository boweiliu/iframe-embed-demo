// Content script injected into *.slack.com / *.whatsapp.com / muse.ai iframes
// (and tabs). Bridges DOM read/write + chat text to the localhost:8765 parent
// via postMessage. The parent cannot touch this cross-origin DOM directly; we
// can, because we run inside this origin. We only honor messages tagged
// from:'agenttop-parent'.

// Build hash stamped by build.sh; surfaced in the ping response so the page
// can display which content-script build is actually injected.
const BUILD = "build:20260925-054903-fe14";
//
// Site config inlined here (parallel copy of background.js's SITES, plus the
// chat DOM selectors the content script needs). sites.js is kept as reference
// but no longer loaded by the manifest — no cross-script global dependency.
const SITES = [
  {
    id: "slack",
    hostTest: h => h === "slack.com" || h.endsWith(".slack.com"),
    chat: {
      inputSel: 'div[role="textbox"][contenteditable="true"]',
      sendKey: "enter",
      listSel: '[data-qa="message_container"], div[role="log"], main',
      msgSel: '[data-qa="message_content"], .c-message_kit',
    },
  },
  {
    id: "whatsapp",
    hostTest: h => h === "web.whatsapp.com" || h.endsWith(".whatsapp.com"),
    chat: {
      inputSel: 'footer div[contenteditable="true"][role="textbox"], div[contenteditable="true"][data-tab="10"]',
      sendKey: "enter",
      listSel: 'div[role="application"] div[role="panel"]',
      msgSel: 'div.message-in, div.message-out, div[data-id^="true_"]',
    },
  },
  {
    id: "muse",
    hostTest: h => h === "muse.ai" || h.endsWith(".muse.ai"),
    chat: {
      inputSel: 'textarea[data-qa="chat-input"], textarea[placeholder*="essage"], div[contenteditable="true"][role="textbox"]',
      sendKey: "button",
      sendBtnSel: 'button[data-qa="send"], button[aria-label*="end"], button[type="submit"]',
      listSel: 'main, [data-qa="chat-log"], div[role="log"]',
      msgSel: '[data-qa="message"], article, div[class*="message"]',
    },
  },
];
const site = SITES.find(s => { try { return s.hostTest(location.hostname); } catch { return false; } }) || null;
const SITE_ID = site ? site.id : location.hostname;
const CHAT = site ? site.chat : null;

// ---- Neutralize WhatsApp's service worker (the real reason iframing fails).
// The SW serves the app shell from cache WITH the original nonce-CSP, which
// blocks our inline probe (and is why WhatsApp shows "something went wrong").
// Content scripts run in an isolated world (NOT subject to page CSP), so we can
// unregister the SW + clear its Cache here. After unregister, reload once so
// the next load hits the network — where our webRequest strips the CSP and the
// probe can run. The probe then overrides navigator.serviceWorker.register to
// prevent re-install. (WhatsApp only — don't disturb the working Slack embed.)
if (SITE_ID === 'whatsapp') {
  try {
    const hasSW = !!(navigator.serviceWorker && navigator.serviceWorker.getRegistrations);
    csBeacon({ stage:'sw-check', hasSW, href: location.href, isFramed: window !== window.top });
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      navigator.serviceWorker.getRegistrations().then(async (regs) => {
        csBeacon({ stage:'sw-regs', n: regs.length, scopes: regs.map(r => r.scope) });
        if (!regs.length) return; // already gone — this load is the network one
        await Promise.all(regs.map(r => r.unregister()));
        try { const keys = await caches.keys(); await Promise.all(keys.map(k => caches.delete(k))); } catch (e) {}
        csBeacon({ stage:'sw-cleared', willReload: true });
        location.reload(); // reload without SW control -> network load (CSP stripped)
      }).catch((e) => csBeacon({ stage:'sw-err', err: String(e) }));
    }
  } catch (e) { csBeacon({ stage:'sw-err', err: String(e) }); }
}

// ---- diagnostics probe: injected into the PAGE main world on demand by the
// `inject` command (code comes from the page, which fetches /probe.js served
// by server.py). The probe lives in probe.js (not here) so it can be iterated
// WITHOUT reloading the extension. CSP must allow inline scripts: the extension
// strips script-src for whatsapp/muse; Slack's CSP already allows it.
// ---- diagnostics probe: injected SYNCHRONOUSLY at document_start into the
// PAGE main world. Must be synchronous + at document_start to run before the
// page's CSP is enforced on inline scripts (after-load injection is blocked).
// The probe code is inlined here (not fetched) because the page world can't
// fetch localhost (connect-src CSP) and async fetch would land after CSP.
function csBeacon(obj){ try { fetch('http://localhost:8765/__log__', { method:'POST', headers:{'Content-Type':'text/plain'}, body: JSON.stringify(Object.assign({kind:'cs', site: SITE_ID}, obj)) }); } catch(e){} }
function injectDiagProbe() {
  csBeacon({ stage:'boot', href: location.href, readyState: document.readyState, isFramed: window !== window.top,
    metaCSP: (document.querySelector('meta[http-equiv~="Content-Security-Policy" i]') || {}).content || '' });
  if (window.__agenttopDiag) return;
  const probe = function () {
    if (window.__agenttopDiag) return;
    window.__agenttopDiag = true;
    const SITE = window.__agenttopSite || location.hostname;
    // prevent WhatsApp from re-registering its service worker (we unregistered
    // it from the content script); the SW is what re-applies the nonce CSP from
    // cache. Without it, navigations hit the network where our ext strips CSP.
    // (WhatsApp only — don't break Slack/muse SW registration.)
    try { if (SITE === 'whatsapp' && navigator.serviceWorker) navigator.serviceWorker.register = () => Promise.reject(new Error('agenttop: SW disabled')); } catch (e) {}
    // Request first-party storage access so the iframe sees the REAL web.whatsapp.com
    // IndexedDB session (defeats Firefox storage partitioning, which is why the
    // iframe shows the QR login instead of your account). Firefox may auto-grant
    // via its heuristic (you use WhatsApp as a first-party site) or prompt once.
    // On grant, reload so WhatsApp re-reads the now-first-party session.
    try {
      if (SITE === 'whatsapp' && document.requestStorageAccess) {
        const tryGrant = (fromGesture) => {
          document.requestStorageAccess().then(() => {
            send('storage-access', { granted: true, fromGesture });
            setTimeout(() => location.reload(), 300); // reload so WhatsApp reads the now-first-party session
          }).catch((e) => {
            send('storage-access', { granted: false, err: String(e), fromGesture });
            if (!fromGesture) {
              // first attempt (no gesture) failed -> grant on the FIRST click in
              // the pane. After this grant persists, so future loads auto-grant.
              const onClick = () => { document.removeEventListener('click', onClick, true); tryGrant(true); };
              document.addEventListener('click', onClick, true);
            }
          });
        };
        tryGrant(false);
      }
    } catch (e) { send('storage-access', { granted: false, err: String(e) }); } {} {}
    const send = (kind, data) => {
      try { window.parent.postMessage({ from: "agenttop-cs", event: "diag", site: SITE, kind: kind, data: data, ts: Date.now() }, "*"); } catch (e) {}
    };
    const safe = (a) => { try { if (a == null) return String(a); if (typeof a === "string") return a.slice(0, 500); if (a instanceof Error) return (a.stack || a.message || String(a)).slice(0, 500); return JSON.stringify(a).slice(0, 500); } catch (e) { return String(a).slice(0, 500); } };
    try { send("frame", { href: location.href, isFramed: window !== window.top, topIsSelf: window.top === window.self, parentIsSelf: window.parent === window.self, opener: !!window.opener }); } catch (e) { send("frame", { error: String(e) }); }
    window.addEventListener("error", (e) => send("error", { msg: e.message, src: (e.filename || "") + ":" + (e.lineno || 0) + ":" + (e.colno || 0), stack: (e.error && e.error.stack) || "" }), true);
    window.addEventListener("unhandledrejection", (e) => send("rejection", { reason: safe(e.reason) }), true);
    ["log", "warn", "error", "info", "debug"].forEach((fn) => {
      const orig = console[fn] ? console[fn].bind(console) : null;
      if (!orig) return;
      console[fn] = function () { try { send("console", { level: fn, args: Array.prototype.slice.call(arguments).map(safe).slice(0, 6) }); } catch (e) {} return orig.apply(null, arguments); };
    });
    const snapshot = () => { try { send("loaded", { href: location.href, title: document.title, bodyText: (document.body && document.body.innerText || "").slice(0, 800), html: (document.documentElement.outerHTML || "").slice(0, 1500), isFramed: window !== window.top }); } catch (e) {} };
    if (document.readyState === "complete") { snapshot(); setTimeout(snapshot, 1500); setTimeout(snapshot, 4000); }
    else window.addEventListener("load", () => { snapshot(); setTimeout(snapshot, 1500); setTimeout(snapshot, 4000); });
  };
  let code = "(" + probe.toString() + ")();";
  code = code.replace('window.__agenttopSite || location.hostname', JSON.stringify(SITE_ID) + ' || location.hostname');
  let appended = false, err = '';
  try {
    const s = document.createElement('script');
    s.textContent = code;
    (document.documentElement || document.head || document.body).appendChild(s);
    appended = true;
    s.remove();
  } catch (e) { err = String(e); }
  // trivial inline-test: a nonce-less <script> that postMessages directly. If this
  // arrives as diag 'inline-test', inline scripts DO run (CSP relaxed) and the
  // probe itself has a bug. If it never arrives, CSP still blocks inline.
  try {
    const t = document.createElement('script');
    t.textContent = 'try{window.parent.postMessage({from:"agenttop-cs",event:"diag",site:' + JSON.stringify(SITE_ID) + ',kind:"inline-test",data:{ran:true},ts:Date.now()},"*")}catch(e){};';
    (document.documentElement || document.head || document.body).appendChild(t);
    t.remove();
  } catch (e) {}
  // did the injected script execute? check the page world flag it sets.
  setTimeout(() => {
    let ran = 'unknown';
    try { ran = !!window.wrappedJSObject.__agenttopDiag; } catch (e) { ran = 'check-err:' + e; }
    csBeacon({ stage:'inject', appended, err, ran, codeLen: code.length });
  }, 0);
}
injectDiagProbe();

const BANNER_ID = 'agenttop-dumb-banner';

function ensureBanner() {
  let b = document.getElementById(BANNER_ID);
  if (b) return b;
  b = document.createElement('div');
  b.id = BANNER_ID;
  b.textContent = `✨ HELLO FROM LOCALHOST — ${SITE_ID} DOM write POC ✨`;
  b.style.cssText = [
    'position:fixed', 'top:0', 'left:0', 'right:0',
    'z-index:2147483647',
    'background:linear-gradient(90deg,#ff00cc,#3333ff)',
    'color:#fff', 'font:bold 16px system-ui,sans-serif',
    'padding:10px 14px', 'text-align:center', 'pointer-events:none',
    'box-shadow:0 2px 8px rgba(0,0,0,.4)'
  ].join(';');
  document.documentElement.appendChild(b);
  return b;
}
function toggleBanner(force) {
  const b = ensureBanner();
  const show = force !== undefined ? force : (b.style.display === 'none');
  b.style.display = show ? 'block' : 'none';
  return { visible: show, display: b.style.display };
}

function snapshot() {
  const q = (sel) => Array.from(document.querySelectorAll(sel));
  const inputs = q('input,textarea,div[contenteditable="true"]').slice(0, 20).map(el => ({
    tag: el.tagName.toLowerCase(),
    role: el.getAttribute('role') || '',
    placeholder: el.getAttribute('placeholder') || '',
    dataQa: el.getAttribute('data-qa') || '',
    classes: (el.className && typeof el.className === 'string' ? el.className.split(/\s+/).slice(0,3) : []),
  }));
  return {
    url: location.href,
    origin: location.origin,
    site: SITE_ID,
    title: document.title,
    divCount: document.querySelectorAll('div').length,
    candidateComposers: inputs,
    bodyTextSample: (document.body && document.body.innerText || '').slice(0, 240),
    hasBanner: !!document.getElementById(BANNER_ID),
  };
}

// ---- chat helpers (best-effort; selectors drift) ----
function findComposer() {
  if (!CHAT) return null;
  return document.querySelector(CHAT.inputSel);
}
function findSendButton() {
  if (!CHAT || CHAT.sendKey !== 'button') return null;
  return document.querySelector(CHAT.sendBtnSel);
}

// Set text in a contenteditable or textarea in a way React/Vue apps notice.
function setComposerText(el, text) {
  el.focus();
  if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
    // native input
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value') ||
                   Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
    if (setter && setter.set) setter.set.call(el, text); else el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  // contenteditable: execCommand is the most reliable for React synthetic inputs
  try {
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, text);
    return true;
  } catch (e) {
    el.textContent = text;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
    return true;
  }
}

function sendChat(text) {
  const composer = findComposer();
  if (!composer) return { ok: false, error: 'composer not found for ' + SITE_ID + ' (run probe)' };
  setComposerText(composer, text);
  // send
  if (CHAT.sendKey === 'enter') {
    const ev = new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
      bubbles: true, cancelable: true,
    });
    composer.dispatchEvent(ev);
    const ev2 = new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true });
    composer.dispatchEvent(ev2);
    return { ok: true, sent: 'enter' };
  } else {
    const btn = findSendButton();
    if (!btn) return { ok: false, error: 'send button not found for ' + SITE_ID };
    btn.click();
    return { ok: true, sent: 'button' };
  }
}

// Read recent chat messages (last N).
function getChat(limit = 20) {
  if (!CHAT) return { ok: false, error: 'no chat config for ' + SITE_ID };
  const list = document.querySelector(CHAT.listSel) || document.body;
  const msgs = Array.from(list.querySelectorAll(CHAT.msgSel)).slice(-limit);
  const items = msgs.map(m => ({
    text: (m.innerText || m.textContent || '').trim().slice(0, 400),
    out: /message-out|outbound|sent/.test(m.className || '') ||
         !/message-in|inbound/.test(m.className || ''),
  }));
  return { ok: true, site: SITE_ID, count: items.length, messages: items };
}

// Probe: dump candidate composer + message elements so selectors can be fixed.
function probe() {
  const composers = Array.from(document.querySelectorAll('input,textarea,div[contenteditable="true"]'))
    .slice(0, 12).map(el => ({
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || '',
      placeholder: el.getAttribute('placeholder') || '',
      dataQa: el.getAttribute('data-qa') || '',
      ariaLabel: el.getAttribute('aria-label') || '',
      classes: (el.className && typeof el.className === 'string' ? el.className.split(/\s+/).slice(0,4) : []),
      visible: !!(el.offsetWidth || el.offsetHeight),
    }));
  const buttons = Array.from(document.querySelectorAll('button'))
    .slice(0, 20).map(b => ({
      ariaLabel: b.getAttribute('aria-label') || '',
      dataQa: b.getAttribute('data-qa') || '',
      text: (b.innerText||'').trim().slice(0,40),
      type: b.getAttribute('type') || '',
    }));
  return { site: SITE_ID, composers, buttons };
}

// ---- command dispatch ----
window.addEventListener('message', (ev) => {
  const d = ev.data;
  if (!d || d.from !== 'agenttop-parent') return;
  let result;
  try {
    switch (d.cmd) {
      case 'ping': result = { ok: true, url: location.href, origin: location.origin, site: SITE_ID, build: BUILD }; break;
      case 'snapshot': result = snapshot(); break;
      case 'probe': result = probe(); break;
      case 'toggle': result = toggleBanner(); break;
      case 'toggleOn': result = toggleBanner(true); break;
      case 'toggleOff': result = toggleBanner(false); break;
      case 'getChat': result = getChat(d.limit || 20); break;
      case 'sendChat': result = sendChat(d.text || ''); break;
      default: result = { error: 'unknown cmd: ' + d.cmd };
    }
  } catch (e) {
    result = { error: String(e) };
  }
  if (ev.source) {
    ev.source.postMessage({ from: 'agenttop-cs', id: d.id, cmd: d.cmd, site: SITE_ID, result }, '*');
  }
});

console.log(`[iframe-bypass] ${BUILD} content script loaded in`, location.href, 'site=', SITE_ID);

// ---- reverse bridge: observe clicks inside the app, report up to the parent ----
function classList(el){
  return (el.className && typeof el.className === 'string')
    ? el.className.trim().split(/\s+/).filter(Boolean) : [];
}
function childIndexAmongSameTag(el){
  const tag = el.tagName; let i = 0;
  let sib = el.parentElement ? el.parentElement.firstElementChild : null;
  while (sib){ if (sib.tagName === tag){ i++; if (sib === el) return i; } sib = sib.nextElementSibling; }
  return 1;
}
function buildPath(el, maxDepth=14){
  const segs = []; let cur = el, depth = 0;
  while (cur && cur.nodeType === 1 && depth < maxDepth){
    const tag = cur.tagName.toLowerCase();
    const cls = classList(cur).slice(0, 3);
    const idx = childIndexAmongSameTag(cur);
    let seg = tag;
    if (cls.length) seg += '.' + cls.join('.');
    seg += '[' + idx + ']';
    const hints = [];
    if (cur.id) hints.push('#' + cur.id);
    const qa = cur.getAttribute && cur.getAttribute('data-qa');
    if (qa) hints.push('[data-qa="' + qa + '"]');
    if (hints.length) seg += hints.join('');
    segs.unshift(seg);
    cur = cur.parentElement; depth++;
  }
  return segs.join(' > ');
}

function postUp(payload){
  if (window.parent && window.parent !== window){
    try { window.parent.postMessage(payload, '*'); } catch (err) {}
  }
}

if (window.parent && window.parent !== window){
  document.addEventListener('click', (e) => {
    const el = e.target && e.target.nodeType === 1 ? e.target : (e.target && e.target.parentElement);
    if (!el || el.nodeType !== 1) return;
    const text = (el.innerText || el.textContent || '').trim().slice(0, 120);
    postUp({
      from: 'agenttop-cs', event: 'click', ts: Date.now(),
      site: SITE_ID, path: buildPath(el), tag: el.tagName.toLowerCase(),
      classes: classList(el).slice(0, 5), text, href: el.tagName === 'A' ? (el.getAttribute('href') || '') : '',
      x: e.clientX, y: e.clientY,
    });
  }, true);
  console.log('[iframe-bypass] click observer installed for', SITE_ID);
}

// ---- chat watcher: report newly-added messages up to the parent ----
// Heuristic: observe the message-list container; when new message nodes appear,
// post their text up. Used to pull agent text OUT of muse/whatsapp/slack.
let lastSentText = '';
function startChatWatch() {
  if (!CHAT) { console.log('[iframe-bypass] no chat config — chat watch disabled for', SITE_ID); return; }
  const attach = () => {
    const list = document.querySelector(CHAT.listSel);
    if (!list) { setTimeout(attach, 1500); return; }
    const obs = new MutationObserver(() => {
      const msgs = Array.from(list.querySelectorAll(CHAT.msgSel));
      if (!msgs.length) return;
      const last = msgs[msgs.length - 1];
      const text = (last.innerText || last.textContent || '').trim();
      if (!text || text === lastSentText) return;
      lastSentText = text;
      const out = /message-out|outbound|sent/.test(last.className || '') ||
                 !/message-in|inbound/.test(last.className || '');
      postUp({
        from: 'agenttop-cs', event: 'chat', ts: Date.now(),
        site: SITE_ID, text: text.slice(0, 1000), out,
      });
    });
    obs.observe(list, { childList: true, subtree: true, characterData: true });
    console.log('[iframe-bypass] chat watcher attached for', SITE_ID);
  };
  attach();
}
startChatWatch();
// self-reload test 1790313797
// nudge 1790313967
