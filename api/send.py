"""Envía solicitudes JSON a la URL HTTPS indicada en la pantalla."""

import http.client
import ipaddress
import json
import socket
import ssl
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse


def public_address(host):
    """Comprueba que el dominio apunte a una dirección pública."""
    addresses = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)

    if not addresses:
        raise ValueError("No se pudo resolver el dominio de integración.")

    for address in addresses:
        ip = ipaddress.ip_address(address[4][0])
        if not ip.is_global:
            raise ValueError(
                "La URL de integración debe apuntar a una dirección pública."
            )

    return addresses[0][4][0]


class PublicHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, host, ip):
        super().__init__(
            host,
            port=443,
            timeout=25,
            context=ssl.create_default_context(),
        )
        self.ip = ip

    def connect(self):
        sock = socket.create_connection((self.ip, 443), self.timeout)
        self.sock = self._context.wrap_socket(
            sock,
            server_hostname=self.host,
        )


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))

            if length <= 0 or length > 4_000_000:
                raise ValueError("Solicitud vacía o demasiado grande.")

            request = json.loads(self.rfile.read(length))

            if not isinstance(request, dict):
                raise ValueError("Solicitud inválida.")

            parsed = urlparse(str(request.get("url", "")))

            if (
                parsed.scheme != "https"
                or not parsed.hostname
                or parsed.port is not None
                or parsed.username
                or parsed.password
                or parsed.fragment
            ):
                raise ValueError(
                    "Ingresá una URL HTTPS pública y válida, sin credenciales."
                )

            resolved_ip = public_address(parsed.hostname)

            body = request.get("body", "")

            if not isinstance(body, str) or not isinstance(
                json.loads(body), dict
            ):
                raise ValueError("El documento debe ser un objeto JSON.")

            headers = {
                "Content-Type": "application/json; charset=utf-8",
                "Accept": "application/json",
            }

            token = request.get("token", "")

            if token:
                if (
                    not isinstance(token, str)
                    or len(token) > 8192
                    or any(c in token for c in "\r\n")
                ):
                    raise ValueError("Token inválido.")

                headers["Authorization"] = "Bearer " + token

            connection = PublicHTTPSConnection(
                parsed.hostname,
                resolved_ip,
            )

            try:
                path = parsed.path or "/"

                if parsed.query:
                    path += "?" + parsed.query

                connection.request(
                    "POST",
                    path,
                    body=body.encode("utf-8"),
                    headers=headers,
                )

                response = connection.getresponse()
                status = response.status
                content = response.read(4_000_001)
            finally:
                connection.close()

            if len(content) > 4_000_000:
                raise ValueError(
                    "Respuesta de integración demasiado grande."
                )

            self.respond(
                200,
                {
                    "status": status,
                    "body": content.decode(
                        "utf-8",
                        errors="replace",
                    ),
                },
            )

        except (
            ValueError,
            TypeError,
            KeyError,
            socket.gaierror,
            ssl.SSLError,
            TimeoutError,
            OSError,
        ) as exc:
            self.respond(400, {"error": str(exc)})

        except Exception:
            self.respond(
                500,
                {"error": "No se completó la conexión con el servicio."},
            )

    def respond(self, code, result):
        body = json.dumps(
            result,
            ensure_ascii=False,
        ).encode("utf-8")

        self.send_response(code)
        self.send_header(
            "Content-Type",
            "application/json; charset=utf-8",
        )
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)