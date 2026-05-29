const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const requirePermission = require('../middleware/requirePermission');
const authorize = require('../middleware/authorize');
const materialLogController = require('../controllers/materialLog.controller');

const router = Router();

const createSchema = z.object({
  body: z.object({
    material: z.string().min(1),
    panes: z.array(z.string().min(1)).optional(),
    actionType: z.enum(['withdraw', 'claim', 'import', 'cut', 'remake']),
    referenceId: z.string().min(1).optional(),
    referenceType: z.enum(['claim', 'withdrawal', 'qc_remake']).optional(),
    quantityChanged: z.number(),
    totalPrice: z.number().min(0).optional(),
    stockType: z.enum(['Raw', 'Reuse']).optional(),
    order: z.string().min(1).optional(),
    parentLog: z.string().min(1).optional(),
    worker: z.string().min(1).optional(),
  }),
});

const updateSchema = z.object({
  body: z.object({
    material: z.string().min(1).optional(),
    panes: z.array(z.string().min(1)).optional(),
    actionType: z.enum(['withdraw', 'claim', 'import', 'cut', 'remake']).optional(),
    referenceId: z.string().min(1).optional(),
    referenceType: z.enum(['claim', 'withdrawal', 'qc_remake']).optional(),
    quantityChanged: z.number().optional(),
    totalPrice: z.number().min(0).optional(),
    stockType: z.enum(['Raw', 'Reuse']).optional(),
    order: z.string().min(1).optional(),
    parentLog: z.string().min(1).optional(),
    worker: z.string().min(1).optional(),
  }),
});

const deleteManySchema = z.object({
  body: z.object({
    ids: z.array(z.string().min(1)).min(1),
  }),
});

router.get('/', auth, authorize('inventory:view', 'dashboard:view'), materialLogController.getAll);
router.get('/:id', auth, authorize('inventory:view', 'dashboard:view'), materialLogController.getById);
router.post('/', auth, requirePermission('inventory:manage'), validate(createSchema), materialLogController.create);
router.patch('/:id', auth, requirePermission('inventory:manage'), validate(updateSchema), materialLogController.update);
router.delete('/', auth, requirePermission('inventory:manage'), validate(deleteManySchema), materialLogController.deleteMany);
router.delete('/:id', auth, requirePermission('inventory:manage'), materialLogController.deleteOne);

module.exports = router;
