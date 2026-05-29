const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const roleController = require('../controllers/role.controller');

const router = Router();

const createSchema = z.object({
  body: z.object({
    name: z.string().min(1),
    slug: z.string().min(1).optional(),
    description: z.string().optional(),
    permissions: z.array(z.string()).optional(),
  }),
});

const updateSchema = z.object({
  body: z.object({
    name: z.string().min(1).optional(),
    slug: z.string().min(1).optional(),
    description: z.string().optional(),
    permissions: z.array(z.string()).optional(),
  }),
});

router.get('/', auth, roleController.getAll);
router.get('/permissions', auth, roleController.getPermissions);
router.get('/:id', auth, roleController.getById);
router.post('/', auth, authorize('admin', 'roles:manage'), validate(createSchema), roleController.create);
router.patch('/:id', auth, authorize('admin', 'roles:manage'), validate(updateSchema), roleController.update);
router.delete('/:id', auth, authorize('admin', 'roles:manage'), roleController.delete);

module.exports = router;
