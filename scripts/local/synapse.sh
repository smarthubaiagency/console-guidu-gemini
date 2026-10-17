#!/bin/bash
# Synapse LOCAL e descartável para os testes do núcleo Matrix (IN3, ADR 0023).
# Não é o servidor de dev nem o de produção (esses seguem
# docs/operacao/synapse-easypanel.md). Sem Docker: Synapse por pip num venv,
# em Postgres (o servidor local da porta 54333 de scripts/local/rebuild-db.sh,
# ou o do CI), sem federação, sem cadastro, sem login por senha e sem E2EE
# por padrão. A configuração do console sai de scripts/matrix/setup.ts
# generate, como no servidor de verdade (AS, JWT RS256, rc_login, presença).
#
# Uso:
#   bash scripts/local/synapse.sh setup   # venv, banco, segredos e config
#   bash scripts/local/synapse.sh start   # sobe em segundo plano (e promove o núcleo a admin)
#   bash scripts/local/synapse.sh env     # imprime os `export` para os testes
#   bash scripts/local/synapse.sh stop
#   bash scripts/local/synapse.sh reset   # para, apaga o banco e o diretório
#
# Portas pelo E2E_PORT_OFFSET (dois worktrees em paralelo): Synapse em
# 8008+offset; o Application Service aponta para 8009+offset, onde o teste
# de integração sobe um servidor com a rota do AS (SYNAPSE_APP_URL troca,
# por exemplo para o `pnpm dev` em 3000+offset).
#
# Variáveis (todas opcionais):
#   SYNAPSE_DIR        diretório descartável (padrão /var/tmp/guidu-synapse-<banco>)
#   SYNAPSE_VENV       venv a reaproveitar (padrão $SYNAPSE_DIR/venv)
#   SYNAPSE_DB_NAME    banco do Synapse (padrão: LOCAL_DB_NAME com guidu→synapse)
#   SYNAPSE_PG_HOST, SYNAPSE_PG_PORT, SYNAPSE_PG_USER, SYNAPSE_PG_PASSWORD
#                      Postgres (padrão 127.0.0.1, 54333, postgres, sem senha)
#   SYNAPSE_SERVER_NAME server_name (padrão matrix.guidu.test; só nome, sem DNS)
#   SYNAPSE_APP_URL    endereço que recebe as transações do AS
set -euo pipefail
cd "$(dirname "$0")/../.."

VERSION="1.163.0"
PSYCOPG_VERSION="2.9.10"
LOCAL_DB="${LOCAL_DB_NAME:-guidu}"
DB_NAME="${SYNAPSE_DB_NAME:-${LOCAL_DB/guidu/synapse}}"
[[ "$DB_NAME" =~ ^[a-z_][a-z0-9_]*$ ]] || { echo "SYNAPSE_DB_NAME inválido: $DB_NAME"; exit 1; }
DIR="${SYNAPSE_DIR:-/var/tmp/guidu-synapse-$LOCAL_DB}"
VENV="${SYNAPSE_VENV:-$DIR/venv}"
DATA="$DIR/data"
SETUP="$DIR/setup"
OFFSET="${E2E_PORT_OFFSET:-0}"
PORT=$((8008 + OFFSET))
AS_PORT=$((8009 + OFFSET))
APP="${SYNAPSE_APP_URL:-http://127.0.0.1:$AS_PORT}"
SERVER_NAME="${SYNAPSE_SERVER_NAME:-matrix.guidu.test}"
PG_HOST="${SYNAPSE_PG_HOST:-127.0.0.1}"
PG_PORT="${SYNAPSE_PG_PORT:-54333}"
PG_USER="${SYNAPSE_PG_USER:-postgres}"
PG_PASSWORD="${SYNAPSE_PG_PASSWORD:-}"
BASE="http://127.0.0.1:$PORT"

pg() { PGPASSWORD="$PG_PASSWORD" psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -v ON_ERROR_STOP=1 -qAt "$@"; }
secret() { python3 -c "import secrets; print(secrets.token_urlsafe(32))"; }
running() { [ -f "$DATA/homeserver.pid" ] && kill -0 "$(cat "$DATA/homeserver.pid")" 2>/dev/null; }

