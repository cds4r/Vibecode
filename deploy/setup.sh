#!/usr/bin/env bash
# Установка VibeVPN на чистый Ubuntu-сервер (22.04/24.04).
# Запуск от root:  sudo bash deploy/setup.sh
# Скрипт идемпотентный — можно запускать повторно.
set -euo pipefail

APP_DIR="/opt/vibevpn"
APP_USER="vibevpn"
REPO_URL="${REPO_URL:-https://github.com/cds4r/Vibecode.git}"
NODE_MAJOR="20"

log() { echo -e "\n\033[1;36m==>\033[0m $*"; }

if [[ $EUID -ne 0 ]]; then echo "Запустите через sudo/root"; exit 1; fi

log "Устанавливаем зависимости системы"
apt-get update -y
apt-get install -y ca-certificates curl gnupg git

if ! command -v node >/dev/null || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt "$NODE_MAJOR" ]]; then
  log "Устанавливаем Node.js ${NODE_MAJOR} LTS (NodeSource)"
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update -y
  apt-get install -y nodejs
fi
log "Node: $(node -v), npm: $(npm -v)"

if ! id "$APP_USER" >/dev/null 2>&1; then
  log "Создаём системного пользователя $APP_USER"
  useradd --system --create-home --home-dir "/home/$APP_USER" --shell /usr/sbin/nologin "$APP_USER"
fi

if [[ -d "$APP_DIR/.git" ]]; then
  log "Обновляем репозиторий в $APP_DIR"
  git -C "$APP_DIR" pull --ff-only
else
  log "Клонируем репозиторий в $APP_DIR"
  git clone "$REPO_URL" "$APP_DIR"
fi

log "Устанавливаем npm-зависимости (prod)"
cd "$APP_DIR"
npm ci --omit=dev || npm install --omit=dev

mkdir -p "$APP_DIR/data"

if [[ ! -f "$APP_DIR/.env" ]]; then
  log "Создаём .env из шаблона — ОТРЕДАКТИРУЙТЕ его после установки!"
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
fi

chown -R "$APP_USER:$APP_USER" "$APP_DIR"

log "Устанавливаем systemd-сервис"
cp "$APP_DIR/deploy/vibevpn.service" /etc/systemd/system/vibevpn.service
systemctl daemon-reload
systemctl enable vibevpn
systemctl restart vibevpn

log "Готово. Дальше:"
cat <<EOF
  1. Отредактируйте настройки:   sudo nano $APP_DIR/.env
     (адрес панели 3x-ui, токен бота, ADMIN_KEY, ALLOW_MOCK_PAY=false и т.д.)
  2. Перезапустите сервис:        sudo systemctl restart vibevpn
  3. Логи:                        sudo journalctl -u vibevpn -f
  4. Проксирование + HTTPS:       см. deploy/nginx.conf.example и DEPLOY.md
EOF
