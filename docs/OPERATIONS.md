# MARKET DOMINION 운영 절차

운영 URL은 `https://market.wondering.kr`, SSH 계정은 `ubuntu`, 배포 경로는 `/home/ubuntu/market-dominion`이다. 비밀값은 서버의 `.env.production`과 `ADMIN_CREDENTIALS`에만 두며 두 파일의 권한은 `600`이다.

## 배포

Windows 작업 공간에서 전송하고 서버 배포 스크립트를 실행한다.

```powershell
.\deploy\windows-deploy.ps1 -HostName 13.124.197.230 -User ubuntu -KeyPath <SSH_KEY_PATH>
```

```sh
cd /home/ubuntu/market-dominion
./deploy/deploy.sh
```

배포 스크립트는 먼저 PostgreSQL dump를 만들고 현재 앱 이미지를 `market-dominion-app:rollback`으로 보존한다. 이어 PostgreSQL·Redis 시작, migration, 공용 앱 이미지 빌드, API·엔진·worker·web 기동, 내부 health, Caddy 강제 재생성, HTTPS와 기존 도메인 smoke를 순서대로 검사한다.

## 상태 확인

```sh
cd /home/ubuntu/market-dominion
docker compose --env-file .env.production -f docker-compose.prod.yml ps
curl -fsS https://market.wondering.kr/health
curl -fsS https://market.wondering.kr/health/db
curl -fsS https://market.wondering.kr/health/redis
curl -fsS https://market.wondering.kr/health/market-engine
curl -fsS https://market.wondering.kr/api/health
```

관리자 계정은 서버에서만 확인한다. 채팅이나 로그에 값을 복사하지 않는다.

```sh
sudo cat /home/ubuntu/market-dominion/ADMIN_CREDENTIALS
```

## 백업과 복구

```sh
cd /home/ubuntu/market-dominion
./deploy/backup.sh
```

복구 전 현재 DB를 다시 백업하고 앱 쓰기를 중단한다. `<DUMP_FILE>`은 검증한 dump로 교체한다.

```sh
docker compose --env-file .env.production -f docker-compose.prod.yml stop api market-engine worker web
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres sh -c 'dropdb -U "$POSTGRES_USER" "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < <DUMP_FILE>
docker compose --env-file .env.production -f docker-compose.prod.yml up -d api market-engine worker web caddy
```

## 롤백

```sh
cd /home/ubuntu/market-dominion
./deploy/rollback.sh
```

스크립트는 `market-dominion-app:rollback`을 `latest`로 되돌리고 앱 4개를 강제 재생성한 뒤 API와 web health를 검사한다. 보존 이미지가 없을 때만 Caddy를 중지하고 기존 nginx proxy를 복구한다.

## 로그와 자원

```sh
docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail=200 api market-engine worker web caddy
docker stats --no-stream
free -h
df -h /
```

Docker 로그는 `json-file` rotation(파일당 10 MB, 최대 5개)을 사용한다. 비밀번호와 토큰은 출력하거나 저장하지 않는다.
