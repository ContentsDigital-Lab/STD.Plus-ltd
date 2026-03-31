const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const requirePermission = require('../middleware/requirePermission');
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

router.get('/',       auth, requirePermission('job_types:view'), jobTypeController.getAll);
router.get('/:id',    auth, requirePermission('job_types:view'), jobTypeController.getById);
router.post('/',      auth, requirePermission('job_types:manage'), validate(createSchema), jobTypeController.create);
router.patch('/:id',  auth, requirePermission('job_types:manage'), validate(updateSchema), jobTypeController.update);
router.delete('/',    auth, requirePermission('job_types:manage'), validate(deleteManySchema), jobTypeController.deleteMany);
router.delete('/:id', auth, requirePermission('job_types:manage'), jobTypeController.deleteOne);

module.exports = router;
