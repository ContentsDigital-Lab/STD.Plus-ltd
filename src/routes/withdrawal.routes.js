const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const requirePermission = require('../middleware/requirePermission');
const authorize = require('../middleware/authorize');
const withdrawalController = require('../controllers/withdrawal.controller');

const router = Router();

const withdrawnDimensionsSchema = z.object({
  width: z.number().min(0).optional(),
  height: z.number().min(0).optional(),
  thickness: z.number().min(0).optional(),
}).optional();

const createSchema = z.object({
  body: z.object({
    order: z.string().min(1).optional(),
    panes: z.array(z.string().min(1)).optional(),
    withdrawnBy: z.string().min(1),
    material: z.string().min(1),
    quantity: z.number().min(1),
    stockType: z.enum(['Raw', 'Reuse']),
    status: z.enum(['pending', 'approved', 'rejected']).optional(),
    approvedBy: z.string().min(1).optional(),
    withdrawnDimensions: withdrawnDimensionsSchema,
    notes: z.string().optional(),
    inventory: z.string().optional(),
    withdrawnDate: z.string().datetime().optional(),
  }),
});

const updateSchema = z.object({
  body: z.object({
    order: z.string().min(1).optional(),
    panes: z.array(z.string().min(1)).optional(),
    withdrawnBy: z.string().min(1).optional(),
    material: z.string().min(1).optional(),
    quantity: z.number().min(1).optional(),
    stockType: z.enum(['Raw', 'Reuse']).optional(),
    status: z.enum(['pending', 'approved', 'rejected']).optional(),
    approvedBy: z.string().min(1).optional(),
    withdrawnDimensions: withdrawnDimensionsSchema,
    notes: z.string().optional(),
    inventory: z.string().optional(),
    withdrawnDate: z.string().datetime().optional(),
  }),
});

const deleteManySchema = z.object({
  body: z.object({
    ids: z.array(z.string().min(1)).min(1),
  }),
});

const allowStationWithdrawalView = (req, res, next) => {
  const perms = req.user?.role?.permissions || [];
  const isAdmin = req.user?.role?.slug === 'admin' || perms.includes('*');
  const hasGlobalView = ['inventory:view'].some(p => perms.includes(p));
  const hasAnyStationAccess = perms.some(p => p.startsWith('station:enter:'));
  if (isAdmin || hasGlobalView || hasAnyStationAccess) return next();
  const AppError = require('../utils/AppError');
  return next(new AppError('Not authorized for this action', 403));
};

const allowStationWithdrawalCreate = (req, res, next) => {
  const perms = req.user?.role?.permissions || [];
  const isAdmin = req.user?.role?.slug === 'admin' || perms.includes('*');
  const hasGlobalManage = ['inventory:manage'].some(p => perms.includes(p));
  const hasAnyStationAccess = perms.some(p => p.startsWith('station:enter:'));
  if (isAdmin || hasGlobalManage || hasAnyStationAccess) return next();
  const AppError = require('../utils/AppError');
  return next(new AppError('Not authorized for this action', 403));
};

router.get('/', auth, allowStationWithdrawalView, withdrawalController.getAll);
router.get('/:id', auth, allowStationWithdrawalView, withdrawalController.getById);
router.post('/', auth, allowStationWithdrawalCreate, validate(createSchema), withdrawalController.create);
router.patch('/:id', auth, requirePermission('inventory:manage'), validate(updateSchema), withdrawalController.update);
router.delete('/', auth, requirePermission('inventory:manage'), validate(deleteManySchema), withdrawalController.deleteMany);
router.delete('/:id', auth, requirePermission('inventory:manage'), withdrawalController.deleteOne);

module.exports = router;
