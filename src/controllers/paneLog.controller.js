const PaneLog = require('../models/PaneLog');
const { success, fail } = require('../utils/response');

// ── GET /production-logs ──────────────────────────────────────────────────────
exports.getAll = async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.station) filter.station = req.query.station;
    if (req.query.action)  filter.action  = req.query.action;
    if (req.query.orderId) filter.order   = req.query.orderId;
    if (req.query.paneId)  filter.pane    = req.query.paneId;

    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 100));

    const logs = await PaneLog.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate({ path: 'pane', select: 'paneNumber glassTypeLabel' })
      .lean();

    // Map pane → paneId for frontend compatibility
    const mapped = logs.map(l => ({
      ...l,
      paneId:  l.pane,
      orderId: l.order,
    }));

    success(res, mapped);
  } catch (err) {
    next(err);
  }
};
