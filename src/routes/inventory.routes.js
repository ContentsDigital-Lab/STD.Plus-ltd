const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const inventoryController = require('../controllers/inventory.controller');

const router = Router();

const createSchema = z.object({
  body: z.object({
    material: z.string().min(1),
    stockType: z.enum(['Raw', 'Reuse']),
    quantity: z.number().min(0),
    location: z.string().min(1),
  }),
});

const updateSchema = z.object({
  body: z.object({
    material: z.string().min(1).optional(),
    stockType: z.enum(['Raw', 'Reuse']).optional(),
    quantity: z.number().min(0).optional(),
    location: z.string().min(1).optional(),
  }),
});

const deleteManySchema = z.object({
  body: z.object({
    ids: z.array(z.string().min(1)).min(1),
  }),
});

router.get('/', auth, inventoryController.getAll);
router.get('/:id', auth, inventoryController.getById);
router.post('/', auth, authorize('admin', 'manager'), validate(createSchema), inventoryController.create);
router.patch('/:id', auth, authorize('admin', 'manager'), validate(updateSchema), inventoryController.update);
router.delete('/', auth, authorize('admin'), validate(deleteManySchema), inventoryController.deleteMany);
router.delete('/:id', auth, authorize('admin'), inventoryController.deleteOne);

module.exports = router;
