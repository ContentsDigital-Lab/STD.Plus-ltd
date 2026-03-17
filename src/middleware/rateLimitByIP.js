const rateLimit = require('express-rate-limit');
const env = require('../config/env');

const banCheck = (req, res, next) => {
  const bans = req.app.locals._rateBans;
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
};

const limiter = rateLimit({
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

    if (req.ip) {
      const banUntil = Date.now() + env.RATE_LIMIT_BAN_MS;
      if (!req.app.locals._rateBans) req.app.locals._rateBans = new Map();
      req.app.locals._rateBans.set(req.ip, banUntil);
    }
  },
});

module.exports = [banCheck, limiter];
