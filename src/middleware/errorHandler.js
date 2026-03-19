const { fail } = require('../utils/response');

const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const message = err.isOperational ? err.message : 'Internal server error';

  if (process.env.NODE_ENV === 'development') {
    console.error(err.stack);
  }

  const body = { success: false, message };
  if (err.data) body.data = err.data;
  return res.status(statusCode).json(body);
};

module.exports = errorHandler;
