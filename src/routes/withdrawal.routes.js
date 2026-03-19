const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
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
    pane: z.string().min(1).optional(),
    withdrawnBy: z.string().min(1),
    material: z.string().min(1),
    quantity: z.number().min(1),
    stockType: z.enum(['Raw', 'Reuse']),
    status: z.enum(['pending', 'approved', 'rejected']).optional(),
    approvedBy: z.string().min(1).optional(),
    withdrawnDimensions: withdrawnDimensionsSchema,
    notes: z.string().optional(),
    withdrawnDate: z.string().datetime().optional(),
  }),
});

const updateSchema = z.object({
  body: z.object({
    order: z.string().min(1).optional(),
    pane: z.string().min(1).optional(),
    withdrawnBy: z.string().min(1).optional(),
    material: z.string().min(1).optional(),
    quantity: z.number().min(1).optional(),
    stockType: z.enum(['Raw', 'Reuse']).optional(),
    status: z.enum(['pending', 'approved', 'rejected']).optional(),
    approvedBy: z.string().min(1).optional(),
    withdrawnDimensions: withdrawnDimensionsSchema,
    notes: z.string().optional(),
    withdrawnDate: z.string().datetime().optional(),
  }),
});

const deleteManySchema = z.object({
  body: z.object({
    ids: z.array(z.string().min(1)).min(1),
  }),
});

router.get('/', auth, withdrawalController.getAll);
router.get('/:id', auth, withdrawalController.getById);
router.post('/', auth, validate(createSchema), withdrawalController.create);
router.patch('/:id', auth, authorize('admin', 'manager'), validate(updateSchema), withdrawalController.update);
router.delete('/', auth, authorize('admin', 'manager'), validate(deleteManySchema), withdrawalController.deleteMany);
router.delete('/:id', auth, authorize('admin', 'manager'), withdrawalController.deleteOne);

module.exports = router;
