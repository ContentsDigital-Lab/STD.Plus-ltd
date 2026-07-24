const Request = require('../models/Request');
const Order = require('../models/Order');
const Inventory = require('../models/Inventory');
const MaterialLog = require('../models/MaterialLog');
const { success } = require('../utils/response');

exports.getStats = async (req, res, next) => {
  try {
    const chartRange = req.query.chartRange || '7d';
    const now = new Date();

    const isToday = chartRange === '1d';
    const dayCount = chartRange === '30d' ? 30 : 7;

    const days = [];
    if (isToday) {
      for (let h = 0; h < 24; h++) {
        const d = new Date(now);
        d.setHours(h, 0, 0, 0);
        days.push({ label: `${String(h).padStart(2, '0')}:00`, date: d, hourStart: h });
      }
    } else {
      for (let i = dayCount - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const label = dayCount <= 7 
          ? d.toLocaleDateString('th-TH', { weekday: 'short' })
          : d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
        days.push({ label, date: d });
      }
    }

    const isSameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    
    const matchBucket = (ts) => {
      if (isToday) {
        if (!isSameDay(ts, now)) return undefined;
        return days.find((d) => d.hourStart === ts.getHours());
      }
      return days.find((d) => isSameDay(d.date, ts));
    };

    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    // Requests
    const [
      pendingRequests,
      approachingRequests,
      thisWeekRequests,
      lastWeekRequests,
      allRequestsRecent
    ] = await Promise.all([
      Request.countDocuments({ assignedTo: null, status: { $ne: 'cancelled' } }), 
      Request.countDocuments({ 
        deadline: { $gte: now, $lte: threeDaysFromNow } 
      }),
      Request.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
      Request.countDocuments({ 
        createdAt: { $gte: fourteenDaysAgo, $lt: sevenDaysAgo } 
      }),
      Request.find({ createdAt: { $gte: days[0].date } }).select('createdAt')
    ]);

    const requestChart = days.map(d => ({ name: d.label, count: 0 }));
    allRequestsRecent.forEach(r => {
      const slot = matchBucket(r.createdAt);
      if (slot) {
        const idx = days.indexOf(slot);
        requestChart[idx].count++;
      }
    });

    // Orders
    const [
      totalOrders,
      completedOrders,
      inProgressOrders,
      pendingOrdersCount
    ] = await Promise.all([
      Order.countDocuments(),
      Order.countDocuments({ status: 'completed' }),
      Order.countDocuments({ status: 'in_progress' }),
      Order.countDocuments({ status: 'pending' })
    ]);

    // Inventory
    const inventoryAggr = await Inventory.aggregate([
      {
        $lookup: {
          from: 'materials',
          localField: 'material',
          foreignField: '_id',
          as: 'materialData'
        }
      },
      {
        $unwind: {
          path: '$materialData',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $group: {
          _id: null,
          totalStock: { $sum: '$quantity' },
          lowStockAlerts: {
            $sum: {
              $cond: [
                { $lte: ['$quantity', { $ifNull: ['$materialData.reorderPoint', 0] }] },
                1,
                0
              ]
            }
          }
        }
      }
    ]);
    const inventoryStats = inventoryAggr[0] || { totalStock: 0, lowStockAlerts: 0 };

    // Material Logs
    const recentActivity = await MaterialLog.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('material')
      .populate('worker')
      .populate({
        path: 'order',
        populate: { path: 'request' }
      });
      
    const recentLogs = await MaterialLog.find({ createdAt: { $gte: days[0].date } }).select('createdAt quantityChanged actionType');
    const logChart = days.map(d => ({ name: d.label, stock: 0, out: 0 }));
    
    recentLogs.forEach(log => {
      const slot = matchBucket(log.createdAt);
      if (slot) {
        const idx = days.indexOf(slot);
        if (log.actionType === 'import') {
          logChart[idx].stock += Math.abs(log.quantityChanged);
        } else {
          logChart[idx].out += Math.abs(log.quantityChanged);
        }
      }
    });

    const response = {
      requests: {
        totalThisWeek: thisWeekRequests,
        totalLastWeek: lastWeekRequests,
        pending: pendingRequests,
        approaching: approachingRequests,
        chart: requestChart
      },
      orders: {
        total: totalOrders,
        completed: completedOrders,
        inProgress: inProgressOrders,
        pending: pendingOrdersCount
      },
      inventory: {
        totalStock: inventoryStats.totalStock,
        lowStockAlerts: inventoryStats.lowStockAlerts
      },
      materialLogs: {
        chart: logChart,
        recentActivity
      }
    };

    success(res, response, 'Dashboard stats fetched successfully');
  } catch (err) {
    next(err);
  }
};
