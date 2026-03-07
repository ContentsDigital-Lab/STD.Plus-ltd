# STD Plus — Server

Backend API server for STD Plus.

## Tech Stack

- Node.js + Express 5
- MongoDB + Mongoose
- JWT Authentication (Bearer Token)
- Socket.IO (Real-time WebSocket)
- Zod for validation
- Helmet, CORS, rate limiting

## Setup

```bash
npm install
cp .env.example .env
```

### Seed Database

```bash
node scripts/seed.js
```

Creates a default admin worker (`admin` / `admin123`).

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

## REST API

Base URL: `/api`

### Authentication

This API uses Bearer Token JWT.
All protected routes require: `Authorization: Bearer <token>`

### Health

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/health` | Public | Health check |

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

### Customers

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/customers` | Protected | List all customers |
| `GET` | `/api/customers/:id` | Protected | Get customer by ID |
| `POST` | `/api/customers` | Protected | Create a customer |
| `PATCH` | `/api/customers/:id` | Protected | Update a customer |
| `DELETE` | `/api/customers` | Protected | Delete multiple customers |
| `DELETE` | `/api/customers/:id` | Protected | Delete a customer |

### Materials

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/materials` | Protected | List all materials |
| `GET` | `/api/materials/:id` | Protected | Get material by ID |
| `POST` | `/api/materials` | Protected | Create a material |
| `PATCH` | `/api/materials/:id` | Protected | Update a material |
| `DELETE` | `/api/materials` | Protected | Delete multiple materials |
| `DELETE` | `/api/materials/:id` | Protected | Delete a material |

### Inventories

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/inventories` | Protected | List all inventories |
| `GET` | `/api/inventories/:id` | Protected | Get inventory by ID |
| `POST` | `/api/inventories` | Protected | Create an inventory |
| `PATCH` | `/api/inventories/:id` | Protected | Update an inventory |
| `DELETE` | `/api/inventories` | Protected | Delete multiple inventories |
| `DELETE` | `/api/inventories/:id` | Protected | Delete an inventory |

### Material Logs

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/material-logs` | Protected | List all material logs |
| `GET` | `/api/material-logs/:id` | Protected | Get material log by ID |
| `POST` | `/api/material-logs` | Protected | Create a material log |
| `PATCH` | `/api/material-logs/:id` | Protected | Update a material log |
| `DELETE` | `/api/material-logs` | Protected | Delete multiple material logs |
| `DELETE` | `/api/material-logs/:id` | Protected | Delete a material log |

### Requests

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/requests` | Protected | List all requests |
| `GET` | `/api/requests/:id` | Protected | Get request by ID |
| `POST` | `/api/requests` | Protected | Create a request |
| `PATCH` | `/api/requests/:id` | Protected | Update a request |
| `DELETE` | `/api/requests` | Protected | Delete multiple requests |
| `DELETE` | `/api/requests/:id` | Protected | Delete a request |

### Withdrawals

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/withdrawals` | Protected | List all withdrawals |
| `GET` | `/api/withdrawals/:id` | Protected | Get withdrawal by ID |
| `POST` | `/api/withdrawals` | Protected | Create a withdrawal |
| `PATCH` | `/api/withdrawals/:id` | Protected | Update a withdrawal |
| `DELETE` | `/api/withdrawals` | Protected | Delete multiple withdrawals |
| `DELETE` | `/api/withdrawals/:id` | Protected | Delete a withdrawal |

### Orders

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/orders` | Protected | List all orders |
| `GET` | `/api/orders/:id` | Protected | Get order by ID |
| `POST` | `/api/orders` | Protected | Create an order |
| `PATCH` | `/api/orders/:id` | Protected | Update an order |
| `DELETE` | `/api/orders` | Protected | Delete multiple orders |
| `DELETE` | `/api/orders/:id` | Protected | Delete an order |

