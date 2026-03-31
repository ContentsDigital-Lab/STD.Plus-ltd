const { Router } = require('express');
const auth = require('../middleware/auth');
const requirePermission = require('../middleware/requirePermission');
const paneLogController = require('../controllers/paneLog.controller');

const router = Router();

router.get('/timeline', auth, requirePermission('pane_logs:view'), paneLogController.getTimeline);
router.get('/',         auth, requirePermission('pane_logs:view'), paneLogController.getAll);

module.exports = router;
