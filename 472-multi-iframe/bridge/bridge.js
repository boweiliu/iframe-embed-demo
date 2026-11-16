// Agenttop bridge: a tiny localhost WebSocket server that connects the
// browser page (the dual-iframe shell at http://localhost:8765) to a desktop
// `pi --mode rpc` coding agent running as a child process.
//
// Why this exists: a web extension/page cannot spawn a local process or talk
// to stdin/stdout of one. But it CAN open a WebSocket to localhost. This
// bridge owns the `pi` child process and shuttles JSON lines between the
// browser and the agent.
//
// Protocol (browser <-> bridge, JSON over WS):
//   -> { to: "pi", type: "prompt", message: "..." }     forward a prompt to pi
//   -> { to: "pi", type: "abort" }                      abort current pi run
//   -> { to: "pi", type: "get_state" }                  query pi state
//   -> { to: "pi", type: "get_last_assistant_text" }    query last reply
//   -> { to: "pi", type: "new_session" }                reset pi session
//   <- { from: "pi", kind: "event", event: {...} }      raw pi stdout event
//   <- { from: "pi", kind: "response", response: {...} } pi command response
//   <- { from: "pi", kind: "text", delta: "..." }       convenience: text_delta
//   <- { from: "pi", kind: "status", status: "..." }    bridge status
//   <- { from: "pi", kind: "agent_settled" }            pi finished this run
//
// Anything not addressed `to:"pi"` is ignored by the bridge (the page does
// iframe<->iframe relay itself via postMessage; the bridge is only the path
// to the desktop CLI agent).
//
// Run:  node bridge.js
// Env:  PI_BIN (default "pi"), PI_ARGS (default "--mode rpc --no-session"),
//       PORT (default 8770), PI_CWD (default cwd).

import { spawn } from "node:child_process";
import { WebSocketServer } from "ws";

const PORT = parseInt(process.env.PORT || "8770", 10);
const PI_BIN = process.env.PI_BIN || "pi";
const PI_ARGS = (process.env.PI_ARGS || "--mode rpc --no-session").split(/\s+/).filter(Boolean);
const PI_CWD = process.env.PI_CWD || process.cwd();

let pi = null;
let stdoutBuf = "";
let reqId = 0;
const pending = new Map(); // pi request id -> nothing (we just log)

function startPi() {
  console.log(`[bridge] spawning ${PI_BIN} ${PI_ARGS.join(" ")} (cwd ${PI_CWD})`);
  pi = spawn(PI_BIN, PI_ARGS, { cwd: PI_CWD, stdio: ["pipe", "pipe", "pipe"] });

  pi.stdout.on("data", (chunk) => {
    stdoutBuf += chunk.toString("utf8");
    // split on \n only (RPC framing; see docs/rpc.md — do NOT use readline)
    let nl;
    while ((nl = stdoutBuf.indexOf("\n")) !== -1) {
      let line = stdoutBuf.slice(0, nl);
      stdoutBuf = stdoutBuf.slice(nl + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (!line.trim()) continue;
      let obj;
      try { obj = JSON.parse(line); } catch (e) { console.error("[bridge] bad json:", line.slice(0, 200)); continue; }
      broadcast({ from: "pi", kind: "event", event: obj });
      // convenience text deltas
      if (obj.type === "message_update" && obj.assistantMessageEvent) {
        const d = obj.assistantMessageEvent;
        if (d.type === "text_delta" && d.delta) broadcast({ from: "pi", kind: "text", delta: d.delta });
      }
      if (obj.type === "agent_settled") broadcast({ from: "pi", kind: "agent_settled" });
      if (obj.type === "response") broadcast({ from: "pi", kind: "response", response: obj });
    }
  });

  pi.stderr.on("data", (chunk) => {
    const s = chunk.toString("utf8");
    console.error("[pi:err]", s.trim());
    broadcast({ from: "pi", kind: "stderr", text: s });
  });

  pi.on("exit", (code, sig) => {
    console.log(`[bridge] pi exited code=${code} sig=${sig}`);
    broadcast({ from: "pi", kind: "status", status: `pi exited (code ${code})` });
    pi = null;
  });
}

function sendToPi(cmd) {
  if (!pi) startPi();
  const id = ++reqId;
  const line = JSON.stringify({ id: String(id), ...cmd }) + "\n";
  pi.stdin.write(line);
  console.log("[bridge] -> pi:", line.trim());
}

const wss = new WebSocketServer({ port: PORT, host: "127.0.0.1" });
const clients = new Set();
function broadcast(msg) {
  const s = JSON.stringify(msg);
  for (const c of clients) { try { c.send(s); } catch {} }
}

wss.on("connection", (ws) => {
  clients.add(ws);
  console.log("[bridge] client connected; total", clients.size);
  ws.send(JSON.stringify({ from: "pi", kind: "status", status: pi ? "pi running" : "pi not started" }));
  if (!pi) startPi();

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString("utf8")); } catch { return; }
    if (msg.to !== "pi") return; // not for the bridge
    const { to, ...cmd } = msg;
    sendToPi(cmd);
  });

  ws.on("close", () => { clients.delete(ws); console.log("[bridge] client disconnected; total", clients.size); });
  ws.on("error", () => clients.delete(ws));
});

console.log(`[bridge] WebSocket on ws://127.0.0.1:${PORT}  (browser connects here)`);
console.log(`[bridge] pi: ${PI_BIN} ${PI_ARGS.join(" ")}`);
