# STD Plus — Server

Backend API server for STD Plus.

## Tech Stack

- Node.js + Express 5
- Zod for validation
- Helmet, CORS, rate limiting

## Setup

```bash
npm install
cp .env.example .env
```

## Run

```bash
# Development
npm run dev

# Production
npm start
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | Environment mode |
| `PORT` | `3000` | Server port |
| `CORS_ORIGIN` | `*` | Allowed CORS origin |
| `RATE_LIMIT_WINDOW_MS` | `900000` | Rate limit window (ms) |
| `RATE_LIMIT_MAX` | `100` | Max requests per window |

## API

All routes are prefixed with `/api`.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Health check |