setup() {
  mkdir -p "$DATA"
  if [ ! -x "$VENV/bin/python" ]; then python3 -m venv "$VENV"; fi
  if ! "$VENV/bin/python" -c "import synapse, psycopg2, authlib" 2>/dev/null; then
    "$VENV/bin/pip" install -q "matrix-synapse[jwt]==$VERSION" "psycopg2-binary==$PSYCOPG_VERSION"
  fi
  # Synapse exige UTF8 e collation C.
  if [ "$(pg -d postgres -c "select 1 from pg_database where datname = '$DB_NAME'")" != "1" ]; then
    pg -d postgres -c "create database $DB_NAME encoding 'UTF8' lc_collate 'C' lc_ctype 'C' template template0"
  fi
  # Segredos novos a cada setup (descartáveis), gerados como no servidor real.
  pnpm -s tsx scripts/matrix/setup.ts generate --server-name "$SERVER_NAME" \
    --homeserver-url "$BASE" --app-url "$APP" --out "$SETUP" --force >/dev/null
  cat >"$DATA/log.config" <<EOF
version: 1
formatters:
  precise:
    format: '%(asctime)s - %(name)s - %(lineno)d - %(levelname)s - %(request)s - %(message)s'
handlers:
  file:
    class: logging.FileHandler
    formatter: precise
    filename: $DATA/homeserver.log
root:
  level: WARNING
  handlers: [file]
disable_existing_loggers: false
EOF
  {
    cat <<EOF
server_name: "$SERVER_NAME"
public_baseurl: "$BASE/"
pid_file: "$DATA/homeserver.pid"
listeners:
  - port: $PORT
    bind_addresses: ["127.0.0.1"]
    type: http
    tls: false
    x_forwarded: false
    resources:
      - names: [client]
        compress: false
database:
  name: psycopg2
  args:
    user: "$PG_USER"
    password: "$PG_PASSWORD"
    dbname: "$DB_NAME"
    host: "$PG_HOST"
    port: $PG_PORT
    cp_min: 2
    cp_max: 5
log_config: "$DATA/log.config"
media_store_path: "$DATA/media_store"
signing_key_path: "$DATA/signing.key"
report_stats: false
macaroon_secret_key: "$(secret)"
form_secret: "$(secret)"
# Fechado: sem federação, sem cadastro aberto, sem senha (como o servidor real
# depois do bootstrap).
federation_domain_whitelist: []
trusted_key_servers: []
enable_registration: false
password_config:
  enabled: false
# Limites folgados para os testes criarem salas e entradas em sequência.
rc_joins:
  local: {per_second: 1000, burst_count: 1000}
rc_invites:
  per_room: {per_second: 1000, burst_count: 1000}
  per_user: {per_second: 1000, burst_count: 1000}
rc_room_creation: {per_second: 1000, burst_count: 1000}
rc_message: {per_second: 1000, burst_count: 1000}
rc_admin_redaction: {per_second: 1000, burst_count: 1000}
EOF
    # Os mesmos blocos que o guia manda acrescentar ao servidor real.
    sed "s|/data/guidu-as.yaml|$SETUP/guidu-as.yaml|" "$SETUP/homeserver-snippet.yaml"
  } >"$DATA/homeserver.yaml"
  if [ ! -f "$DATA/signing.key" ]; then
    (cd "$DATA" && "$VENV/bin/python" -m synapse.app.homeserver --config-path homeserver.yaml --generate-keys >/dev/null)
  fi
  rm -f "$DATA/promoted"
  echo "setup ok em $DIR (Synapse em $BASE, banco $DB_NAME, AS para $APP)"
}

start() {
  [ -f "$DATA/homeserver.yaml" ] || { echo "rode o setup antes"; exit 1; }
  if ! running; then
    (cd "$DATA" && "$VENV/bin/python" -m synapse.app.homeserver --config-path homeserver.yaml --daemonize)
  fi
  for _ in $(seq 1 120); do
    curl -fsS "$BASE/_matrix/client/versions" >/dev/null 2>&1 && break
    sleep 0.5
  done
  curl -fsS "$BASE/_matrix/client/versions" >/dev/null || { echo "Synapse não respondeu; veja $DATA/homeserver.log"; exit 1; }
  if [ ! -f "$DATA/promoted" ]; then
    # O remetente do AS vira admin uma vez (no servidor real, setup.ts promote).
    # shellcheck disable=SC1091
    set -a; . "$SETUP/console.env"; set +a
    curl -sS -o /dev/null -X POST "$BASE/_matrix/client/v3/register" \
      -H "authorization: Bearer $MATRIX_AS_TOKEN" -H "content-type: application/json" \
      -d "{\"type\":\"m.login.application_service\",\"username\":\"$MATRIX_AS_SENDER\",\"inhibit_login\":true}"
    pg -d "$DB_NAME" -c "update users set admin = 1 where name = '@$MATRIX_AS_SENDER:$SERVER_NAME'"
    # O Synapse guarda a condição de admin em cache: reinicia uma vez.
    stop >/dev/null
    (cd "$DATA" && "$VENV/bin/python" -m synapse.app.homeserver --config-path homeserver.yaml --daemonize)
    for _ in $(seq 1 120); do
      curl -fsS "$BASE/_matrix/client/versions" >/dev/null 2>&1 && break
      sleep 0.5
    done
    touch "$DATA/promoted"
  fi
  echo "Synapse no ar em $BASE"
}

stop() {
  if running; then
    kill "$(cat "$DATA/homeserver.pid")"
    for _ in $(seq 1 40); do running || break; sleep 0.25; done
    echo "Synapse parado"
  fi
}

print_env() {
  [ -f "$SETUP/console.env" ] || { echo "rode o setup antes" >&2; exit 1; }
  # O teste de integração lê o arquivo; o resto da suíte não vê o Matrix.
  echo "export MATRIX_TEST_ENV_FILE=$SETUP/console.env"
  echo "export MATRIX_TEST_AS_PORT=$AS_PORT"
}

case "${1:-}" in
  setup) setup ;;
  start) start ;;
  stop) stop ;;
  env) print_env ;;
  reset)
    stop || true
    pg -d postgres -c "drop database if exists $DB_NAME" || true
    rm -rf "$DATA" "$SETUP"
    echo "Synapse local apagado ($DIR, banco $DB_NAME)"
    ;;
  *) sed -n 2,30p "$0"; exit 1 ;;
esac
