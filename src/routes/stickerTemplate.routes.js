const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const stickerTemplateController = require('../controllers/stickerTemplate.controller');

const router = Router();

const createSchema = z.object({
  body: z.object({
    name: z.string().min(1).optional(),
    width: z.number().min(0),
    height: z.number().min(0),
    elements: z.any().optional(),
  }),
});

const updateSchema = z.object({
  body: z.object({
    name: z.string().min(1).optional(),
    width: z.number().min(0).optional(),
    height: z.number().min(0).optional(),
    elements: z.any().optional(),
  }),
});

const deleteManySchema = z.object({
  body: z.object({
    ids: z.array(z.string().min(1)).min(1),
  }),
});

router.get('/', auth, stickerTemplateController.getAll);
router.get('/:id', auth, stickerTemplateController.getById);
router.post('/', auth, authorize('admin', 'manager'), validate(createSchema), stickerTemplateController.create);
router.patch('/:id', auth, authorize('admin', 'manager'), validate(updateSchema), stickerTemplateController.update);
router.delete('/', auth, authorize('admin'), validate(deleteManySchema), stickerTemplateController.deleteMany);
router.delete('/:id', auth, authorize('admin'), stickerTemplateController.deleteOne);

module.exports = router;
