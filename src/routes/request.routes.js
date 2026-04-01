const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const requirePermission = require('../middleware/requirePermission');
const requestController = require('../controllers/request.controller');

const router = Router();

const detailsSchema = z.object({
  type: z.string().min(1),
  estimatedPrice: z.number().min(0).optional(),
  quantity: z.number().min(1),
});

const vertexSchema = z.object({
  x: z.number(),
  y: z.number(),
});

const holeNotchSchema = z.object({
  id:       z.string().min(1),
  type:     z.enum(['circle', 'rectangle', 'slot', 'custom']),
  x:        z.number(),
  y:        z.number(),
  diameter: z.number().optional(),
  width:    z.number().optional(),
  height:   z.number().optional(),
  length:   z.number().optional(),
  vertices: z.array(vertexSchema).optional(),
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
  jobType: z.string().optional(),
  rawGlass: z.object({
    glassType:     z.string().optional(),
    color:         z.string().optional(),
    thickness:     z.number().min(0).optional(),
    sheetsPerPane: z.number().int().min(1).optional(),
  }).optional(),
  glassType: z.string().optional(),
  glassTypeLabel: z.string().optional(),
  holes: z.array(holeNotchSchema).optional(),
  notches: z.array(holeNotchSchema).optional(),
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

router.get('/', auth, requirePermission('requests:view'), requestController.getAll);
router.get('/:id', auth, requirePermission('requests:view'), requestController.getById);
router.post('/', auth, requirePermission('requests:manage'), validate(createSchema), requestController.create);
router.patch('/:id', auth, requirePermission('requests:manage'), validate(updateSchema), requestController.update);
router.delete('/', auth, requirePermission('requests:manage'), validate(deleteManySchema), requestController.deleteMany);
router.delete('/:id', auth, requirePermission('requests:manage'), requestController.deleteOne);

module.exports = router;
