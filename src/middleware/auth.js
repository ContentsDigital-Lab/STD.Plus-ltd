const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const env = require('../config/env');
const Worker = require('../models/Worker');
const AppError = require('../utils/AppError');

const userLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_AUTH_MAX,
  keyGenerator: (req) => req.user._id.toString(),
  handler: (req, res, next, options) => {
    const retryAfter = Math.ceil(env.RATE_LIMIT_WINDOW_MS / 1000);
    res.set('Retry-After', retryAfter);
    res.status(429).json({ success: false, message: `Too many requests, try again in ${retryAfter}s` });
  },
});

const auth = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return next(new AppError('Not authenticated', 401));
  }

  const token = header.split(' ')[1];

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    const worker = await Worker.findById(decoded.id);
    if (!worker) return next(new AppError('User no longer exists', 401));
    req.user = worker;
    userLimiter(req, res, next);
  } catch (err) {
    return next(new AppError('Invalid or expired token', 401));
  }
};

module.exports = auth;
