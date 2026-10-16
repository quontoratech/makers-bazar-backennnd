# The Makers Bazar — Backend

Vendure API, background worker, PostgreSQL migrations, marketplace plugins, Socket.IO chat, email templates, and backend contracts.

## Requirements

- Node.js 22.12 or newer
- Bun 1.3 or newer
- PostgreSQL for production

## Local setup

```bash
bun install
cp .env.example apps/api/.env
```

For local SQLite development, set `APP_ENV=dev`, `DB=sqlite`, and `DB_PATH=./data/marketplace.sqlite` in `apps/api/.env`.

Run the API and worker in separate terminals:

```bash
bun run dev
bun run dev:worker
```

## Production

Configure all required values from `.env.example`, then run:

```bash
bun install --frozen-lockfile
bun run build
bun run start
bun run start:worker
```

The API and worker are separate long-running processes. Both must use the same production environment and PostgreSQL database.

Frontend code and public storefront assets belong in the separate frontend repository.
