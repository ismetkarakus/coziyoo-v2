# Nginx Proxy Manager Setup (coziyoo.com)

This project uses NPM as public ingress when `INGRESS_MODE=npm`.

## Required DNS A records

Point all records to your VPS public IP:

- `api.coziyoo.com`
- `admin.coziyoo.com`
- `livekit.coziyoo.com`
- `agent.coziyoo.com`

## NPM Proxy Hosts

Create these proxy hosts in NPM:

1. `api.coziyoo.com` -> `http://127.0.0.1:3000`
2. `admin.coziyoo.com` -> `http://127.0.0.1:8088` (or your admin upstream)
3. `livekit.coziyoo.com` -> `http://127.0.0.1:7880` (enable WebSocket support)
4. `agent.coziyoo.com` -> `http://127.0.0.1:8787`

For each host:

- Enable Let’s Encrypt SSL
- Enable Force SSL
- Enable HTTP/2

## Service-side requirements

- API binds to localhost (`127.0.0.1`) on port `3000`
- LiveKit binds to localhost on port `7880`
- Agent exposes health endpoint on `http://127.0.0.1:8787/health`
- Redis stays internal only

## Validation command

After DNS + NPM are ready:

```bash
bash installation/scripts/validate_npm_domains.sh
```
