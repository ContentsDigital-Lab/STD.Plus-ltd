const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const claimController = require('../controllers/claim.controller');

const router = Router();

const updateSchema = z.object({
  body: z.object({
    source: z.enum(['customer', 'worker']).optional(),
    material: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    decision: z.enum(['destroy', 'keep']).optional(),
    reportedBy: z.string().min(1).optional(),
    approvedBy: z.string().min(1).optional(),
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
router.patch('/:id', auth, validate(updateSchema), claimController.update);
router.delete('/', auth, validate(deleteManySchema), claimController.deleteMany);
router.delete('/:id', auth, claimController.deleteOne);

module.exports = router;
