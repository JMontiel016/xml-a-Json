"""Vercel Python Function para convertir el XML sin depender de Java."""
import json
from http.server import BaseHTTPRequestHandler
from lib.conversion import convert

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if length <= 0 or length > 10_000_000:
                self.respond(413, {'error':'El archivo está vacío o supera 10 MB.'})
                return
            request = json.loads(self.rfile.read(length))
            if not isinstance(request, dict):
                raise ValueError('La solicitud debe ser un objeto JSON.')
            self.respond(200, convert(request))
        except (ValueError, TypeError, json.JSONDecodeError) as exc:
            self.respond(400, {'error':str(exc)})
        except Exception:
            self.respond(500, {'error':'Error interno al convertir. Revisá el registro del servidor.'})

    def respond(self, code, content):
        body = json.dumps(content,ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Cache-Control','no-store')
        self.send_header('Content-Length',str(len(body)))
        self.end_headers()
        self.wfile.write(body)
