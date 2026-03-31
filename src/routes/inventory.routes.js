const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const requirePermission = require('../middleware/requirePermission');
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

router.get('/', auth, requirePermission('inventory:view'), inventoryController.getAll);
router.get('/:id', auth, requirePermission('inventory:view'), inventoryController.getById);
router.post('/', auth, requirePermission('inventory:manage'), validate(createSchema), inventoryController.create);
router.post('/:id/move', auth, requirePermission('inventory:move'), validate(moveSchema), inventoryController.move);
router.patch('/:id', auth, requirePermission('inventory:manage'), validate(updateSchema), inventoryController.update);
router.delete('/', auth, requirePermission('inventory:manage'), validate(deleteManySchema), inventoryController.deleteMany);
router.delete('/:id', auth, requirePermission('inventory:manage'), inventoryController.deleteOne);

module.exports = router;
