const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const requirePermission = require('../middleware/requirePermission');
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

router.get('/', auth, requirePermission('sticker_templates:view'), stickerTemplateController.getAll);
router.get('/:id', auth, requirePermission('sticker_templates:view'), stickerTemplateController.getById);
router.post('/', auth, requirePermission('sticker_templates:manage'), validate(createSchema), stickerTemplateController.create);
router.patch('/:id', auth, requirePermission('sticker_templates:manage'), validate(updateSchema), stickerTemplateController.update);
router.delete('/', auth, requirePermission('sticker_templates:manage'), validate(deleteManySchema), stickerTemplateController.deleteMany);
router.delete('/:id', auth, requirePermission('sticker_templates:manage'), stickerTemplateController.deleteOne);

module.exports = router;
