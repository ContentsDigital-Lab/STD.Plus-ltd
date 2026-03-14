const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const orderController = require('../controllers/order.controller');
const claimController = require('../controllers/claim.controller');

const router = Router();

const createSchema = z.object({
  body: z.object({
    request: z.string().min(1).optional(),
    priority: z.number().min(0).optional(),
    customer: z.string().min(1),
    material: z.string().min(1),
    quantity: z.number().min(1),
    stations: z.array(z.string().min(1)).optional(),
    status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional(),
    claim: z.string().min(1).optional(),
    withdrawal: z.string().min(1).optional(),
    assignedTo: z.string().min(1).optional(),
  }),
});

const updateSchema = z.object({
  body: z.object({
    request: z.string().min(1).optional(),
    priority: z.number().min(0).optional(),
    customer: z.string().min(1).optional(),
    material: z.string().min(1).optional(),
    quantity: z.number().min(1).optional(),
    stations: z.array(z.string().min(1)).optional(),
    status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional(),
    claim: z.string().min(1).optional(),
    withdrawal: z.string().min(1).optional(),
    assignedTo: z.string().min(1).optional(),
  }),
});

const deleteManySchema = z.object({
  body: z.object({
    ids: z.array(z.string().min(1)).min(1),
  }),
});

const createClaimSchema = z.object({
  body: z.object({
    source: z.enum(['customer', 'worker']),
    material: z.string().min(1),
    description: z.string().min(1),
    status: z.enum(['pending', 'approved', 'rejected']).optional(),
    decision: z.enum(['destroy', 'keep']).optional(),
    reportedBy: z.string().min(1),
    approvedBy: z.string().min(1).optional(),
    claimDate: z.string().datetime().optional(),
  }),
});

router.get('/', auth, orderController.getAll);
router.get('/:id', auth, orderController.getById);
router.post('/', auth, authorize('admin', 'manager'), validate(createSchema), orderController.create);
router.post('/:orderId/claims', auth, validate(createClaimSchema), claimController.create);
router.patch('/:id', auth, validate(updateSchema), orderController.update);
router.delete('/', auth, authorize('admin', 'manager'), validate(deleteManySchema), orderController.deleteMany);
router.delete('/:id', auth, authorize('admin', 'manager'), orderController.deleteOne);

module.exports = router;
