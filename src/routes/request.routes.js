const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const requestController = require('../controllers/request.controller');

const router = Router();

const detailsSchema = z.object({
  type: z.string().min(1),
  estimatedPrice: z.number().min(0).optional(),
  quantity: z.number().min(1),
});

const paneItemSchema = z.object({
  currentStation: z.string().min(1).optional(),
  routing: z.array(z.string().min(1)).optional(),
  customRouting: z.boolean().optional(),
  dimensions: z.object({
    width: z.number().min(0).optional(),
    height: z.number().min(0).optional(),
    thickness: z.number().min(0).optional(),
  }).optional(),
  glassType: z.string().optional(),
  glassTypeLabel: z.string().optional(),
  processes: z.array(z.string().min(1)).optional(),
  edgeTasks: z.array(z.object({
    side: z.string().min(1),
    edgeProfile: z.string().min(1),
    machineType: z.string().min(1).optional(),
    status: z.enum(['pending', 'in_progress', 'completed']).optional(),
  })).optional(),
  notes: z.string().optional(),
});

const createSchema = z.object({
  body: z.object({
    details: detailsSchema,
    customer: z.string().min(1),
    deadline: z.string().datetime().optional(),
    deliveryLocation: z.string().optional(),
    assignedTo: z.string().min(1).optional(),
    expectedDeliveryDate: z.string().datetime().optional(),
    panes: z.array(paneItemSchema).optional(),
  }),
});

const updateSchema = z.object({
  body: z.object({
    details: detailsSchema.partial().optional(),
    customer: z.string().min(1).optional(),
    deadline: z.string().datetime().optional(),
    deliveryLocation: z.string().optional(),
    assignedTo: z.string().min(1).optional(),
    expectedDeliveryDate: z.string().datetime().optional(),
  }),
});

const deleteManySchema = z.object({
  body: z.object({
    ids: z.array(z.string().min(1)).min(1),
  }),
});

router.get('/', auth, authorize('admin', 'manager'), requestController.getAll);
router.get('/:id', auth, authorize('admin', 'manager'), requestController.getById);
router.post('/', auth, authorize('admin', 'manager'), validate(createSchema), requestController.create);
router.patch('/:id', auth, authorize('admin', 'manager'), validate(updateSchema), requestController.update);
router.delete('/', auth, authorize('admin', 'manager'), validate(deleteManySchema), requestController.deleteMany);
router.delete('/:id', auth, authorize('admin', 'manager'), requestController.deleteOne);

module.exports = router;
