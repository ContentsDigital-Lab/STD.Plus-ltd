const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const materialLogController = require('../controllers/materialLog.controller');

const router = Router();

const createSchema = z.object({
  body: z.object({
    material: z.string().min(1),
    pane: z.string().min(1).optional(),
    actionType: z.enum(['withdraw', 'claim', 'import', 'cut', 'remake']),
    referenceId: z.string().min(1).optional(),
    referenceType: z.enum(['claim', 'withdrawal']).optional(),
    quantityChanged: z.number(),
    totalPrice: z.number().min(0).optional(),
    stockType: z.enum(['Raw', 'Reuse']).optional(),
    order: z.string().min(1).optional(),
    parentLog: z.string().min(1).optional(),
  }),
});

const updateSchema = z.object({
  body: z.object({
    material: z.string().min(1).optional(),
    pane: z.string().min(1).optional(),
    actionType: z.enum(['withdraw', 'claim', 'import', 'cut', 'remake']).optional(),
    referenceId: z.string().min(1).optional(),
    referenceType: z.enum(['claim', 'withdrawal']).optional(),
    quantityChanged: z.number().optional(),
    totalPrice: z.number().min(0).optional(),
    stockType: z.enum(['Raw', 'Reuse']).optional(),
    order: z.string().min(1).optional(),
    parentLog: z.string().min(1).optional(),
  }),
});

const deleteManySchema = z.object({
  body: z.object({
    ids: z.array(z.string().min(1)).min(1),
  }),
});

router.get('/', auth, materialLogController.getAll);
router.get('/:id', auth, materialLogController.getById);
router.post('/', auth, authorize('admin', 'manager'), validate(createSchema), materialLogController.create);
router.patch('/:id', auth, authorize('admin', 'manager'), validate(updateSchema), materialLogController.update);
router.delete('/', auth, authorize('admin'), validate(deleteManySchema), materialLogController.deleteMany);
router.delete('/:id', auth, authorize('admin'), materialLogController.deleteOne);

module.exports = router;
