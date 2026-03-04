const { Router } = require('express');
const { success } = require('../utils/response');

const router = Router();

router.get('/', (req, res) => {
  success(res, {
    status: 'healthy',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
