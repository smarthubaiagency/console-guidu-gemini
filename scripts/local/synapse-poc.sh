#!/bin/bash
# PROVA DE CONCEITO (IN1, docs/modules/inbox/prova-de-conceito.md): Synapse
# local, descartável, para testar a ADR 0023. Não é a instalação de dev nem
# de produção (essa é docs/operacao/synapse-easypanel.md).
#
# Synapse por pip (sem Docker), SQLite, server_name dev.guidu.chat (só nome,
# sem DNS), 127.0.0.1:8108, sem federação, sem cadastro aberto, sem E2EE por
# padrão, login JWT e o Application Service do núcleo (@_guidu_.*).
#
# Uso:
#   SYNAPSE_POC_DIR=/caminho bash scripts/local/synapse-poc.sh setup   # venv, config, segredos
#   SYNAPSE_POC_DIR=/caminho bash scripts/local/synapse-poc.sh start   # sobe em segundo plano
#   SYNAPSE_POC_DIR=/caminho bash scripts/local/synapse-poc.sh stop
#   SYNAPSE_POC_DIR=/caminho bash scripts/local/synapse-poc.sh reset   # apaga dados e config
#
# O setup grava $SYNAPSE_POC_DIR/poc.env com os segredos locais (hs_token,
# as_token, segredo do JWT, registration_shared_secret). O app e os scripts
# da prova leem esse arquivo; nada vai para o repositório.
#
# APP_POC_URL: endereço do app Next que recebe as transações do AS
# (padrão http://127.0.0.1:3400).
set -euo pipefail
DIR="${SYNAPSE_POC_DIR:-/tmp/guidu-synapse-poc}"
VENV="$DIR/synapse-venv"
DATA="$DIR/synapse-data"
APP="${APP_POC_URL:-http://127.0.0.1:3400}"
PORT="${SYNAPSE_POC_PORT:-8108}"
VERSION="1.163.0"

secret() { python3 -c "import secrets; print(secrets.token_urlsafe(32))"; }

setup() {
  mkdir -p "$DATA"
  if [ ! -x "$VENV/bin/python" ]; then
    python3 -m venv "$VENV"
    "$VENV/bin/pip" install -q "matrix-synapse[jwt]==$VERSION"
  fi
  if [ ! -f "$DIR/poc.env" ]; then
    cat >"$DIR/poc.env" <<EOF
MATRIX_HOMESERVER_URL=http://127.0.0.1:$PORT
MATRIX_SERVER_NAME=dev.guidu.chat
MATRIX_AS_TOKEN=$(secret)
MATRIX_HS_TOKEN=$(secret)
MATRIX_AS_SENDER=_guidu_core
MATRIX_JWT_SECRET=$(secret)
MATRIX_JWT_ISSUER=guidu-console-dev
MATRIX_JWT_AUDIENCE=guidu-matrix-dev
MATRIX_REGISTRATION_SHARED_SECRET=$(secret)
EOF
  fi
  # shellcheck disable=SC1091
  set -a; . "$DIR/poc.env"; set +a
  if [ ! -f "$DATA/dev.guidu.chat.signing.key" ]; then
    (cd "$DATA" && "$VENV/bin/python" -m synapse.app.homeserver \
      --server-name dev.guidu.chat --config-path generated.yaml \
      --generate-config --report-stats=no >/dev/null)
  fi
  cat >"$DATA/guidu-as.yaml" <<EOF
# Application Service do núcleo (ADR 0023, regra 8).
id: guidu-core
url: "$APP/api/matrix/as"
as_token: "$MATRIX_AS_TOKEN"
hs_token: "$MATRIX_HS_TOKEN"
sender_localpart: "$MATRIX_AS_SENDER"
rate_limited: false
namespaces:
  users:
    - exclusive: true
      regex: "@_guidu_.*:dev\\\\.guidu\\\\.chat"
  aliases:
    - exclusive: true
      regex: "#_guidu_.*:dev\\\\.guidu\\\\.chat"
  rooms: []
EOF
  cat >"$DATA/homeserver.yaml" <<EOF
server_name: "dev.guidu.chat"
public_baseurl: "http://127.0.0.1:$PORT/"
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
  name: sqlite3
  args:
    database: "$DATA/homeserver.db"
log_config: "$DATA/dev.guidu.chat.log.config"
media_store_path: "$DATA/media_store"
signing_key_path: "$DATA/dev.guidu.chat.signing.key"
report_stats: false
macaroon_secret_key: "$(secret)"
form_secret: "$(secret)"
registration_shared_secret: "$MATRIX_REGISTRATION_SHARED_SECRET"
# Fechado: sem federação (lista vazia), sem cadastro aberto, sem servidores de chaves.
federation_domain_whitelist: []
trusted_key_servers: []
enable_registration: false
# Sem E2EE nas salas novas (ADR 0023, regra 3).
encryption_enabled_by_default_for_room_type: "off"
# Login do atendente com JWT curto emitido pelo console (ADR 0023, regra 9).
jwt_config:
  enabled: true
  secret: "$MATRIX_JWT_SECRET"
  algorithm: "HS256"
  issuer: "$MATRIX_JWT_ISSUER"
  audiences: ["$MATRIX_JWT_AUDIENCE"]
  subject_claim: "sub"
  display_name_claim: "name"
password_config:
  enabled: false
app_service_config_files:
  - "$DATA/guidu-as.yaml"
# Limites folgados só para a prova criar 300 salas e entradas em sequência.
rc_joins:
  local: {per_second: 1000, burst_count: 1000}
rc_invites:
  per_room: {per_second: 1000, burst_count: 1000}
  per_user: {per_second: 1000, burst_count: 1000}
rc_room_creation: {per_second: 1000, burst_count: 1000}
rc_message: {per_second: 1000, burst_count: 1000}
# O padrão é 5 logins seguidos e depois 1 a cada ~5,5 min, por IP e por
# conta: cada carga da tela crua faz um login JWT e estoura isso (ver o
# relatório, item 2).
rc_login:
  address: {per_second: 1, burst_count: 30}
  account: {per_second: 1, burst_count: 30}
EOF
  echo "setup ok em $DIR (segredos em $DIR/poc.env)"
}

start() {
  (cd "$DATA" && "$VENV/bin/python" -m synapse.app.homeserver \
    --config-path homeserver.yaml --daemonize)
  for _ in $(seq 1 60); do
    curl -fsS "http://127.0.0.1:$PORT/_matrix/client/versions" >/dev/null 2>&1 && { echo "synapse no ar em :$PORT"; return 0; }
    sleep 0.5
  done
  echo "synapse não respondeu; veja $DATA/homeserver.log"; exit 1
}

stop() {
  if [ -f "$DATA/homeserver.pid" ]; then kill "$(cat "$DATA/homeserver.pid")" && echo "synapse parado"; fi
}

case "${1:-}" in
  setup) setup ;;
  start) start ;;
  stop) stop ;;
  reset) stop || true; rm -rf "$DATA" "$DIR/poc.env"; echo "dados apagados" ;;
  *) sed -n 2,20p "$0"; exit 1 ;;
esac
