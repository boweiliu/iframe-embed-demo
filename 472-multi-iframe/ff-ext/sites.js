// Shared site configuration for the multi-iframe bypass extension.
// Loaded by background.js (MV2 background script) and inlined into content.js
// (content scripts can't import background scripts, so we keep a parallel
// copy — see CONTENT_SITES in content.js).
//
// Each site entry:
//   id        short id used in postMessage routing + logs
//   label     human label for the dropdown
//   cookieDomain   registrable domain used for browser.cookies.getAll
//   hostTest  predicate(hostname) -> bool  (which requests we imbue/relax)
//   urls      dropdown urls
//   chat      DOM hooks for the chat bridge (best-effort; selectors drift)
//     inputSel   selector for the chat composer (contenteditable or textarea)
//     sendKey    'enter' | 'button'  — how to send after typing
//     sendBtnSel selector for the send button (if sendKey==='button')
//     listSel    selector for the message-list container (for chat watching)
//     msgSel     selector for an individual message bubble inside listSel
//
// Selectors are best-effort and WILL drift as these apps ship new DOM.
// The content script also has a `probe` command that dumps candidate
// composer / message elements so you can fix selectors without touching code.

const SITES = [
  {
    id: "slack",
    label: "Slack",
    cookieDomain: "slack.com",
    hostTest: h => h === "slack.com" || h.endsWith(".slack.com"),
    urls: [
      "https://imbue-ai.slack.com/",
      "https://app.slack.com",
      "https://slack.com/sign_in",
    ],
    chat: {
      inputSel: 'div[role="textbox"][contenteditable="true"]',
      sendKey: "enter",
      listSel: '[data-qa="message_container"], div[role="log"], main',
      msgSel: '[data-qa="message_content"], .c-message_kit',
    },
  },
  {
    id: "whatsapp",
    label: "WhatsApp Web",
    cookieDomain: "whatsapp.com",
    hostTest: h => h === "web.whatsapp.com" || h.endsWith(".whatsapp.com"),
    urls: ["https://web.whatsapp.com/"],
    chat: {
      // WhatsApp Web composer (2024 layout):
      inputSel: 'footer div[contenteditable="true"][role="textbox"], div[contenteditable="true"][data-tab="10"]',
      sendKey: "enter",
      listSel: 'div[role="application"] div[role="panel"]',
      msgSel: 'div.message-in, div.message-out, div[data-id^="true_"]',
    },
  },
  {
    id: "muse",
    label: "muse.ai",
    cookieDomain: "muse.ai",
    hostTest: h => h === "muse.ai" || h.endsWith(".muse.ai"),
    urls: ["https://muse.ai/", "https://muse.ai/chat"],
    chat: {
      // muse.ai composer — selectors are a guess; run `probe` to fix.
      inputSel: 'textarea[data-qa="chat-input"], textarea[placeholder*="essage"], div[contenteditable="true"][role="textbox"]',
      sendKey: "button",
      sendBtnSel: 'button[data-qa="send"], button[aria-label*="end"], button[type="submit"]',
      listSel: 'main, [data-qa="chat-log"], div[role="log"]',
      msgSel: '[data-qa="message"], article, div[class*="message"]',
    },
  },
];

// global on window for background.js
if (typeof globalThis !== "undefined") globalThis.SITES = SITES;
