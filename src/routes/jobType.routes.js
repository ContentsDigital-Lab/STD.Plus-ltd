const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
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

router.get('/',       auth, jobTypeController.getAll);
router.get('/:id',    auth, jobTypeController.getById);
router.post('/',      auth, authorize('admin', 'manager'), validate(createSchema), jobTypeController.create);
router.patch('/:id',  auth, authorize('admin', 'manager'), validate(updateSchema), jobTypeController.update);
router.delete('/',    auth, authorize('admin'), validate(deleteManySchema), jobTypeController.deleteMany);
router.delete('/:id', auth, authorize('admin'), jobTypeController.deleteOne);

module.exports = router;