### Claims

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/claims` | Protected | List all claims |
| `GET` | `/api/claims/:id` | Protected | Get claim by ID |
| `POST` | `/api/orders/:id/claims` | Protected | Create a claim for an order |
| `PATCH` | `/api/claims/:id` | Protected | Update a claim |
| `DELETE` | `/api/claims` | Protected | Delete multiple claims |
| `DELETE` | `/api/claims/:id` | Protected | Delete a claim |

### Stations

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/stations` | Protected | List all stations |
| `GET` | `/api/stations/:id` | Protected | Get station by ID |
| `POST` | `/api/stations` | Protected | Create a station |
| `PATCH` | `/api/stations/:id` | Protected | Update a station |
| `DELETE` | `/api/stations` | Protected | Delete multiple stations |
| `DELETE` | `/api/stations/:id` | Protected | Delete a station |

### Notifications

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/notifications` | Protected | List all notifications |
| `GET` | `/api/notifications/:id` | Protected | Get notification by ID |
| `POST` | `/api/notifications` | Protected | Create a notification |
| `PATCH` | `/api/notifications/:id` | Protected | Update a notification |
| `DELETE` | `/api/notifications` | Protected | Delete multiple notifications |
| `DELETE` | `/api/notifications/:id` | Protected | Delete a notification |

## WebSocket API

Path: `/api/socket-entry`
Namespace: `/` (default)

### Authentication

Uses the same JWT from the REST API. Pass the token during the connection handshake:

```js
const socket = io('http://localhost:3000', {
  path: '/api/socket-entry',
  auth: { token: 'your-jwt-token' },
});
```

### System Events

| Event | Direction | Description |
|---|---|---|
| `connect` | INBOUND | Connected successfully |
| `disconnect` | INBOUND | Disconnected |
| `error` | INBOUND | System error |

### Room Events

| Event | Direction | Description |
|---|---|---|
| `join_me` | OUTBOUND | Join personal room |
| `join_dashboard` | OUTBOUND | Join dashboard page |
| `join_inventory` | OUTBOUND | Join inventory page |
| `join_station` | OUTBOUND | Join station page |
| `join_log` | OUTBOUND | Join material log page |
| `join_request` | OUTBOUND | Join request page |
| `join_withdrawal` | OUTBOUND | Join withdrawal page |
| `join_order` | OUTBOUND | Join order page |
| `join_claim` | OUTBOUND | Join claim page |
| `leave_dashboard` | OUTBOUND | Leave dashboard page |
| `leave_inventory` | OUTBOUND | Leave inventory page |
| `leave_station` | OUTBOUND | Leave station page |
| `leave_log` | OUTBOUND | Leave material log page |
| `leave_request` | OUTBOUND | Leave request page |
| `leave_withdrawal` | OUTBOUND | Leave withdrawal page |
| `leave_order` | OUTBOUND | Leave order page |
| `leave_claim` | OUTBOUND | Leave claim page |

### Data Events

| Event | Direction | Description |
|---|---|---|
| `material:updated` | INBOUND | Material data changed |
| `order:updated` | INBOUND | Order data changed |
| `inventory:updated` | INBOUND | Inventory data changed |
| `log:updated` | INBOUND | Material log data changed |
| `request:updated` | INBOUND | Request data changed |
| `withdrawal:updated` | INBOUND | Withdrawal data changed |
| `claim:updated` | INBOUND | Claim data changed |
| `notification` | INBOUND | Real-time notification |
| `system_alert` | INBOUND | System-wide announcement |

## Testing

Make sure the server is running first:

```bash
npm run dev
```

### WebSocket Events

Tests all system events (connect, disconnect, error), room events (join/leave), and data events (material:updated, order:updated, etc.):

```bash
node scripts/test-socket.js
```

### Rate Limiting

Sends 200 requests to the health endpoint to verify rate limiting kicks in:

```bash
bash scripts/test-rate-limit.sh
```
