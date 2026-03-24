const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const orderController = require('../controllers/order.controller');
const claimController = require('../controllers/claim.controller');

const router = Router();

const stationHistoryEntry = z.object({
  station: z.string().min(1),
  enteredAt: z.string().datetime().optional(),
  exitedAt: z.string().datetime().nullable().optional(),
  completedBy: z.string().min(1).nullable().optional(),
});

const createSchema = z.object({
  body: z.object({
    request: z.string().min(1).optional(),
    priority: z.number().min(0).optional(),
    customer: z.string().min(1),
    material: z.string().min(1),
    quantity: z.number().min(1),
    stations: z.array(z.string().min(1)).optional(),
    currentStationIndex: z.number().min(0).optional(),
    stationHistory: z.array(stationHistoryEntry).optional(),
    stationData: z.record(z.string(), z.any()).optional(),
    paneCount: z.number().min(0).optional(),
    panesCompleted: z.number().min(0).optional(),
    progressPercent: z.number().min(0).max(100).optional(),
    stationBreakdown: z.record(z.string(), z.number()).optional(),
    notes: z.string().optional(),
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
    currentStationIndex: z.number().min(0).optional(),
    stationHistory: z.array(stationHistoryEntry).optional(),
    stationData: z.record(z.string(), z.any()).optional(),
    paneCount: z.number().min(0).optional(),
    panesCompleted: z.number().min(0).optional(),
    progressPercent: z.number().min(0).max(100).optional(),
    stationBreakdown: z.record(z.string(), z.number()).optional(),
    notes: z.string().optional(),
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
    pane: z.string().min(1).optional(),
    description: z.string().min(1),
    defectCode: z.enum(['broken', 'chipped', 'dimension_wrong', 'scratch', 'other']).optional(),
    defectStation: z.string().optional(),
    status: z.enum(['pending', 'approved', 'rejected']).optional(),
    decision: z.enum(['destroy', 'keep']).optional(),
    reportedBy: z.string().min(1),
    approvedBy: z.string().min(1).optional(),
    remadePane: z.string().min(1).optional(),
    photos: z.array(z.string().url()).optional(),
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
