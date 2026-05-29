const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const requirePermission = require('../middleware/requirePermission');
const authorize = require('../middleware/authorize');
const inventoryController = require('../controllers/inventory.controller');

const router = Router();

const createSchema = z.object({
  body: z.object({
    material: z.string().min(1),
    stockType: z.enum(['Raw', 'Reuse']),
    quantity: z.number().min(0),
    location: z.string().min(1),
    storageColor: z.string().optional(),
  }),
});

const updateSchema = z.object({
  body: z.object({
    material: z.string().min(1).optional(),
    stockType: z.enum(['Raw', 'Reuse']).optional(),
    quantity: z.number().min(0).optional(),
    location: z.string().min(1).optional(),
    storageColor: z.string().optional(),
  }),
});

const deleteManySchema = z.object({
  body: z.object({
    ids: z.array(z.string().min(1)).min(1),
  }),
});

const moveSchema = z.object({
  body: z.object({
    quantity: z.number().min(1),
    toLocation: z.string().min(1),
    toStorageColor: z.string().optional(),
  }),
});

const allowStationInventory = (req, res, next) => {
  const perms = req.user?.role?.permissions || [];
  const isAdmin = req.user?.role?.slug === 'admin' || perms.includes('*');
  const hasGlobalView = ['inventory:view', 'dashboard:view'].some(p => perms.includes(p));
  const hasAnyStationAccess = perms.some(p => p.startsWith('station:enter:'));
  
  if (isAdmin || hasGlobalView || hasAnyStationAccess) {
    return next();
  }
  const AppError = require('../utils/AppError');
  return next(new AppError('Not authorized for this action', 403));
};

router.get('/', auth, allowStationInventory, inventoryController.getAll);
router.get('/:id', auth, allowStationInventory, inventoryController.getById);
router.post('/', auth, requirePermission('inventory:manage'), validate(createSchema), inventoryController.create);
router.post('/:id/move', auth, requirePermission('inventory:manage'), validate(moveSchema), inventoryController.move);
router.patch('/:id', auth, requirePermission('inventory:manage'), validate(updateSchema), inventoryController.update);
router.delete('/', auth, requirePermission('inventory:manage'), validate(deleteManySchema), inventoryController.deleteMany);
router.delete('/:id', auth, requirePermission('inventory:manage'), inventoryController.deleteOne);

module.exports = router;
