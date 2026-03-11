const success = (res, data = null, message = 'Success', statusCode = 200, pagination = null) => {
  const body = {
    success: true,
    message,
    data,
  };
  if (pagination) body.pagination = pagination;
  return res.status(statusCode).json(body);
};

const fail = (res, message = 'Something went wrong', statusCode = 500, errors = null) => {
  const body = {
    success: false,
    message,
  };
  if (errors) body.errors = errors;
  return res.status(statusCode).json(body);
};

module.exports = { success, fail };
