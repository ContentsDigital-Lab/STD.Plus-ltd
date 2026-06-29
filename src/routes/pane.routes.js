const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const requirePermission = require('../middleware/requirePermission');
const authorize = require('../middleware/authorize');
const paneController = require('../controllers/pane.controller');

const router = Router();

const PANE_STATUS = ['pending', 'in_progress', 'awaiting_scan_out', 'completed', 'claimed', 'defected', 'merged_into'];
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
    glassType:          z.string().optional(),
    glassTypeLabel:     z.string().optional(),
    cornerSpec:         z.string().optional(),
    dimensionTolerance: z.string().optional(),
    holes:         z.array(holeNotchSchema).optional(),
    notches:       z.array(holeNotchSchema).optional(),
    processes:     z.array(z.string().min(1)).optional(),
    edgeTasks:     z.array(edgeTaskSchema).optional(),
    withdrawal:    z.string().min(1).optional(),
    remakeOf:      z.string().min(1).optional(),
    laminateRole:    z.enum(['single', 'parent', 'sheet']).optional(),
    parentPane:      z.string().min(1).optional(),
    childPanes:      z.array(z.string().min(1)).optional(),
    sheetLabel:      z.string().optional(),
    laminateStation: z.string().min(1).optional(),
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
    glassType:          z.string().optional(),
    glassTypeLabel:     z.string().optional(),
    cornerSpec:         z.string().optional(),
    dimensionTolerance: z.string().optional(),
    holes:         z.array(holeNotchSchema).optional(),
    notches:       z.array(holeNotchSchema).optional(),
    processes:     z.array(z.string().min(1)).optional(),
    edgeTasks:     z.array(edgeTaskSchema).optional(),
    withdrawal:    z.string().min(1).optional(),
    remakeOf:      z.string().min(1).optional(),
    laminateRole:    z.enum(['single', 'parent', 'sheet']).optional(),
    parentPane:      z.string().min(1).optional(),
    childPanes:      z.array(z.string().min(1)).optional(),
    sheetLabel:      z.string().optional(),
    laminateStation: z.string().min(1).optional(),
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

const QC_DEFECT_REASON = z.enum(['broken', 'chipped', 'dimension_wrong', 'scratch', 'stain', 'other']);

const scanSchema = z.object({
  body: z
    .object({
      station: z.string().min(1),
      action: z.enum(['scan_in', 'start', 'complete', 'scan_out', 'laminate', 'qc_pass', 'qc_fail']),
      operator: z.string().min(1).optional(),
      reason: QC_DEFECT_REASON.optional(),
      description: z.string().optional(),
      remakeStationId: z.string().min(1).optional(),
      laminateSurvivorPaneNumber: z.string().min(1).optional(),
    })
    .superRefine((val, ctx) => {
      if (val.action === 'qc_fail' && val.reason === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'reason is required when action is qc_fail', path: ['reason'] });
      }
    }),
});

const batchScanSchema = z.object({
  body: z.object({
    paneNumbers: z.array(z.string().min(1)).min(1),
    station:     z.string().min(1),
    action:      z.enum(['scan_in', 'start', 'complete']),
  }),
});

const allowStationView = (req, res, next) => {
  const perms = req.user?.role?.permissions || [];
  const isAdmin = req.user?.role?.slug === 'admin' || perms.includes('*');
  const hasGlobalView = ['production:view', 'orders:view'].some(p => perms.includes(p));
  const hasAnyStationAccess = perms.some(p => p.startsWith('station:enter:'));
  
  if (isAdmin || hasGlobalView || hasAnyStationAccess) return next();
  const AppError = require('../utils/AppError');
  return next(new AppError('Not authorized for this action', 403));
};

const allowPaneUpdate = (req, res, next) => {
  const perms = req.user?.role?.permissions || [];
  const isAdmin = req.user?.role?.slug === 'admin' || perms.includes('*');
  const hasGlobalManage = ['production:manage', 'orders:create', 'orders:manage'].some(p => perms.includes(p));
  const hasAnyStationAccess = perms.some(p => p.startsWith('station:enter:'));
  
  if (isAdmin || hasGlobalManage || hasAnyStationAccess) return next();
  const AppError = require('../utils/AppError');
  return next(new AppError('Not authorized for this action', 403));
};

router.get('/',                    auth, allowStationView, paneController.getAll);
router.get('/pending-counts',      auth, allowStationView, paneController.getPendingCounts);
router.get('/:id',                 auth, allowStationView, paneController.getById);
router.post('/',                   auth, authorize('production:manage', 'orders:create', 'orders:manage'), validate(createSchema), paneController.create);
router.patch('/:id',               auth, allowPaneUpdate, validate(updateSchema), paneController.update);
router.delete('/',                 auth, authorize('production:manage', 'orders:manage'), validate(deleteManySchema), paneController.deleteMany);
router.delete('/:id',              auth, authorize('production:manage', 'orders:manage'), paneController.deleteOne);
const allowScan = (req, res, next) => {
  const perms = req.user?.role?.permissions || [];
  const isAdmin = req.user?.role?.slug === 'admin' || perms.includes('*');
  const hasGlobalManage = perms.includes('production:manage');
  const stationId = req.body?.station;
  const hasStationAccess = stationId && perms.includes(`station:enter:${stationId}`);
  
  if (isAdmin || hasGlobalManage || hasStationAccess) return next();
  const AppError = require('../utils/AppError');
  return next(new AppError('Not authorized to scan at this station', 403));
};

router.post('/:paneNumber/scan',   auth, allowScan, validate(scanSchema), paneController.scan);
router.post('/batch-scan',         auth, allowScan, validate(batchScanSchema), paneController.batchScan);

module.exports = router;
