require('dotenv').config();

const app = require('./src/app');
const env = require('./src/config/env');

const server = app.listen(env.PORT, () => {
  console.log(`[${env.NODE_ENV}] Server running on http://localhost:${env.PORT}`);
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
