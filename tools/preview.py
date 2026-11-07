#!/usr/bin/env python3
"""Loopback-only private preview with its own isolated, real score service."""
import argparse
import http.client
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import sys
import threading

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from server import create_server


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=5010, choices=[*range(5010,5020),*range(5050,5060)])
    parser.add_argument('--score-port', type=int, default=5059, choices=range(5050,5060))
    parser.add_argument('--db', type=Path, required=True)
    args = parser.parse_args()
    if args.port == args.score_port:
        parser.error('The preview and score service need different ports')
    if not (ROOT/'build/html/index.html').is_file():
        parser.error('Build the browser export first')
    origin = f'http://127.0.0.1:{args.port}'
    scores = create_server(port=args.score_port, db_path=args.db, origins=[origin])

    class Preview(SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=str(ROOT/'build/html'), **kw)

        def api(self):
            connection = http.client.HTTPConnection('127.0.0.1', args.score_port, timeout=8)
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if length < 0 or length > 60*1024:
                    self.send_error(413)
                    return
                body = self.rfile.read(length) if length else None
                headers = {k:v for k,v in self.headers.items() if k.lower() in {'authorization','origin','content-type','access-control-request-method','access-control-request-headers'}}
                connection.request(self.command, self.path, body=body, headers=headers)
                response = connection.getresponse()
                self.send_response(response.status)
                for key,value in response.getheaders():
                    if key.lower() not in {'server','date','connection'}:
                        self.send_header(key,value)
                self.end_headers()
                self.wfile.write(response.read())
            except (OSError, ValueError, http.client.HTTPException):
                self.send_error(503, 'Private score service unavailable')
            finally:
                connection.close()

        def do_GET(self):
            if self.path.startswith('/api/v1/'):
                return self.api()
            if self.path.split('?')[0] == '/settings.json':
                data=json.dumps({'apiBase':origin+'/api/v1/','preview':True}).encode()
                self.send_response(200)
                self.send_header('Content-Type','application/json')
                self.send_header('Content-Length',str(len(data)))
                self.send_header('Cache-Control','no-store')
                self.end_headers()
                self.wfile.write(data)
                return
            return super().do_GET()

        def mutate(self):
            if self.path.startswith('/api/v1/'):
                return self.api()
            self.send_error(405)

        do_POST=do_DELETE=do_OPTIONS=mutate

    try:
        preview=ThreadingHTTPServer(('127.0.0.1', args.port), Preview)
    except BaseException:
        scores.server_close()
        raise
    thread=threading.Thread(target=scores.serve_forever,daemon=True)
    thread.start()
    print(f'Private preview: {origin}/',flush=True)
    try:
        preview.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        preview.server_close()
        scores.shutdown()
        scores.server_close()
        thread.join(timeout=5)


if __name__=='__main__':
    main()
