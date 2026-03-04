const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const workerController = require('../controllers/worker.controller');

const router = Router();

const createSchema = z.object({
  body: z.object({
    name: z.string().min(1),
    username: z.string().min(1),
    password: z.string().min(6),
    position: z.string().min(1),
  }),
});

const updateSchema = z.object({
  body: z.object({
    name: z.string().min(1).optional(),
    username: z.string().min(1).optional(),
    password: z.string().min(6).optional(),
    position: z.string().min(1).optional(),
  }),
});

const deleteManySchema = z.object({
  body: z.object({
    ids: z.array(z.string().min(1)).min(1),
  }),
});

router.get('/', auth, workerController.getAll);
router.get('/:id', auth, workerController.getById);
router.post('/', auth, validate(createSchema), workerController.create);
router.patch('/:id', auth, validate(updateSchema), workerController.update);
router.delete('/', auth, validate(deleteManySchema), workerController.deleteMany);
router.delete('/:id', auth, workerController.deleteOne);

module.exports = router;
