const { Router } = require('express');
const auth = require('../middleware/auth');
const paneLogController = require('../controllers/paneLog.controller');

const router = Router();

router.get('/', auth, paneLogController.getAll);

module.exports = router;
