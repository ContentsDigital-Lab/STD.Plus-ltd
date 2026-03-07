require('dotenv').config();

const http = require('http');
const app = require('./src/app');
const env = require('./src/config/env');
const connectDB = require('./src/config/db');
const setupSocket = require('./src/socket');

connectDB().then(() => {
  const server = http.createServer(app);
  const io = setupSocket(server);

  app.set('io', io);

  server.listen(env.PORT, () => {
    console.log(`[${env.NODE_ENV}] Server running on http://localhost:${env.PORT}`);
    console.log(`[socket] WebSocket ready at /api/socket-entry`);
  });

  const shutdown = (signal) => {
    console.log(`\n${signal} received. Shutting down gracefully...`);
    server.close(() => {
      console.log('Server closed.');
      process.exit(0);
    });

    setTimeout(() => {
      console.error('Forced shutdown — connections did not close in time.');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
});
