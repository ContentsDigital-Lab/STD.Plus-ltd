const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const requirePermission = require('../middleware/requirePermission');
const authorize = require('../middleware/authorize');
const jobTypeController = require('../controllers/jobType.controller');

const router = Router();

const createSchema = z.object({
  body: z.object({
    name: z.string().min(1),
    code: z.string().min(1),
    description: z.string().optional(),
    sheetsPerPane: z.number().int().min(1).optional(),
    defaultRawGlassTypes: z.array(z.string().min(1)).optional(),
    isActive: z.boolean().optional(),
  }),
});

const updateSchema = z.object({
  body: z.object({
    name: z.string().min(1).optional(),
    code: z.string().min(1).optional(),
    description: z.string().optional(),
    sheetsPerPane: z.number().int().min(1).optional(),
    defaultRawGlassTypes: z.array(z.string().min(1)).optional(),
    isActive: z.boolean().optional(),
  }),
});

const deleteManySchema = z.object({
  body: z.object({
    ids: z.array(z.string().min(1)).min(1),
  }),
});

router.get('/',       auth, authorize('settings:view', 'orders:view', 'orders:create'), jobTypeController.getAll);
router.get('/:id',    auth, authorize('settings:view', 'orders:view', 'orders:create'), jobTypeController.getById);
router.post('/',      auth, requirePermission('settings:manage'), validate(createSchema), jobTypeController.create);
router.patch('/:id',  auth, requirePermission('settings:manage'), validate(updateSchema), jobTypeController.update);
router.delete('/',    auth, requirePermission('settings:manage'), validate(deleteManySchema), jobTypeController.deleteMany);
router.delete('/:id', auth, requirePermission('settings:manage'), jobTypeController.deleteOne);

module.exports = router;
