const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const materialController = require('../controllers/material.controller');

const router = Router();

const specDetailsSchema = z.object({
  thickness: z.string().optional(),
  color: z.string().optional(),
  glassType: z.string().optional(),
}).optional();

const createSchema = z.object({
  body: z.object({
    name: z.string().min(1),
    unit: z.string().min(1),
    reorderPoint: z.number().min(0),
    specDetails: specDetailsSchema,
  }),
});

const updateSchema = z.object({
  body: z.object({
    name: z.string().min(1).optional(),
    unit: z.string().min(1).optional(),
    reorderPoint: z.number().min(0).optional(),
    specDetails: specDetailsSchema,
  }),
});

const deleteManySchema = z.object({
  body: z.object({
    ids: z.array(z.string().min(1)).min(1),
  }),
});

router.get('/', auth, materialController.getAll);
router.get('/:id', auth, materialController.getById);
router.post('/', auth, authorize('admin', 'manager'), validate(createSchema), materialController.create);
router.patch('/:id', auth, authorize('admin', 'manager'), validate(updateSchema), materialController.update);
router.delete('/', auth, authorize('admin'), validate(deleteManySchema), materialController.deleteMany);
router.delete('/:id', auth, authorize('admin'), materialController.deleteOne);

module.exports = router;
