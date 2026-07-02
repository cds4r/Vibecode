# AGENTS.md

## Cursor Cloud specific instructions

VibeVPN is a single Node.js service (ES modules) that serves the website, REST API, and (optionally) a Telegram bot from one process. There is no separate frontend build — static files live in `public/`.

### Run
- Dev server (hot reload): `npm run dev` (uses `node --watch`). Prod: `npm start`. Listens on `PORT` (default `3000`).
- Copy env once: `cp .env.example .env`. With no `.env`, the app still boots in demo mode (mock 3x-ui panel, demo pay, bot off, JSON storage).
- There are no lint or automated test scripts (`package.json` has only `start`/`dev`).

### Storage (JSON vs MySQL)
- Default storage is a JSON file at `data/db.json` (used whenever `DB_HOST` is empty). This is the out-of-the-box mode.
- If `DB_HOST` is set, the app uses MySQL/MariaDB via `mysql2` and auto-creates the `users`, `sessions`, `orders`, `subscriptions` tables on startup (visible in phpMyAdmin). Connection comes from `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME`.
- The `db` store API in `src/store.js` is fully async; `auth`, `provision`, `routes/api`, `bot` await it. Keep any new store calls awaited.
- To exercise the MySQL path in this cloud VM: MariaDB is installed but there is no systemd, so start it manually — `sudo mkdir -p /run/mysqld && sudo chown mysql:mysql /run/mysqld && sudo mariadbd --user=mysql &` — then run the server with `DB_HOST=127.0.0.1 DB_USER=... DB_PASSWORD=... DB_NAME=... node src/server.js`. (Do not add MariaDB to the update script; it is a system dependency and the JSON fallback keeps dev working without it.)

### Admin panel & moderation
- Admin UI is at `/admin/`. Log in via the "По ключу" tab using `ADMIN_KEY` from `.env` (the example value is `change-me-admin-key`), or via an account whose email is listed in `ADMIN_EMAILS`.
- Blocking a user (`POST /api/admin/users/:id/block`) ends their sessions, forbids login, and disables all their subscriptions; unblocking re-enables them. Disabling a subscription (`POST /api/admin/subscriptions/:token/disable`) marks it inactive and makes `/sub/:token` return 404. In non-mock mode both also toggle the client in the 3x-ui panel (best-effort via `xui.setClientEnabled`).

### Deploy
- `deploy/setup.sh` provisions the server (Node 20, systemd unit, and by default MariaDB + database; phpMyAdmin with `INSTALL_PHPMYADMIN=1`, skip DB with `SKIP_DB=1`). See `DEPLOY.md`.
