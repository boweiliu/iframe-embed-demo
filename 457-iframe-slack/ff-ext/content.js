// Content script injected into *.slack.com iframes (and tabs).
// Bridges DOM read/write to the localhost:8765 parent via postMessage.
// The parent cannot touch this cross-origin DOM directly; we can, because we
// run inside this origin. We only honor messages tagged from:'slacktop-parent'.

const BANNER_ID = 'slacktop-dumb-banner';

function ensureBanner() {
  let b = document.getElementById(BANNER_ID);
  if (b) return b;
  b = document.createElement('div');
  b.id = BANNER_ID;
  b.textContent = '✨ HELLO FROM LOCALHOST — DOM write POC ✨';
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
  return { visible: show, created: !b.dataset.seen, display: b.style.display };
}

function snapshot() {
  // Best-effort DOM read. Selectors may drift; we return whatever we find.
  const q = (sel) => Array.from(document.querySelectorAll(sel));
  const names = q('[data-qa="channel_sidebar_item_name"]')
    .map(a => (a.innerText || a.textContent || '').trim())
    .filter(Boolean);
  const links = q('a[href*="/client/"]')
    .map(a => ({ href: a.getAttribute('href'), text: (a.innerText||'').trim() }))
    .slice(0, 20);
  return {
    url: location.href,
    origin: location.origin,
    title: document.title,
    divCount: document.querySelectorAll('div').length,
    spanCount: document.querySelectorAll('span').length,
    channelNames: names.slice(0, 40),
    clientLinks: links,
    bodyTextSample: (document.body && document.body.innerText || '').slice(0, 240),
    hasBanner: !!document.getElementById(BANNER_ID),
  };
}

window.addEventListener('message', (ev) => {
  const d = ev.data;
  if (!d || d.from !== 'slacktop-parent') return;
  let result;
  try {
    switch (d.cmd) {
      case 'ping': result = { ok: true, url: location.href, origin: location.origin }; break;
      case 'snapshot': result = snapshot(); break;
      case 'toggle': result = toggleBanner(); break;
      case 'toggleOn': result = toggleBanner(true); break;
      case 'toggleOff': result = toggleBanner(false); break;
      default: result = { error: 'unknown cmd: ' + d.cmd };
    }
  } catch (e) {
    result = { error: String(e) };
  }
  if (ev.source) {
    ev.source.postMessage({ from: 'slacktop-cs', id: d.id, cmd: d.cmd, result }, '*');
  }
});

console.log('[slack-iframe-bypass] content script loaded in', location.href);

// ---- reverse bridge: observe clicks inside slack, report up to the parent ----
function classList(el){
  return (el.className && typeof el.className === 'string')
    ? el.className.trim().split(/\s+/).filter(Boolean) : [];
}
function childIndexAmongSameTag(el){
  const tag = el.tagName;
  let i = 0;
  let sib = el.parentElement ? el.parentElement.firstElementChild : null;
  while (sib){
    if (sib.tagName === tag){ i++; if (sib === el) return i; }
    sib = sib.nextElementSibling;
  }
  return 1;
}
function buildPath(el, maxDepth=14){
  const segs = [];
  let cur = el, depth = 0;
  while (cur && cur.nodeType === 1 && depth < maxDepth){
    const tag = cur.tagName.toLowerCase();
    const cls = classList(cur).slice(0, 3); // first 3 classes
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

if (window.parent && window.parent !== window){
  document.addEventListener('click', (e) => {
    const el = e.target && e.target.nodeType === 1 ? e.target : (e.target && e.target.parentElement);
    if (!el || el.nodeType !== 1) return;
    const text = (el.innerText || el.textContent || '').trim().slice(0, 120);
    const payload = {
      from: 'slacktop-cs',
      event: 'click',
      ts: Date.now(),
      path: buildPath(el),
      tag: el.tagName.toLowerCase(),
      classes: classList(el).slice(0, 5),
      text: text,
      href: el.tagName === 'A' ? (el.getAttribute('href') || '') : '',
      x: e.clientX, y: e.clientY,
    };
    try { window.parent.postMessage(payload, '*'); } catch (err) {}
  }, true); // capture phase: see it before slack can stopPropagation
  console.log('[slack-iframe-bypass] click observer installed');
}
