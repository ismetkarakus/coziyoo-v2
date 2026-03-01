# Nginx Proxy Manager Setup

This project uses NPM as public ingress.

## Required DNS A records

Point all records to your VPS public IP:

- `api.YOURDOMAIN.com`
- `admin.YOURDOMAIN.com`

## NPM Proxy Hosts

Create these proxy hosts in NPM:

1. `api.YOURDOMAIN.com` -> `http://127.0.0.1:3000`
2. `admin.YOURDOMAIN.com` -> `http://127.0.0.1:8000`

For each host:

- Enable Let's Encrypt SSL
- Enable Force SSL
- Enable HTTP/2

## Service-side requirements

- API binds to localhost (`127.0.0.1`) on port `3000`

## Validation command

After DNS + NPM are ready:

```bash
bash installation/scripts/validate_npm_domains.sh
```
