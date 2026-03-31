const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const requirePermission = require('../middleware/requirePermission');
const roleController = require('../controllers/role.controller');

const router = Router();

const createSchema = z.object({
  body: z.object({
    name: z.string().min(1),
    slug: z.string().min(1),
    permissions: z.array(z.string().min(1)).default([]),
  }),
});

const updateSchema = z.object({
  body: z.object({
    name: z.string().min(1).optional(),
    slug: z.string().min(1).optional(),
    permissions: z.array(z.string().min(1)).optional(),
  }),
});

const deleteManySchema = z.object({
  body: z.object({
    ids: z.array(z.string().min(1)).min(1),
  }),
});

router.get('/permissions', auth, roleController.getPermissions);
router.get('/', auth, requirePermission('roles:view'), roleController.getAll);
router.get('/:id', auth, requirePermission('roles:view'), roleController.getById);
router.post('/', auth, requirePermission('roles:manage'), validate(createSchema), roleController.create);
router.patch('/:id', auth, requirePermission('roles:manage'), validate(updateSchema), roleController.update);
router.delete('/', auth, requirePermission('roles:manage'), validate(deleteManySchema), roleController.deleteMany);
router.delete('/:id', auth, requirePermission('roles:manage'), roleController.deleteOne);

module.exports = router;
