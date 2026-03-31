const AppError = require('../utils/AppError');

const requirePermission = (...perms) => (req, res, next) => {
  const userPerms = req.user.role?.permissions || [];
  if (userPerms.includes('*')) return next();
  if (perms.every(p => userPerms.includes(p))) return next();
  return next(new AppError('Not authorized for this action', 403));
};

module.exports = requirePermission;
