const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const claimController = require('../controllers/claim.controller');

const router = Router();

const updateSchema = z.object({
  body: z.object({
    source: z.enum(['customer', 'worker']).optional(),
    material: z.string().min(1).optional(),
    pane: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    defectCode: z.enum(['broken', 'chipped', 'dimension_wrong', 'scratch', 'other']).optional(),
    defectStation: z.string().optional(),
    status: z.enum(['pending', 'approved', 'rejected']).optional(),
    decision: z.enum(['destroy', 'keep']).optional(),
    reportedBy: z.string().min(1).optional(),
    approvedBy: z.string().min(1).optional(),
    remadePane: z.string().min(1).optional(),
    photos: z.array(z.string().min(1)).optional(),
    claimDate: z.string().datetime().optional(),
  }),
});

const createFromPaneSchema = z.object({
  body: z.object({
    paneNumber: z.string().min(1),
    source: z.enum(['customer', 'worker']),
    description: z.string().min(1),
    defectCode: z.enum(['broken', 'chipped', 'dimension_wrong', 'scratch', 'other']).optional(),
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

router.get('/', auth, claimController.getAll);
router.get('/:id', auth, claimController.getById);
router.post('/from-pane', auth, validate(createFromPaneSchema), claimController.createFromPane);
router.patch('/:id', auth, validate(updateSchema), claimController.update);
router.delete('/', auth, authorize('admin', 'manager'), validate(deleteManySchema), claimController.deleteMany);
router.delete('/:id', auth, authorize('admin', 'manager'), claimController.deleteOne);

module.exports = router;
