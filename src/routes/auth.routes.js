const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const authController = require('../controllers/auth.controller');

const router = Router();

const loginSchema = z.object({
  body: z.object({
    username: z.string().min(1),
    password: z.string().min(1),
  }),
});

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

const updateMeSchema = z.object({
  body: z.object({
    name: z.string().min(1).optional(),
    username: z.string().min(1).optional(),
    notificationPreferences: notificationPreferencesSchema,
  }),
});

router.post('/login', validate(loginSchema), authController.login);
router.post('/logout', auth, authController.logout);
router.get('/me', auth, authController.getMe);
router.patch('/me', auth, validate(updateMeSchema), authController.updateMe);

module.exports = router;
