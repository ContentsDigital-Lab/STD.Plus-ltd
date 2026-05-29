const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const requirePermission = require('../middleware/requirePermission');
const authorize = require('../middleware/authorize');
const claimController = require('../controllers/claim.controller');

const router = Router();

const updateSchema = z.object({
  body: z.object({
    source: z.enum(['customer', 'worker']).optional(),
    material: z.string().min(1).optional(),
    pane: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    defectCode: z.enum(['broken', 'chipped', 'dimension_wrong', 'scratch', 'stain', 'other']).optional(),
    defectStation: z.string().optional(),
    status: z.enum(['pending', 'approved', 'rejected']).optional(),
    decision: z.enum(['destroy', 'keep']).optional(),
    reportedBy: z.string().min(1).optional(),
    approvedBy: z.string().min(1).optional(),
    remadePane: z.string().min(1).optional(),
    remakeStation: z.string().min(1).optional(),
    photos: z.array(z.string().min(1)).optional(),
    claimDate: z.string().datetime().optional(),
  }),
});

const createFromPaneSchema = z.object({
  body: z.object({
    paneNumber: z.string().min(1),
    source: z.enum(['customer', 'worker']),
    description: z.string().min(1),
    defectCode: z.enum(['broken', 'chipped', 'dimension_wrong', 'scratch', 'stain', 'other']).optional(),
    defectStation: z.string().optional(),
    status: z.enum(['pending', 'approved', 'rejected']).optional(),
    decision: z.enum(['destroy', 'keep']).optional(),
    reportedBy: z.string().min(1),
    approvedBy: z.string().min(1).optional(),
    remadePane: z.string().min(1).optional(),
    photos: z.array(z.string().min(1)).optional(),
    claimDate: z.string().datetime().optional(),
  }),
});

const deleteManySchema = z.object({
  body: z.object({
    ids: z.array(z.string().min(1)).min(1),
  }),
});

const allowStationClaimView = (req, res, next) => {
  const perms = req.user?.role?.permissions || [];
  const isAdmin = req.user?.role?.slug === 'admin' || perms.includes('*');
  const hasGlobalView = ['inventory:view', 'production:view'].some(p => perms.includes(p));
  const hasAnyStationAccess = perms.some(p => p.startsWith('station:enter:'));
  if (isAdmin || hasGlobalView || hasAnyStationAccess) return next();
  const AppError = require('../utils/AppError');
  return next(new AppError('Not authorized for this action', 403));
};

const allowStationClaimManage = (req, res, next) => {
  const perms = req.user?.role?.permissions || [];
  const isAdmin = req.user?.role?.slug === 'admin' || perms.includes('*');
  const hasGlobalManage = ['inventory:manage'].some(p => perms.includes(p));
  const hasAnyStationAccess = perms.some(p => p.startsWith('station:enter:'));
  if (isAdmin || hasGlobalManage || hasAnyStationAccess) return next();
  const AppError = require('../utils/AppError');
  return next(new AppError('Not authorized for this action', 403));
};

router.get('/', auth, allowStationClaimView, claimController.getAll);
router.get('/:id', auth, allowStationClaimView, claimController.getById);
router.post('/from-pane', auth, allowStationClaimManage, validate(createFromPaneSchema), claimController.createFromPane);
router.patch('/:id', auth, allowStationClaimView, validate(updateSchema), claimController.update);
router.delete('/', auth, requirePermission('inventory:manage'), validate(deleteManySchema), claimController.deleteMany);
router.delete('/:id', auth, requirePermission('inventory:manage'), claimController.deleteOne);

module.exports = router;
