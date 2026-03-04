const AppError = require('../utils/AppError');

const notFound = (req, res, next) => {
  next(new AppError(`Not found: ${req.method} ${req.originalUrl}`, 404));
};

module.exports = notFound;
