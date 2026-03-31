const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const requirePermission = require('../middleware/requirePermission');
const workerController = require('../controllers/worker.controller');

const router = Router();

const notificationPreferencesSchema = z.object({
  enabled: z.boolean().optional(),
  volume: z.number().min(0).max(1).optional(),
  sounds: z.object({
    low: z.string().min(1).optional(),
    medium: z.string().min(1).optional(),
    high: z.string().min(1).optional(),
    urgent: z.string().min(1).optional(),
  }).optional(),
}).optional();

const createSchema = z.object({
  body: z.object({
    name: z.string().min(1),
    username: z.string().min(1),
    password: z.string().min(6),
    position: z.string().min(1),
    role: z.string().min(1),
    notificationPreferences: notificationPreferencesSchema,
  }),
});

const updateSchema = z.object({
  body: z.object({
    name: z.string().min(1).optional(),
    username: z.string().min(1).optional(),
    password: z.string().min(6).optional(),
    position: z.string().min(1).optional(),
    role: z.string().min(1).optional(),
    notificationPreferences: notificationPreferencesSchema,
  }),
});

const deleteManySchema = z.object({
  body: z.object({
    ids: z.array(z.string().min(1)).min(1),
  }),
});

router.get('/', auth, requirePermission('workers:view'), workerController.getAll);
router.get('/:id', auth, requirePermission('workers:view'), workerController.getById);
router.post('/', auth, requirePermission('workers:manage'), validate(createSchema), workerController.create);
router.patch('/:id', auth, requirePermission('workers:manage'), validate(updateSchema), workerController.update);
router.delete('/', auth, requirePermission('workers:manage'), validate(deleteManySchema), workerController.deleteMany);
router.delete('/:id', auth, requirePermission('workers:manage'), workerController.deleteOne);

module.exports = router;
