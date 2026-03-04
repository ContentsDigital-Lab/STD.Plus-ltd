# STD Plus — Server

Backend API server for STD Plus.

## Tech Stack

- Node.js + Express 5
- MongoDB + Mongoose
- JWT Authentication (Bearer Token)
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
| `MONGODB_URI` | — | MongoDB connection string |
| `JWT_SECRET` | — | Secret key for signing JWTs |
| `JWT_EXPIRES_IN` | `7d` | JWT expiration time |

## API

Base URL: `/api`

### Authentication

This API uses Bearer Token JWT.
All protected routes require: `Authorization: Bearer <token>`

### Auth

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/login` | Public | Login with username + password |
| `POST` | `/api/auth/logout` | Protected | Logout |
| `GET` | `/api/auth/me` | Protected | Get current worker |
| `PATCH` | `/api/auth/me` | Protected | Update own profile |

### Workers

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/workers` | Protected | List all workers |
| `GET` | `/api/workers/:id` | Protected | Get worker by ID |
| `POST` | `/api/workers` | Protected | Create a worker |
| `PATCH` | `/api/workers/:id` | Protected | Update a worker |
| `DELETE` | `/api/workers` | Protected | Delete multiple workers |
| `DELETE` | `/api/workers/:id` | Protected | Delete a worker |

### Health

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/health` | Public | Health check |
