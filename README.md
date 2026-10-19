# The Makers Bazar — Backend

Vendure API, background worker, PostgreSQL migrations, marketplace plugins, Socket.IO chat, email templates, and backend contracts.

## Requirements

- Node.js 22.12 or newer
- npm 10 or newer
- PostgreSQL for multi-instance production, or persistent SQLite for a single-instance deployment

## Local setup

```bash
npm install
cp .env.example apps/api/.env
```

For local SQLite development, set `APP_ENV=dev`, `DB=sqlite`, and `DB_PATH=./data/marketplace.sqlite` in `apps/api/.env`.

Run the API and worker in separate terminals:

```bash
npm run dev
npm run dev:worker
```

## Production

Configure all required values from `.env.example`, then run:

```bash
npm ci
npm run build
npm run start
```

The production entry point supervises both the Vendure API and worker. On Hostinger, use Node.js 22, run `npm run build`, and start `apps/api/dist/production.js`. Keep the SQLite database and uploaded files outside the deployment directory using the paths documented in `.env.example`, so a redeployment cannot replace live data.

Frontend code and public storefront assets belong in the separate frontend repository.
