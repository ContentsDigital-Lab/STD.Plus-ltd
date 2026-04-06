const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const requirePermission = require('../middleware/requirePermission');
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

router.get('/', auth, requirePermission('withdrawals:view'), withdrawalController.getAll);
router.get('/:id', auth, requirePermission('withdrawals:view'), withdrawalController.getById);
router.post('/', auth, requirePermission('withdrawals:create'), validate(createSchema), withdrawalController.create);
router.patch('/:id', auth, requirePermission('withdrawals:manage'), validate(updateSchema), withdrawalController.update);
router.delete('/', auth, requirePermission('withdrawals:manage'), validate(deleteManySchema), withdrawalController.deleteMany);
router.delete('/:id', auth, requirePermission('withdrawals:manage'), withdrawalController.deleteOne);

module.exports = router;
