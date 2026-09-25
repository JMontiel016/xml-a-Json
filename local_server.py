"""API local para desarrollo; en Vercel las rutas funcionan sin este proceso."""
import os
from http.server import ThreadingHTTPServer
from api.convert import handler as ConvertHandler
from api.send import handler as SendHandler

class LocalHandler(ConvertHandler):
    def do_POST(self):
        if self.path == '/api/convert':
            return super().do_POST()
        if self.path == '/api/send':
            return SendHandler.do_POST(self)
        self.respond(404, {'error':'Ruta desconocida.'})

if __name__ == '__main__':
    port = int(os.environ.get('API_PORT', '8766'))
    server = ThreadingHTTPServer(('127.0.0.1', port), LocalHandler)
    print(f'API local disponible en http://127.0.0.1:{port}', flush=True)
    server.serve_forever()
