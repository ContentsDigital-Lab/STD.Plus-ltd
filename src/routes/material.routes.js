const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const requirePermission = require('../middleware/requirePermission');
const materialController = require('../controllers/material.controller');

const router = Router();

const specDetailsSchema = z.object({
  thickness: z.string().optional(),
  color: z.string().optional(),
  glassType: z.string().optional(),
  width: z.string().optional(),
  length: z.string().optional(),
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

router.get('/', auth, requirePermission('materials:view'), materialController.getAll);
router.get('/:id', auth, requirePermission('materials:view'), materialController.getById);
router.post('/', auth, requirePermission('materials:manage'), validate(createSchema), materialController.create);
router.patch('/:id', auth, requirePermission('materials:manage'), validate(updateSchema), materialController.update);
router.delete('/', auth, requirePermission('materials:manage'), validate(deleteManySchema), materialController.deleteMany);
router.delete('/:id', auth, requirePermission('materials:manage'), materialController.deleteOne);

module.exports = router;
