const express = require('express');
const { getStats } = require('../controllers/dashboard.controller');
const auth = require('../middleware/auth');

const router = express.Router();

router.use(auth);

router.get('/stats', getStats);

module.exports = router;
