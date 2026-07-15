#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
BASE_URL="${BASE_URL:-https://market.wondering.kr}"
CREDENTIALS_FILE="${CREDENTIALS_FILE:-./ADMIN_CREDENTIALS}"
test -f "$CREDENTIALS_FILE"
set -a
. "$CREDENTIALS_FILE"
set +a
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

call() {
  step="$1"; method="$2"; path="$3"; token="${4:-}"; body="${5:-}"
  if [ -n "$token" ] && [ -n "$body" ]; then
    status=$(curl -sS -o "$tmp/body" -w '%{http_code}' -X "$method" -H 'Content-Type: application/json' -H "Authorization: Bearer $token" --data "$body" "$BASE_URL$path")
  elif [ -n "$token" ]; then
    status=$(curl -sS -o "$tmp/body" -w '%{http_code}' -X "$method" -H "Authorization: Bearer $token" "$BASE_URL$path")
  elif [ -n "$body" ]; then
    status=$(curl -sS -o "$tmp/body" -w '%{http_code}' -X "$method" -H 'Content-Type: application/json' --data "$body" "$BASE_URL$path")
  else
    status=$(curl -sS -o "$tmp/body" -w '%{http_code}' -X "$method" "$BASE_URL$path")
  fi
  if [ "$status" -lt 200 ] || [ "$status" -ge 300 ]; then echo "FAIL $step HTTP $status"; sed -E 's/(accessToken|refreshToken|password)"[[:space:]]*:[[:space:]]*"[^"]+"/\1":"[REDACTED]"/g' "$tmp/body"; exit 1; fi
  cp "$tmp/body" "$tmp/$step.json"
  echo "PASS $step HTTP $status"
}

json() { python3 -c "import json; d=json.load(open('$1')); print($2)"; }
call admin_login POST /api/auth/login "" "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}"
admin_token=$(json "$tmp/admin_login.json" 'd["accessToken"]')
call admin_status GET /api/admin/status "$admin_token"

stamp=$(date +%s)
email="e2e-$stamp@example.com"; username="e2e$stamp"; password="E2E-Safe-$stamp-Aa9!"
call register POST /api/auth/register "" "{\"email\":\"$email\",\"username\":\"$username\",\"nickname\":\"E2E${stamp}\",\"password\":\"$password\"}"
user_token=$(json "$tmp/register.json" 'd["accessToken"]')
call stocks GET '/api/stocks?pageSize=1' ""
symbol="MD001"
call stock GET "/api/stocks/$symbol" ""
stock_id=$(json "$tmp/stock.json" 'd["id"]')
call buy POST /api/orders "$user_token" "{\"symbol\":\"$symbol\",\"idempotencyKey\":\"$(cat /proc/sys/kernel/random/uuid)\",\"side\":\"buy\",\"type\":\"market\",\"quantity\":\"1\",\"timeInForce\":\"GTC\"}"
buy_id=$(json "$tmp/buy.json" 'd["id"]')
buy_status="pending"
for _ in $(seq 1 30); do
  curl -fsS -H "Authorization: Bearer $user_token" "$BASE_URL/api/orders" > "$tmp/orders.json"
  buy_status=$(BUY_ID="$buy_id" python3 -c 'import json,os; rows=json.load(open("'$tmp'/orders.json")); print(next(x["status"] for x in rows if x["id"]==os.environ["BUY_ID"]))')
  [ "$buy_status" = "filled" ] && break
  [ "$buy_status" = "cancelled" ] || [ "$buy_status" = "rejected" ] && break
  sleep 2
done
[ "$buy_status" = "filled" ] || { echo "FAIL buy_fill status=$buy_status"; exit 1; }
echo "PASS buy_fill status=filled"
call portfolio GET /api/portfolio "$user_token"
call orderbook GET "/api/stocks/$symbol/order-book" ""
bid_price=$(json "$tmp/orderbook.json" 'd["bids"][0]["price"]')
call sell POST /api/orders "$user_token" "{\"symbol\":\"$symbol\",\"idempotencyKey\":\"$(cat /proc/sys/kernel/random/uuid)\",\"side\":\"sell\",\"type\":\"limit\",\"limitPrice\":\"$bid_price\",\"quantity\":\"1\",\"timeInForce\":\"GTC\"}"
call leverage_open POST /api/leverage/positions "$user_token" "{\"symbol\":\"$symbol\",\"side\":\"long\",\"leverage\":2,\"margin\":\"1000000\"}"
position_id=$(json "$tmp/leverage_open.json" 'd["id"]')
call leverage_close POST "/api/leverage/positions/$position_id/close" "$user_token" '{}'
definition='{"version":1,"when":{"mode":"all","conditions":[{"left":{"kind":"indicator","indicator":"ema","period":5},"operator":"gt","right":{"kind":"indicator","indicator":"ema","period":20}}]},"then":{"type":"buy","sizing":"percent_available_cash","valueBps":1000}}'
safety='{"initialCash":"100000000","feeBps":10,"slippageBps":20,"maxOrderAmount":"10000000","maxHoldingBps":3000,"dailyMaxLossBps":1000,"cooldownBars":1}'
call strategy POST /api/strategies "$user_token" "{\"name\":\"E2E $stamp\",\"stockId\":\"$stock_id\",\"interval\":\"1m\",\"definition\":$definition,\"safety\":$safety}"
call companies GET /api/companies ""
company_id=$(json "$tmp/companies.json" 'd[0]["id"]')
new_symbol="E2E$(echo "$stamp" | tail -c 7)"
call admin_stock POST /api/admin/stocks "$admin_token" "{\"companyId\":\"$company_id\",\"symbol\":\"$new_symbol\",\"totalShares\":\"1000\",\"freeFloatShares\":\"800\",\"currentPrice\":\"100\",\"tickSize\":\"1\"}"
created_stock_id=$(json "$tmp/admin_stock.json" 'd["id"]')
set -a
. ./.env.production
set +a
echo "$created_stock_id" | grep -Eq '^[0-9a-f-]{36}$'
docker exec market-dominion-postgres-1 psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "DELETE FROM stocks WHERE id='$created_stock_id'::uuid" >/dev/null
echo "PASS admin_stock_cleanup"
echo "PRODUCTION_E2E_PASS"
