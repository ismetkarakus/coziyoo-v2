import os
import signal
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

from dotenv import load_dotenv

load_dotenv('.env.local')

AGENT_CHILD_CMD = os.getenv('AGENT_CHILD_CMD', 'python src/agent.py dev')
AGENT_HTTP_HOST = os.getenv('AGENT_HTTP_HOST', '127.0.0.1')
AGENT_HTTP_PORT = int(os.getenv('AGENT_HTTP_PORT', '8787'))

child_proc = None
stop_event = threading.Event()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        return

    def _send(self, status: int, body: bytes):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path in ('/health', '/healthz', '/'):
            running = child_proc is not None and child_proc.poll() is None
            if running:
                self._send(200, b'{"ok":true,"service":"agent"}')
            else:
                self._send(503, b'{"ok":false,"service":"agent"}')
            return

        self._send(404, b'{"ok":false,"error":"not_found"}')


def run_agent_child():
    global child_proc
    child_proc = subprocess.Popen(['/bin/bash', '-lc', AGENT_CHILD_CMD])
    rc = child_proc.wait()
    stop_event.set()
    if rc != 0:
        raise SystemExit(rc)


def shutdown(*_args):
    stop_event.set()
    if child_proc is not None and child_proc.poll() is None:
        child_proc.terminate()


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    thread = threading.Thread(target=run_agent_child, daemon=True)
    thread.start()

    server = HTTPServer((AGENT_HTTP_HOST, AGENT_HTTP_PORT), Handler)
    while not stop_event.is_set():
        server.handle_request()

    server.server_close()
