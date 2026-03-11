# STD Plus — Server

Backend API for managing materials, inventory, orders, and workflow.

## Tech Stack

Node.js, Express 5, MongoDB, Mongoose, JWT, Socket.IO, Zod, Helmet, CORS, rate limiting.

## Setup

```bash
npm install
cp .env.example .env    # then edit with your values
npm run seed            # creates admin user (admin / admin123)
npm run dev             # starts dev server on http://localhost:3000
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `MONGODB_URI` | — | MongoDB connection string |
| `JWT_SECRET` | — | Secret key for signing JWTs |
| `JWT_EXPIRES_IN` | `1d` | JWT expiration time |
| `PORT` | `3000` | Server port |
| `CORS_ORIGIN` | `*` | Allowed CORS origin |
| `RATE_LIMIT_WINDOW_MS` | `900000` | Rate limit window (ms) |
| `RATE_LIMIT_MAX` | `100` | Max requests per window |

## Authentication

All protected routes require `Authorization: Bearer <token>`.

```bash
# Get a token
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "admin123"}'

# Use the token
curl http://localhost:3000/api/materials \
  -H "Authorization: Bearer <token>"
```

Three roles: `admin` (full access), `manager` (create/update most resources), `worker` (view + update own assignments).

## WebSocket

Real-time events via Socket.IO at `/api/socket-entry`. Uses the same JWT for auth.

```js
const socket = io('http://localhost:3000', {
  path: '/api/socket-entry',
  auth: { token: 'your-jwt-token' },
});
```

## Scripts

```bash
npm run dev              # development server
npm start                # production server
npm run seed             # seed admin user
npm run reset            # drop all collections
npm run test:rbac        # test role-based access control
npm run test:socket      # test WebSocket events
npm run test:integrity   # test data integrity enforcement
npm run test:pagination  # test pagination
```

## Full Documentation

Run the Mintlify docs locally:

```bash
npm run docs
```
