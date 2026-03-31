const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const requirePermission = require('../middleware/requirePermission');
const customerController = require('../controllers/customer.controller');

const router = Router();

const createSchema = z.object({
  body: z.object({
    name: z.string().min(1),
    address: z.string().optional(),
    phone: z.string().optional(),
    discount: z.number().min(0).max(100).optional(),
    notes: z.string().optional(),
  }),
});

const updateSchema = z.object({
  body: z.object({
    name: z.string().min(1).optional(),
    address: z.string().optional(),
    phone: z.string().optional(),
    discount: z.number().min(0).max(100).optional(),
    notes: z.string().optional(),
  }),
});

const deleteManySchema = z.object({
  body: z.object({
    ids: z.array(z.string().min(1)).min(1),
  }),
});

router.get('/', auth, requirePermission('customers:view'), customerController.getAll);
router.get('/:id', auth, requirePermission('customers:view'), customerController.getById);
router.post('/', auth, requirePermission('customers:manage'), validate(createSchema), customerController.create);
router.patch('/:id', auth, requirePermission('customers:manage'), validate(updateSchema), customerController.update);
router.delete('/', auth, requirePermission('customers:manage'), validate(deleteManySchema), customerController.deleteMany);
router.delete('/:id', auth, requirePermission('customers:manage'), customerController.deleteOne);

module.exports = router;
