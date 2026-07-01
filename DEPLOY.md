# Деплой VibeVPN на Ubuntu-сервер

Инструкция для Ubuntu 22.04/24.04 (VPS). Приложение — это Node.js-сервер, который отдаёт сайт + API и запускает Telegram-бота в том же процессе. Обычно ставится на тот же VPS, где работает панель **3x-ui**.

Порт по умолчанию — `3000`, снаружи он закрывается за Nginx с HTTPS.

---

## Быстрый способ (скрипт)

```bash
ssh root@ВАШ_СЕРВЕР
git clone https://github.com/cds4r/Vibecode.git /tmp/vibevpn && cd /tmp/vibevpn
sudo bash deploy/setup.sh
```

Скрипт установит Node.js 20, создаст пользователя `vibevpn`, склонирует проект в `/opt/vibevpn`, поставит зависимости и systemd-сервис. После этого отредактируйте `.env` и настройте Nginx (шаги 5–6 ниже).

---

## Ручная установка (по шагам)

### 1. Node.js 20 LTS
```bash
sudo apt update && sudo apt install -y ca-certificates curl gnupg git
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | sudo tee /etc/apt/sources.list.d/nodesource.list
sudo apt update && sudo apt install -y nodejs
node -v   # v20.x
```

### 2. Пользователь и код
```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin vibevpn
sudo git clone https://github.com/cds4r/Vibecode.git /opt/vibevpn
cd /opt/vibevpn
sudo npm ci --omit=dev
sudo mkdir -p data
```

### 3. Настройки `.env`
```bash
sudo cp .env.example .env
sudo nano .env
```
Заполните для боевого режима:
```
PORT=3000
PUBLIC_URL=https://vpn.example.com
BRAND_NAME=VibeVPN
ALLOW_MOCK_PAY=false            # выключить демо-оплату в проде
ADMIN_KEY=длинный-случайный-ключ

PANEL_URL=https://ваш-домен:2053
PANEL_USERNAME=admin
PANEL_PASSWORD=пароль
PANEL_INBOUND_ID=1
NODE_HOST=vpn.example.com
SUB_BASE_URL=https://ваш-домен:2096/sub

BOT_TOKEN=токен_от_BotFather
BOT_PAYMENT=stars
ADMIN_TELEGRAM_IDS=ваш_tg_id
```
Права на каталог:
```bash
sudo chown -R vibevpn:vibevpn /opt/vibevpn
```

### 4. systemd-сервис (автозапуск + рестарт)
```bash
sudo cp /opt/vibevpn/deploy/vibevpn.service /etc/systemd/system/vibevpn.service
sudo systemctl daemon-reload
sudo systemctl enable --now vibevpn
sudo systemctl status vibevpn          # должно быть active (running)
sudo journalctl -u vibevpn -f          # логи в реальном времени
```
Проверка локально: `curl -I http://127.0.0.1:3000` → `200 OK`.

### 5. Nginx (reverse proxy)
```bash
sudo apt install -y nginx
sudo cp /opt/vibevpn/deploy/nginx.conf.example /etc/nginx/sites-available/vibevpn
sudo nano /etc/nginx/sites-available/vibevpn   # заменить vpn.example.com на свой домен
sudo ln -s /etc/nginx/sites-available/vibevpn /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```
Домен `vpn.example.com` заранее направьте A-записью на IP сервера.

### 6. HTTPS (Let's Encrypt)
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d vpn.example.com
```
Certbot сам добавит TLS и редирект с HTTP. Автопродление уже настроено (`certbot.timer`).

### 7. Файрвол
```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'   # 80 + 443
# порт 3000 наружу НЕ открываем — он только за Nginx
sudo ufw enable
```

---

## Обновление до новой версии
```bash
cd /opt/vibevpn
sudo -u vibevpn git pull
sudo npm ci --omit=dev
sudo systemctl restart vibevpn
```

## Резервная копия данных
Все заказы/подписки/пользователи лежат в одном файле:
```bash
sudo cp /opt/vibevpn/data/db.json ~/vibevpn-backup-$(date +%F).json
```
Достаточно бэкапить `data/db.json` (и `.env` с секретами) по расписанию (cron).

---

## Проверка после деплоя
- Сайт: `https://vpn.example.com` — открываются тарифы.
- Кабинет: кнопка «Кабинет» → регистрация/вход работает.
- Админка: `https://vpn.example.com/admin/` → вход по `ADMIN_KEY`.
- Бот: напишите ему `/start` в Telegram — приходит меню.
- Покупка: оформите тариф → приходит ключ; в 3x-ui появляется новый клиент в инбаунде `PANEL_INBOUND_ID`.

## Частые проблемы
- **Сервис не стартует** — смотрите `sudo journalctl -u vibevpn -n 50`. Обычно причина в `.env`.
- **502 в Nginx** — приложение не слушает порт: проверьте `systemctl status vibevpn` и `PORT`.
- **Ключи «демо»** — не задан `PANEL_URL` (работает mock-режим). Заполните доступ к панели.
- **Бот не отвечает** — неверный `BOT_TOKEN` или бот уже запущен в другом месте (long polling конфликтует).
- **3x-ui login failed** — проверьте `PANEL_URL` (с портом, без `/`), логин/пароль и что путь панели стандартный.

## Альтернатива systemd — PM2
```bash
sudo npm i -g pm2
cd /opt/vibevpn
pm2 start src/server.js --name vibevpn
pm2 save && pm2 startup    # выполните подсказанную команду
```
