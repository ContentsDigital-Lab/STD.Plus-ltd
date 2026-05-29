const { Router } = require('express');
const auth = require('../middleware/auth');
const requirePermission = require('../middleware/requirePermission');
const authorize = require('../middleware/authorize');
const paneLogController = require('../controllers/paneLog.controller');

const router = Router();

const allowStationView = (req, res, next) => {
  const perms = req.user?.role?.permissions || [];
  const isAdmin = req.user?.role?.slug === 'admin' || perms.includes('*');
  const hasGlobalView = ['production:view', 'orders:view'].some(p => perms.includes(p));
  const hasAnyStationAccess = perms.some(p => p.startsWith('station:enter:'));
  
  if (isAdmin || hasGlobalView || hasAnyStationAccess) return next();
  const AppError = require('../utils/AppError');
  return next(new AppError('Not authorized for this action', 403));
};

router.get('/timeline', auth, allowStationView, paneLogController.getTimeline);
router.get('/',         auth, allowStationView, paneLogController.getAll);

module.exports = router;
