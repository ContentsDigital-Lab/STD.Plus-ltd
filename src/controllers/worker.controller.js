const Worker = require('../models/Worker');
const Order = require('../models/Order');
const Request = require('../models/Request');
const Withdrawal = require('../models/Withdrawal');
const Claim = require('../models/Claim');
const Notification = require('../models/Notification');
const Pane = require('../models/Pane');
const Inventory = require('../models/Inventory');
const MaterialLog = require('../models/MaterialLog');
const ProductionLog = require('../models/ProductionLog');
const PaneLog = require('../models/PaneLog');
const { success, fail } = require('../utils/response');
const { cascadeDeleteReferenced, cascadeDeleteManyReferenced } = require('../services/integrity');
const paginate = require('../utils/paginate');

const restoreInventory = async (materialId, stockType, quantity) => {
  const inventory = await Inventory.findOne({ material: materialId, stockType }).sort({ createdAt: 1 });
  if (inventory) {
    inventory.quantity += quantity;
    await inventory.save();
  }
};

const PANE_CASCADE = [
  { model: PaneLog, field: 'pane' },
  { model: ProductionLog, field: 'pane' },
  { model: MaterialLog, field: 'pane' },
];

const ORDER_CASCADE = [
  { model: Claim, field: 'order' },
  { model: Withdrawal, field: 'order', beforeDelete: async (docs) => {
    for (const w of docs) await restoreInventory(w.material, w.stockType, w.quantity);
  }},
  { model: MaterialLog, field: 'order' },
  { model: PaneLog, field: 'order' },
  { model: ProductionLog, field: 'order' },
  { model: Pane, field: 'order', cascade: PANE_CASCADE },
];

const REQUEST_CASCADE = [
  { model: Order, field: 'request', cascade: ORDER_CASCADE },
  { model: Pane, field: 'request', cascade: PANE_CASCADE },
];

const WORKER_DEPENDENTS = [
  { model: Order, field: 'assignedTo', cascade: ORDER_CASCADE },
  { model: Request, field: 'assignedTo', cascade: REQUEST_CASCADE },
  { model: Withdrawal, field: 'withdrawnBy', beforeDelete: async (docs) => {
    for (const w of docs) await restoreInventory(w.material, w.stockType, w.quantity);
  }},
  { model: Claim, field: 'reportedBy' },
  { model: Notification, field: 'recipient' },
];

exports.getAll = async (req, res, next) => {
  try {
    const { data, pagination } = await paginate(Worker, {
      page: req.query.page,
      limit: req.query.limit,
      sort: req.query.sort,
      populate: 'role',
    });
    success(res, data, 'Success', 200, pagination);
  } catch (err) {
    next(err);
  }
};

exports.getById = async (req, res, next) => {
  try {
    const worker = await Worker.findById(req.params.id).populate('role');
    if (!worker) return fail(res, 'Worker not found', 404);
    success(res, worker);
  } catch (err) {
    next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    const { name, username, password, position, role, notificationPreferences } = req.validated.body;
    const created = await Worker.create({ name, username, password, position, role, notificationPreferences });
    const worker = await Worker.findById(created._id).populate('role');
    success(res, worker, 'Worker created', 201);
  } catch (err) {
    if (err.code === 11000) {
      return fail(res, 'Username already exists', 409);
    }
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const { notificationPreferences, ...rest } = req.validated.body;
    const updates = { ...rest };

    if (notificationPreferences) {
      for (const [key, value] of Object.entries(notificationPreferences)) {
        updates[`notificationPreferences.${key}`] = value;
      }
    }

    if (updates.password) {
      const bcrypt = require('bcrypt');
      updates.password = await bcrypt.hash(updates.password, 12);
    }

    const worker = await Worker.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    }).populate('role');
    if (!worker) return fail(res, 'Worker not found', 404);
    success(res, worker, 'Worker updated');
  } catch (err) {
    if (err.code === 11000) {
      return fail(res, 'Username already exists', 409);
    }
    next(err);
  }
};

exports.deleteOne = async (req, res, next) => {
  try {
    await cascadeDeleteReferenced(req.params.id, WORKER_DEPENDENTS);
    const worker = await Worker.findByIdAndDelete(req.params.id);
    if (!worker) return fail(res, 'Worker not found', 404);
    success(res, null, 'Worker deleted');
  } catch (err) {
    next(err);
  }
};

exports.deleteMany = async (req, res, next) => {
  try {
    const { ids } = req.validated.body;
    await cascadeDeleteManyReferenced(ids, WORKER_DEPENDENTS);
    const result = await Worker.deleteMany({ _id: { $in: ids } });
    success(res, { deletedCount: result.deletedCount }, 'Workers deleted');
  } catch (err) {
    next(err);
  }
};
