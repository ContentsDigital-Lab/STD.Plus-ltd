const { fail } = require('../utils/response');

const validate = (schema) => {
  return (req, res, next) => {
    const result = schema.safeParse({
      body: req.body,
      query: req.query,
      params: req.params,
    });

    if (!result.success) {
      const errors = result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      }));
      return fail(res, 'Validation failed', 400, errors);
    }

    req.validated = result.data;
    next();
  };
};

module.exports = validate;
