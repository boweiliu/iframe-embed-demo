import http.server, socketserver, os, datetime

PORT = 8765
DIR = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(DIR, "ext.log")

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=DIR, **k)

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()

    def do_POST(self):
        if self.path == "/__log__":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length).decode("utf-8", "replace")
            line = f"{datetime.datetime.now().isoformat()} {body}\n"
            with open(LOG, "a") as f:
                f.write(line)
            print(line, end="", flush=True)
            self.send_response(204); self._cors(); self.end_headers()
        else:
            self.send_response(404); self._cors(); self.end_headers()

    def log_message(self, *a):
        pass  # keep stdout clean for ext.log lines

socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("127.0.0.1", PORT), H) as s:
    print(f"serving {DIR} on http://localhost:{PORT} ; ext log -> {LOG}")
    s.serve_forever()
