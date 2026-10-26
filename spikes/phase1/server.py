#!/usr/bin/env python3
"""Small, temporary LAN upload spike for phase 1."""

from __future__ import annotations

import argparse
import ipaddress
import json
import mimetypes
import secrets
import socket
import tempfile
import uuid
from email.parser import BytesParser
from email.policy import default
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit


ROOT = Path(__file__).resolve().parent
UPLOADS = Path(tempfile.gettempdir()) / "exam2pdf-phase1-uploads"
MAX_BODY_BYTES = 40 * 1024 * 1024
TOKEN = secrets.token_urlsafe(12)
mimetypes.add_type("image/heic", ".heic")
mimetypes.add_type("image/heif", ".heif")


def lan_ip() -> str:
    """Ask the local routing table which IPv4 address would reach another host."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("192.0.2.1", 9))  # TEST-NET address; UDP connect sends no payload.
        address = sock.getsockname()[0]
        if ipaddress.ip_address(address).is_private:
            return address
    except OSError:
        pass
    finally:
        sock.close()
    return "127.0.0.1"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt: str, *args) -> None:
        print("[http] " + fmt % args)

    def authorized(self) -> bool:
        token = parse_qs(urlsplit(self.path).query).get("token", [""])[0]
        return secrets.compare_digest(token, TOKEN)

    def json_response(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        request = urlsplit(self.path)
        if request.path.startswith("/api/") or request.path.startswith("/uploaded/"):
            if not self.authorized():
                self.json_response(403, {"error": "链接令牌无效，请从运行窗口复制完整地址。"})
                return
        if request.path == "/api/info":
            self.json_response(200, {"lanUrl": f"http://{SERVER_IP}:{SERVER_PORT}/?token={TOKEN}"})
            return
        if request.path == "/api/files":
            UPLOADS.mkdir(exist_ok=True)
            files = []
            for path in sorted(UPLOADS.iterdir(), key=lambda item: item.stat().st_mtime):
                if path.is_file():
                    mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
                    files.append({"name": path.name, "type": mime, "url": f"/uploaded/{path.name}?token={TOKEN}"})
            self.json_response(200, {"files": files})
            return
        if request.path.startswith("/uploaded/"):
            name = Path(unquote(request.path.removeprefix("/uploaded/"))).name
            path = UPLOADS / name
            if not path.is_file():
                self.send_error(404)
                return
            body = path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", mimetypes.guess_type(path.name)[0] or "application/octet-stream")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
        self.path = "/index.html" if request.path == "/" else request.path
        super().do_GET()

    def do_POST(self) -> None:
        request = urlsplit(self.path)
        if request.path != "/api/upload":
            self.send_error(404)
            return
        if not self.authorized():
            self.json_response(403, {"error": "链接令牌无效。"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY_BYTES:
            self.json_response(413, {"error": "上传内容为空或超过 40 MB。"})
            return
        content_type = self.headers.get("Content-Type", "")
        if not content_type.lower().startswith("multipart/form-data;"):
            self.json_response(415, {"error": "请使用图片文件表单上传。"})
            return

        raw = self.rfile.read(length)
        envelope = (f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n").encode() + raw
        message = BytesParser(policy=default).parsebytes(envelope)
        saved = []
        UPLOADS.mkdir(exist_ok=True)
        for part in message.iter_parts():
            if part.get_content_disposition() != "form-data":
                continue
            if part.get_param("name", header="content-disposition") != "file":
                continue
            payload = part.get_payload(decode=True) or b""
            mime = part.get_content_type().lower()
            original_name = Path(part.get_filename() or "upload").name
            suffix = Path(original_name).suffix.lower()
            if not mime.startswith("image/") or not payload:
                continue
            if suffix not in {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".heic", ".heif", ".bmp"}:
                suffix = mimetypes.guess_extension(mime) or ".img"
            destination = UPLOADS / f"{uuid.uuid4().hex}{suffix}"
            destination.write_bytes(payload)
            saved.append({"name": destination.name, "type": mime, "bytes": len(payload)})

        if not saved:
            self.json_response(400, {"error": "没有收到可识别的图片。"})
            return
        self.json_response(201, {"files": saved})


def main() -> None:
    global SERVER_IP, SERVER_PORT
    parser = argparse.ArgumentParser(description="Run the temporary phase-1 LAN image upload spike.")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    SERVER_IP = lan_ip()
    SERVER_PORT = args.port
    server = ThreadingHTTPServer(("0.0.0.0", SERVER_PORT), Handler)
    print("阶段 1 图片上传验证服务已启动")
    print(f"本机地址: http://127.0.0.1:{SERVER_PORT}/?token={TOKEN}")
    print(f"同一 Wi-Fi 手机地址: http://{SERVER_IP}:{SERVER_PORT}/?token={TOKEN}")
    print("停止服务请按 Ctrl+C。此验证服务不会连接公网。")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n验证服务已停止。")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
