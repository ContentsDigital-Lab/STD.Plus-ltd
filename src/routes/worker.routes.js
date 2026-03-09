const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const workerController = require('../controllers/worker.controller');

const router = Router();

const createSchema = z.object({
  body: z.object({
    name: z.string().min(1),
    username: z.string().min(1),
    password: z.string().min(6),
    position: z.string().min(1),
    role: z.enum(['admin', 'manager', 'worker']).optional(),
  }),
});

const updateSchema = z.object({
  body: z.object({
    name: z.string().min(1).optional(),
    username: z.string().min(1).optional(),
    password: z.string().min(6).optional(),
    position: z.string().min(1).optional(),
    role: z.enum(['admin', 'manager', 'worker']).optional(),
  }),
});

const deleteManySchema = z.object({
  body: z.object({
    ids: z.array(z.string().min(1)).min(1),
  }),
});

router.get('/', auth, workerController.getAll);
router.get('/:id', auth, workerController.getById);
router.post('/', auth, authorize('admin'), validate(createSchema), workerController.create);
router.patch('/:id', auth, authorize('admin'), validate(updateSchema), workerController.update);
router.delete('/', auth, authorize('admin'), validate(deleteManySchema), workerController.deleteMany);
router.delete('/:id', auth, authorize('admin'), workerController.deleteOne);

module.exports = router;
