const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const requirePermission = require('../middleware/requirePermission');
const authorize = require('../middleware/authorize');
const materialController = require('../controllers/material.controller');

const router = Router();

const specDetailsSchema = z.object({
  thickness: z.string().optional(),
  color: z.string().optional(),
  glassType: z.string().optional(),
  width: z.string().optional(),
  length: z.string().optional(),
  sqft: z.string().optional(),
}).optional();

const createSchema = z.object({
  body: z.object({
    code: z.string().optional(),
    name: z.string().min(1),
    brand: z.string().optional(),
    unit: z.string().min(1),
    reorderPoint: z.number().min(0),
    specDetails: specDetailsSchema,
  }),
});

const updateSchema = z.object({
  body: z.object({
    code: z.string().optional(),
    name: z.string().min(1).optional(),
    brand: z.string().optional(),
    unit: z.string().min(1).optional(),
    reorderPoint: z.number().min(0).optional(),
    specDetails: specDetailsSchema,
  }),
});

const deleteManySchema = z.object({
  body: z.object({
    ids: z.array(z.string().min(1)).min(1),
  }),
});

const allowStationView = (req, res, next) => {
  const perms = req.user?.role?.permissions || [];
  const isAdmin = req.user?.role?.slug === 'admin' || perms.includes('*');
  const hasGlobalView = ['inventory:view', 'orders:view', 'orders:create', 'dashboard:view'].some(p => perms.includes(p));
  const hasAnyStationAccess = perms.some(p => p.startsWith('station:enter:'));
  
  if (isAdmin || hasGlobalView || hasAnyStationAccess) {
    return next();
  }
  const AppError = require('../utils/AppError');
  return next(new AppError('Not authorized for this action', 403));
};

router.get('/', auth, allowStationView, materialController.getAll);
router.get('/:id', auth, allowStationView, materialController.getById);
router.post('/', auth, requirePermission('inventory:manage'), validate(createSchema), materialController.create);
router.patch('/:id', auth, requirePermission('inventory:manage'), validate(updateSchema), materialController.update);
router.delete('/', auth, requirePermission('inventory:manage'), validate(deleteManySchema), materialController.deleteMany);
router.delete('/:id', auth, requirePermission('inventory:manage'), materialController.deleteOne);

module.exports = router;
