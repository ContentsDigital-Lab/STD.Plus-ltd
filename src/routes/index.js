const { Router } = require('express');
const { z } = require('zod');
const healthRoutes = require('./health.routes');
const authRoutes = require('./auth.routes');
const workerRoutes = require('./worker.routes');
const materialRoutes = require('./material.routes');
const inventoryRoutes = require('./inventory.routes');
const customerRoutes = require('./customer.routes');
const claimRoutes = require('./claim.routes');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const claimController = require('../controllers/claim.controller');

const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/workers', workerRoutes);
router.use('/materials', materialRoutes);
router.use('/inventories', inventoryRoutes);
router.use('/customers', customerRoutes);
router.use('/claims', claimRoutes);

const createClaimSchema = z.object({
  body: z.object({
    source: z.enum(['customer', 'worker']),
    material: z.string().min(1),
    description: z.string().min(1),
    decision: z.enum(['destroy', 'keep']).optional(),
    reportedBy: z.string().min(1),
    approvedBy: z.string().min(1).optional(),
    claimDate: z.string().datetime().optional(),
  }),
});

router.post('/orders/:orderId/claims', auth, validate(createClaimSchema), claimController.create);

module.exports = router;
