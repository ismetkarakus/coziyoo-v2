# VPS Installation and Deployment (No Docker)

This folder contains a fast deployment setup for a single VPS:

- `admin panel` served by Nginx as static files
- `postgres` as a system service
- `api` as a FastAPI `systemd` service
- `agent` as its own `systemd` service

## Folder layout

- `scripts/bootstrap_vps.sh`: one-time base package setup
- `scripts/deploy_admin.sh`: build and publish admin static files
- `scripts/deploy_api.sh`: pull latest API code and restart API service
- `scripts/deploy_agent.sh`: pull latest agent code and restart agent service
- `systemd/coziyoo-api.service`: FastAPI service template
- `systemd/coziyoo-agent.service`: Agent service template
- `nginx/coziyoo.conf`: Nginx site template
- `github-actions/vps-deploy.yml`: CI/CD example over SSH

## 1) First-time server setup

Run on VPS as root:

```bash
bash installation/scripts/bootstrap_vps.sh
```

Then install PostgreSQL if not already installed:

```bash
apt install -y postgresql postgresql-contrib
systemctl enable postgresql
systemctl start postgresql
```

## 2) App directories on VPS

Suggested:

```bash
/opt/coziyoo/api
/opt/coziyoo/agent
/var/www/coziyoo-admin
```

Clone your repo to `/opt/coziyoo` or each app directory.

## 3) Configure systemd services

Copy and edit templates:

```bash
cp installation/systemd/coziyoo-api.service /etc/systemd/system/
cp installation/systemd/coziyoo-agent.service /etc/systemd/system/
```

Update these fields in both files:

- `WorkingDirectory`
- `EnvironmentFile`
- `ExecStart`
- `User` and `Group`

Then:

```bash
systemctl daemon-reload
systemctl enable coziyoo-api coziyoo-agent
systemctl start coziyoo-api coziyoo-agent
systemctl status coziyoo-api coziyoo-agent
```

## 4) Configure Nginx

```bash
cp installation/nginx/coziyoo.conf /etc/nginx/sites-available/coziyoo.conf
ln -sf /etc/nginx/sites-available/coziyoo.conf /etc/nginx/sites-enabled/coziyoo.conf
nginx -t
systemctl reload nginx
```

Set domain names in `server_name` and update upstream ports if needed.

## 5) Deploy workflow

- Push to GitHub
- GitHub Actions SSHs to VPS
- Pull latest code
- Install/update dependencies
- Restart only changed services

Use `installation/github-actions/vps-deploy.yml` as a starter workflow.

## 6) Useful commands

```bash
journalctl -u coziyoo-api -f
journalctl -u coziyoo-agent -f
systemctl restart coziyoo-api
systemctl restart coziyoo-agent
```

This avoids Docker image builds and usually deploys in seconds to a couple of minutes.
