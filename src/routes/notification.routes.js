const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const notificationController = require('../controllers/notification.controller');

const router = Router();

const createSchema = z.object({
  body: z.object({
    recipient: z.string().min(1),
    type: z.string().min(1),
    title: z.string().min(1),
    message: z.string().optional(),
    referenceId: z.string().min(1).optional(),
    referenceType: z.string().min(1).optional(),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
    readStatus: z.boolean().optional(),
  }),
});

const updateSchema = z.object({
  body: z.object({
    type: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    message: z.string().optional(),
    referenceId: z.string().min(1).optional(),
    referenceType: z.string().min(1).optional(),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
    readStatus: z.boolean().optional(),
  }),
});

const deleteManySchema = z.object({
  body: z.object({
    ids: z.array(z.string().min(1)).min(1),
  }),
});

router.get('/', auth, notificationController.getAll);
router.get('/:id', auth, notificationController.getById);
router.post('/', auth, authorize('admin', 'manager'), validate(createSchema), notificationController.create);
router.patch('/:id', auth, validate(updateSchema), notificationController.update);
router.delete('/', auth, authorize('admin', 'manager'), validate(deleteManySchema), notificationController.deleteMany);
router.delete('/:id', auth, authorize('admin', 'manager'), notificationController.deleteOne);

module.exports = router;
