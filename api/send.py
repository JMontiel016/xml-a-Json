"""Proxy para integración; únicamente permite el host configurado."""
import json
import os
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            length = int(self.headers.get('Content-Length','0'))
            if length <= 0 or length > 4_000_000:
                raise ValueError('Solicitud vacía o demasiado grande.')
            request = json.loads(self.rfile.read(length))
            if not isinstance(request,dict):
                raise ValueError('Solicitud inválida.')
            allowed = os.environ.get('INTEGRATION_ALLOWED_HOST','').lower().strip()
            parsed = urlparse(str(request.get('url','')))
            if not allowed:
                raise ValueError('Configurá INTEGRATION_ALLOWED_HOST en Vercel antes de enviar.')
            if parsed.scheme != 'https' or parsed.hostname != allowed or parsed.port is not None or parsed.username or parsed.password:
                raise ValueError('La URL debe ser HTTPS y usar el host de integración configurado.')
            body = request.get('body','')
            if not isinstance(body,str) or not isinstance(json.loads(body),dict):
                raise ValueError('El documento debe ser un objeto JSON.')
            headers = {'Content-Type':'application/json; charset=utf-8','Accept':'application/json'}
            token = request.get('token','')
            if token:
                if not isinstance(token,str) or len(token)>8192 or any(c in token for c in '\r\n'):
                    raise ValueError('Token inválido.')
                headers['Authorization'] = 'Bearer ' + token
            outgoing = urllib.request.Request(parsed.geturl(),body.encode('utf-8'),headers,method='POST')
            try:
                with urllib.request.build_opener(NoRedirect()).open(outgoing,timeout=25) as response:
                    status, content = response.status, response.read(4_000_001)
            except urllib.error.HTTPError as error:
                status, content = error.code, error.read(4_000_001)
            if len(content)>4_000_000:
                raise ValueError('Respuesta de integración demasiado grande.')
            self.respond(200,{'status':status,'body':content.decode('utf-8',errors='replace')})
        except (ValueError,TypeError,KeyError,urllib.error.URLError) as exc:
            self.respond(400,{'error':str(exc)})
        except Exception:
            self.respond(500,{'error':'No se completó la conexión con el servicio.'})

    def respond(self,code,result):
        body=json.dumps(result,ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Cache-Control','no-store')
        self.send_header('Content-Length',str(len(body)))
        self.end_headers()
        self.wfile.write(body)
