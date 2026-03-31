const jwt = require('jsonwebtoken');
const env = require('../config/env');
const Worker = require('../models/Worker');
const AppError = require('../utils/AppError');

const auth = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return next(new AppError('Not authenticated', 401));
  }

  const token = header.split(' ')[1];

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    const worker = await Worker.findById(decoded.id).populate('role');
    if (!worker) return next(new AppError('User no longer exists', 401));
    if (!worker.role) return next(new AppError('Worker has no assigned role', 403));
    req.user = worker;
    next();
  } catch (err) {
    return next(new AppError('Invalid or expired token', 401));
  }
};

module.exports = auth;
