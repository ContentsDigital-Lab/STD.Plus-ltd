const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const requirePermission = require('../middleware/requirePermission');
const authorize = require('../middleware/authorize');
const workerController = require('../controllers/worker.controller');

const router = Router();

const notificationPreferencesSchema = z.object({
  enabled: z.boolean().optional(),
  volume: z.number().min(0).max(1).optional(),
  sounds: z.object({
    low: z.string().min(1).optional(),
    medium: z.string().min(1).optional(),
    high: z.string().min(1).optional(),
    urgent: z.string().min(1).optional(),
  }).optional(),
}).optional();

const createSchema = z.object({
  body: z.object({
    name: z.string().min(1),
    username: z.string().min(1),
    password: z.string().min(6),
    position: z.string().min(1),
    role: z.string().optional(),
    notificationPreferences: notificationPreferencesSchema,
  }),
});

const updateSchema = z.object({
  body: z.object({
    name: z.string().min(1).optional(),
    username: z.string().min(1).optional(),
    password: z.string().min(6).optional(),
    position: z.string().min(1).optional(),
    role: z.string().optional(),
    notificationPreferences: notificationPreferencesSchema,
  }),
});

const deleteManySchema = z.object({
  body: z.object({
    ids: z.array(z.string().min(1)).min(1),
  }),
});

const allowWorkerFetch = (req, res, next) => {
  const perms = req.user?.role?.permissions || [];
  const isAdmin = req.user?.role?.slug === 'admin' || perms.includes('*');
  const hasGlobalView = ['users:view', 'inventory:view', 'production:view', 'orders:view', 'orders:create'].some(p => perms.includes(p));
  const hasAnyStationAccess = perms.some(p => p.startsWith('station:enter:'));
  
  if (isAdmin || hasGlobalView || hasAnyStationAccess) return next();
  const AppError = require('../utils/AppError');
  return next(new AppError('Not authorized for this action', 403));
};

router.get('/', auth, allowWorkerFetch, workerController.getAll);
router.get('/:id', auth, allowWorkerFetch, workerController.getById);
router.post('/', auth, requirePermission('users:manage'), validate(createSchema), workerController.create);
router.patch('/:id', auth, requirePermission('users:manage'), validate(updateSchema), workerController.update);
router.delete('/', auth, requirePermission('users:manage'), validate(deleteManySchema), workerController.deleteMany);
router.delete('/:id', auth, requirePermission('users:manage'), workerController.deleteOne);

module.exports = router;
