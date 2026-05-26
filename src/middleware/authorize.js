const AppError = require('../utils/AppError');

const authorize = (...requirements) => (req, res, next) => {
  const user = req.user;
  if (!user) {
    return next(new AppError('Not authorized', 401));
  }

  const userRole = user.role;
  const roleSlug = userRole && typeof userRole === 'object' ? userRole.slug : userRole;
  const permissions = userRole && typeof userRole === 'object' ? (userRole.permissions || []) : [];

  // Admin bypass
  const isAdmin = roleSlug === 'admin' || (Array.isArray(permissions) && permissions.includes('*'));
  if (isAdmin) {
    return next();
  }

  const hasAccess = requirements.some(reqVal => {
    if (reqVal === roleSlug) return true;
    if (Array.isArray(permissions) && permissions.includes(reqVal)) return true;
    return false;
  });

  if (!hasAccess) {
    return next(new AppError('Not authorized for this action', 403));
  }
  next();
};

module.exports = authorize;
