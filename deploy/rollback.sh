#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if docker image inspect market-dominion-app:rollback >/dev/null 2>&1; then
  docker tag market-dominion-app:rollback market-dominion-app:latest
  docker compose --env-file .env.production -f docker-compose.prod.yml up -d --force-recreate api market-engine worker web
  for i in $(seq 1 30); do curl -fsS http://127.0.0.1:4000/health >/dev/null 2>&1 && curl -fsS http://127.0.0.1:3000/ >/dev/null 2>&1 && break; sleep 2; done
  curl -fsS http://127.0.0.1:4000/health >/dev/null
  curl -fsS http://127.0.0.1:3000/ >/dev/null
  docker compose --env-file .env.production -f docker-compose.prod.yml up -d caddy
  echo "application image rollback active"
else
  docker compose --env-file .env.production -f docker-compose.prod.yml stop caddy || true
  sudo systemctl start nginx
  sudo nginx -t
  curl -fsS --max-time 10 https://gamble.wondering.kr/ >/dev/null
  echo "proxy rollback active; no prior application image was available"
fi
