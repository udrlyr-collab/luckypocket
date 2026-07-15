#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
test -f .env.production
grep -q '^DOMAIN=market.wondering.kr$' .env.production
./deploy/backup.sh 2>/dev/null || true
if docker image inspect market-dominion-app:latest >/dev/null 2>&1; then
  docker tag market-dominion-app:latest market-dominion-app:rollback
elif docker image inspect market-dominion-api:latest >/dev/null 2>&1; then
  docker tag market-dominion-api:latest market-dominion-app:rollback
fi
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build postgres redis
docker compose --env-file .env.production -f docker-compose.prod.yml build migrate
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm migrate
docker compose --env-file .env.production -f docker-compose.prod.yml up -d api market-engine worker web
for i in $(seq 1 30); do curl -fsS http://127.0.0.1:4000/health >/dev/null 2>&1 && break; sleep 2; done
curl -fsS http://127.0.0.1:4000/health >/dev/null
for i in $(seq 1 30); do curl -fsS http://127.0.0.1:3000/ >/dev/null 2>&1 && break; sleep 2; done
curl -fsS http://127.0.0.1:3000/ >/dev/null
sudo nginx -t
sudo systemctl stop nginx
if ! docker compose --env-file .env.production -f docker-compose.prod.yml up -d --force-recreate caddy; then ./deploy/rollback.sh; exit 1; fi
for i in $(seq 1 45); do curl -fsS https://market.wondering.kr/health >/dev/null 2>&1 && break; sleep 2; done
if ! curl -fsS https://market.wondering.kr/health >/dev/null; then ./deploy/rollback.sh; exit 1; fi
curl -fsS https://gamble.wondering.kr/ >/dev/null || { ./deploy/rollback.sh; exit 1; }
curl -fsS https://letters.wondering.kr/ >/dev/null || { ./deploy/rollback.sh; exit 1; }
curl -fsS https://wondering.kr/ >/dev/null || { ./deploy/rollback.sh; exit 1; }
docker compose --env-file .env.production -f docker-compose.prod.yml ps
