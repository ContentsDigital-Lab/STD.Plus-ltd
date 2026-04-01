const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const requirePermission = require('../middleware/requirePermission');
const paneController = require('../controllers/pane.controller');

const router = Router();

const PANE_STATUS = ['pending', 'in_progress', 'awaiting_scan_out', 'completed'];
const EDGE_STATUS = ['pending', 'in_progress', 'completed'];

const dimensionsSchema = z.object({
  width: z.number().min(0).optional(),
  height: z.number().min(0).optional(),
  thickness: z.number().min(0).optional(),
}).optional();

const rawGlassSchema = z.object({
  glassType:     z.string().optional(),
  color:         z.string().optional(),
  thickness:     z.number().min(0).optional(),
  sheetsPerPane: z.number().int().min(1).optional(),
}).optional();

const edgeTaskSchema = z.object({
  side: z.string().min(1),
  edgeProfile: z.string().min(1),
  machineType: z.string().min(1).optional(),
  status: z.enum(EDGE_STATUS).optional(),
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

const createSchema = z.object({
  body: z.object({
    paneNumber:    z.string().min(1).optional(),
    qrCode:        z.string().optional(),
    order:         z.string().optional(),
    request:       z.string().optional(),
    material:      z.string().optional(),
    inventory:     z.string().optional(),
    currentStation:z.string().optional(),
    currentStatus: z.enum(PANE_STATUS).optional(),
    routing:       z.array(z.string()).optional(),
    customRouting: z.boolean().optional(),
    dimensions:    dimensionsSchema,
    jobType:       z.string().optional(),
    rawGlass:      rawGlassSchema,
    glassType:     z.string().optional(),
    glassTypeLabel:z.string().optional(),
    holes:         z.array(holeNotchSchema).optional(),
    notches:       z.array(holeNotchSchema).optional(),
    processes:     z.array(z.string().min(1)).optional(),
    edgeTasks:     z.array(edgeTaskSchema).optional(),
    withdrawal:    z.string().min(1).optional(),
    remakeOf:      z.string().min(1).optional(),
    startedAt:     z.string().datetime().optional(),
    completedAt:   z.string().datetime().optional(),
    deliveredAt:   z.string().datetime().optional(),
    notes:         z.string().optional(),
  }),
});

const updateSchema = z.object({
  body: z.object({
    paneNumber:    z.string().min(1).optional(),
    qrCode:        z.string().optional(),
    order:         z.string().min(1).optional(),
    request:       z.string().min(1).optional(),
    currentStation:z.string().min(1).optional(),
    currentStatus: z.enum(PANE_STATUS).optional(),
    routing:       z.array(z.string().min(1)).optional(),
    customRouting: z.boolean().optional(),
    dimensions:    dimensionsSchema,
    jobType:       z.string().optional(),
    rawGlass:      rawGlassSchema,
    glassType:     z.string().optional(),
    glassTypeLabel:z.string().optional(),
    holes:         z.array(holeNotchSchema).optional(),
    notches:       z.array(holeNotchSchema).optional(),
    processes:     z.array(z.string().min(1)).optional(),
    edgeTasks:     z.array(edgeTaskSchema).optional(),
    withdrawal:    z.string().min(1).optional(),
    remakeOf:      z.string().min(1).optional(),
    startedAt:     z.string().datetime().optional(),
    completedAt:   z.string().datetime().optional(),
    deliveredAt:   z.string().datetime().optional(),
    notes:         z.string().optional(),
  }),
});

const deleteManySchema = z.object({
  body: z.object({
    ids: z.array(z.string().min(1)).min(1),
  }),
});

const scanSchema = z.object({
  body: z.object({
    station: z.string().min(1),
    action: z.enum(['scan_in', 'start', 'complete', 'scan_out']),
    operator: z.string().min(1).optional(),
  }),
});

router.get('/',                    auth, requirePermission('panes:view'), paneController.getAll);
router.get('/:id',                 auth, requirePermission('panes:view'), paneController.getById);
router.post('/',                   auth, requirePermission('panes:create'), validate(createSchema), paneController.create);
router.patch('/:id',               auth, requirePermission('panes:manage'), validate(updateSchema), paneController.update);
router.delete('/',                 auth, requirePermission('panes:manage'), validate(deleteManySchema), paneController.deleteMany);
router.delete('/:id',              auth, requirePermission('panes:manage'), paneController.deleteOne);
router.post('/:paneNumber/scan',   auth, requirePermission('panes:scan'), validate(scanSchema), paneController.scan);

module.exports = router;
