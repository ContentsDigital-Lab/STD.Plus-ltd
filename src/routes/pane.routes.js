const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const paneController = require('../controllers/pane.controller');

const router = Router();

const STATIONS = ['queue', 'cutting', 'edging', 'tempering', 'laminating', 'assembly', 'qc', 'ready', 'defected'];
const PANE_STATUS = ['pending', 'in_progress', 'completed'];
const EDGE_STATUS = ['pending', 'in_progress', 'completed'];

const dimensionsSchema = z.object({
  width: z.number().min(0).optional(),
  height: z.number().min(0).optional(),
  thickness: z.number().min(0).optional(),
}).optional();

const edgeTaskSchema = z.object({
  side: z.string().min(1),
  edgeProfile: z.string().min(1),
  machineType: z.string().min(1).optional(),
  status: z.enum(EDGE_STATUS).optional(),
});

const createSchema = z.object({
  body: z.object({
    request: z.string().min(1),
    order: z.string().min(1).optional(),
    currentStation: z.enum(STATIONS).optional(),
    currentStatus: z.enum(PANE_STATUS).optional(),
    routing: z.array(z.string().min(1)).optional(),
    customRouting: z.boolean().optional(),
    dimensions: dimensionsSchema,
    glassType: z.string().optional(),
    glassTypeLabel: z.string().optional(),
    processes: z.array(z.string().min(1)).optional(),
    edgeTasks: z.array(edgeTaskSchema).optional(),
    withdrawal: z.string().min(1).optional(),
    remakeOf: z.string().min(1).optional(),
    startedAt: z.string().datetime().optional(),
    completedAt: z.string().datetime().optional(),
    deliveredAt: z.string().datetime().optional(),
    notes: z.string().optional(),
  }),
});

const updateSchema = z.object({
  body: z.object({
    request: z.string().min(1).optional(),
    order: z.string().min(1).optional(),
    currentStation: z.enum(STATIONS).optional(),
    currentStatus: z.enum(PANE_STATUS).optional(),
    routing: z.array(z.string().min(1)).optional(),
    customRouting: z.boolean().optional(),
    dimensions: dimensionsSchema,
    glassType: z.string().optional(),
    glassTypeLabel: z.string().optional(),
    processes: z.array(z.string().min(1)).optional(),
    edgeTasks: z.array(edgeTaskSchema).optional(),
    withdrawal: z.string().min(1).optional(),
    remakeOf: z.string().min(1).optional(),
    startedAt: z.string().datetime().optional(),
    completedAt: z.string().datetime().optional(),
    deliveredAt: z.string().datetime().optional(),
    notes: z.string().optional(),
  }),
});

const deleteManySchema = z.object({
  body: z.object({
    ids: z.array(z.string().min(1)).min(1),
  }),
});

router.get('/', auth, paneController.getAll);
router.get('/:id', auth, paneController.getById);
router.post('/', auth, authorize('admin', 'manager'), validate(createSchema), paneController.create);
router.patch('/:id', auth, authorize('admin', 'manager'), validate(updateSchema), paneController.update);
router.delete('/', auth, authorize('admin'), validate(deleteManySchema), paneController.deleteMany);
router.delete('/:id', auth, authorize('admin'), paneController.deleteOne);

module.exports = router;
