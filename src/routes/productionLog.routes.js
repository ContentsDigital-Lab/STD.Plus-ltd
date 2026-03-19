const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const productionLogController = require('../controllers/productionLog.controller');

const router = Router();

const ACTIONS = ['scan_in', 'start', 'complete', 'fail', 'rework', 'qc_pass', 'qc_fail', 'batch_start', 'batch_complete'];
const STATUS = ['pass', 'fail', 'rework'];

const qcResultSchema = z.object({
  label: z.string().min(1),
  passed: z.boolean(),
  note: z.string().optional(),
});

const createSchema = z.object({
  body: z.object({
    pane: z.string().min(1),
    order: z.string().min(1),
    station: z.string().min(1),
    action: z.enum(ACTIONS),
    operator: z.string().min(1).optional(),
    defectCode: z.string().optional(),
    reworkReason: z.string().optional(),
    qcResults: z.array(qcResultSchema).optional(),
    status: z.enum(STATUS).optional(),
    startedAt: z.string().datetime().optional(),
    completedAt: z.string().datetime().optional(),
    durationMs: z.number().min(0).optional(),
  }),
});

const updateSchema = z.object({
  body: z.object({
    pane: z.string().min(1).optional(),
    order: z.string().min(1).optional(),
    station: z.string().min(1).optional(),
    action: z.enum(ACTIONS).optional(),
    operator: z.string().min(1).optional(),
    defectCode: z.string().nullable().optional(),
    reworkReason: z.string().nullable().optional(),
    qcResults: z.array(qcResultSchema).optional(),
    status: z.enum(STATUS).nullable().optional(),
    startedAt: z.string().datetime().nullable().optional(),
    completedAt: z.string().datetime().nullable().optional(),
    durationMs: z.number().min(0).nullable().optional(),
  }),
});

const deleteManySchema = z.object({
  body: z.object({
    ids: z.array(z.string().min(1)).min(1),
  }),
});

router.get('/', auth, productionLogController.getAll);
router.get('/:id', auth, productionLogController.getById);
router.post('/', auth, validate(createSchema), productionLogController.create);
router.patch('/:id', auth, authorize('admin', 'manager'), validate(updateSchema), productionLogController.update);
router.delete('/', auth, authorize('admin'), validate(deleteManySchema), productionLogController.deleteMany);
router.delete('/:id', auth, authorize('admin'), productionLogController.deleteOne);

module.exports = router;
