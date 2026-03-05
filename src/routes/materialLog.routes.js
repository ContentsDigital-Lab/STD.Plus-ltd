const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const materialLogController = require('../controllers/materialLog.controller');

const router = Router();

const createSchema = z.object({
  body: z.object({
    material: z.string().min(1),
    actionType: z.enum(['withdraw', 'claim', 'import', 'cut']),
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
    actionType: z.enum(['withdraw', 'claim', 'import', 'cut']).optional(),
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
router.post('/', auth, validate(createSchema), materialLogController.create);
router.patch('/:id', auth, validate(updateSchema), materialLogController.update);
router.delete('/', auth, validate(deleteManySchema), materialLogController.deleteMany);
router.delete('/:id', auth, materialLogController.deleteOne);

module.exports = router;
