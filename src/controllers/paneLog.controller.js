const PaneLog       = require('../models/PaneLog');
const MaterialLog   = require('../models/MaterialLog');
const { success, fail } = require('../utils/response');

// ── GET /production-logs ──────────────────────────────────────────────────────
exports.getAll = async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.station)    filter.station  = req.query.station;
    if (req.query.action)     filter.action   = req.query.action;
    if (req.query.orderId)    filter.order    = req.query.orderId;
    if (req.query.paneId)     filter.pane     = req.query.paneId;
    if (req.query.materialId) filter.material = req.query.materialId;

    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 100));

    const logs = await PaneLog.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate({ path: 'pane', select: 'paneNumber glassTypeLabel' })
      .populate({ path: 'station', select: 'name' })
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

// ── GET /production-logs/timeline?materialId=X ────────────────────────────────
// Returns a merged, chronologically-sorted timeline of every event for a material:
//   MaterialLog  → import / move / cut (stock-level events)
//   PaneLog      → scan_in / start / complete at each station (pane-level events)
exports.getTimeline = async (req, res, next) => {
  try {
    const { materialId } = req.query;
    if (!materialId) return fail(res, 'materialId is required', 400);

    const [matLogs, paneLogs] = await Promise.all([
      MaterialLog.find({ material: materialId })
        .sort({ createdAt: 1 })
        .populate({ path: 'order', select: 'orderNumber code' })
        .populate({ path: 'parentLog', select: 'actionType createdAt' })
        .lean(),
      PaneLog.find({ material: materialId })
        .sort({ createdAt: 1 })
        .populate({ path: 'pane',    select: 'paneNumber glassTypeLabel dimensions' })
        .populate({ path: 'order',   select: 'orderNumber code' })
        .populate({ path: 'worker',  select: 'name username role' })
        .populate({ path: 'station', select: 'name' })
        .lean(),
    ]);

    const timeline = [
      ...matLogs.map(l => ({ ...l, logType: 'material_log' })),
      ...paneLogs.map(l => ({ ...l, logType: 'pane_log', paneId: l.pane, orderId: l.order })),
    ].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    success(res, timeline);
  } catch (err) {
    next(err);
  }
};
