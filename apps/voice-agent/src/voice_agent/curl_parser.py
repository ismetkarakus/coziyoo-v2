from __future__ import annotations

import json
import re
from urllib.parse import urlparse


def tokenize_curl(raw: str) -> list[str]:
    src = re.sub(r"\\\r?\n", " ", raw)
    tokens: list[str] = []
    i = 0
    while i < len(src):
        while i < len(src) and src[i].isspace():
            i += 1
        if i >= len(src):
            break
        if src[i] == "\"":
            i += 1
            buff = []
            while i < len(src) and src[i] != "\"":
                if src[i] == "\\" and i + 1 < len(src):
                    buff.append(src[i + 1])
                    i += 2
                else:
                    buff.append(src[i])
                    i += 1
            i += 1
            tokens.append("".join(buff))
        elif src[i] == "'":
            i += 1
            buff = []
            while i < len(src) and src[i] != "'":
                buff.append(src[i])
                i += 1
            i += 1
            tokens.append("".join(buff))
        else:
            buff = []
            while i < len(src) and not src[i].isspace():
                buff.append(src[i])
                i += 1
            tokens.append("".join(buff))
    return tokens


def parse_curl_command(raw: str) -> dict:
    tokens = tokenize_curl(raw)
    url = ""
    headers: dict[str, str] = {}
    body_raw = ""
    for i, tok in enumerate(tokens):
        if tok in {"-H", "--header"} and i + 1 < len(tokens):
            hdr = tokens[i + 1]
            pos = hdr.find(":")
            if pos > 0:
                headers[hdr[:pos].strip().lower()] = hdr[pos + 1 :].strip()
        if tok in {"-d", "--data", "--data-raw", "--data-binary"} and i + 1 < len(tokens):
            body_raw = tokens[i + 1]
        if tok.startswith("http://") or tok.startswith("https://"):
            url = tok

    if not url:
        return {}

    parsed_url = urlparse(url)
    body_obj: dict = {}
    if body_raw:
        try:
            loaded = json.loads(body_raw)
            if isinstance(loaded, dict):
                body_obj = loaded
        except json.JSONDecodeError:
            body_obj = {}

    auth_header = headers.get("authorization", "")
    api_key = ""
    if auth_header.lower().startswith("bearer "):
        api_key = auth_header[7:].strip()

    custom_headers = {k: v for k, v in headers.items() if k != "authorization"}
    result = {
        "base_url": f"{parsed_url.scheme}://{parsed_url.netloc}",
        "endpoint_path": parsed_url.path or "/",
        "api_key": api_key,
        "model": str(body_obj.get("model", "")) if body_obj.get("model") is not None else "",
        "voice_id": str(body_obj.get("voice", "")) if body_obj.get("voice") is not None else "",
        "text_field_name": "input" if "input" in body_obj and "text" not in body_obj else "text",
        "custom_headers": custom_headers,
        "custom_body_params": {k: str(v) for k, v in body_obj.items() if k not in {"model", "text", "input"}},
    }
    return result
