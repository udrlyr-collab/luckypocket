#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p backups
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres sh -c 'pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB"' > "backups/market-dominion-$stamp.dump"
find backups -type f -name 'market-dominion-*.dump' -mtime +14 -delete
echo "backups/market-dominion-$stamp.dump"
