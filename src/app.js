const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const env = require('./config/env');
const routes = require('./routes');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');

const app = express();

app.use(helmet());

app.use(cors({ origin: env.CORS_ORIGIN }));

app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));

app.use(rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  message: (req, res) => {
    const retryAfter = Math.ceil(env.RATE_LIMIT_BAN_MS / 1000);
    res.set('Retry-After', retryAfter);
    return { success: false, message: `Too many requests, try again in ${retryAfter}s` };
  },
  handler: (req, res, next, options) => {
    res.status(429);
    const body = options.message(req, res);
    res.json(body);

    const store = options.store || req.rateLimit?.store;
    if (store && req.ip) {
      const key = req.ip;
      const banUntil = Date.now() + env.RATE_LIMIT_BAN_MS;
      if (!app.locals._rateBans) app.locals._rateBans = new Map();
      app.locals._rateBans.set(key, banUntil);
    }
  },
}));

app.use((req, res, next) => {
  const bans = app.locals._rateBans;
  if (bans && bans.has(req.ip)) {
    const banUntil = bans.get(req.ip);
    if (Date.now() < banUntil) {
      const retryAfter = Math.ceil((banUntil - Date.now()) / 1000);
      res.set('Retry-After', retryAfter);
      return res.status(429).json({ success: false, message: `Too many requests, try again in ${retryAfter}s` });
    }
    bans.delete(req.ip);
  }
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api', routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
