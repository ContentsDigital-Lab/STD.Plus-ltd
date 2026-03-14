const Worker = require('../models/Worker');
const Order = require('../models/Order');
const Request = require('../models/Request');
const Withdrawal = require('../models/Withdrawal');
const Claim = require('../models/Claim');
const Notification = require('../models/Notification');
const { success, fail } = require('../utils/response');
const { blockDeleteIfReferenced, blockDeleteManyIfReferenced } = require('../services/integrity');
const paginate = require('../utils/paginate');

const WORKER_DEPENDENTS = [
  { model: Order, field: 'assignedTo', label: 'order(s)' },
  { model: Request, field: 'assignedTo', label: 'request(s)' },
  { model: Withdrawal, field: 'withdrawnBy', label: 'withdrawal(s)' },
  { model: Claim, field: 'reportedBy', label: 'claim(s)' },
  { model: Notification, field: 'recipient', label: 'notification(s)' },
];

exports.getAll = async (req, res, next) => {
  try {
    const { data, pagination } = await paginate(Worker, {
      page: req.query.page,
      limit: req.query.limit,
      sort: req.query.sort,
    });
    success(res, data, 'Success', 200, pagination);
  } catch (err) {
    next(err);
  }
};

exports.getById = async (req, res, next) => {
  try {
    const worker = await Worker.findById(req.params.id);
    if (!worker) return fail(res, 'Worker not found', 404);
    success(res, worker);
  } catch (err) {
    next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    const { name, username, password, position, role, notificationPreferences } = req.validated.body;
    const worker = await Worker.create({ name, username, password, position, role, notificationPreferences });
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
    });
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
    await blockDeleteIfReferenced(req.params.id, WORKER_DEPENDENTS);
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
    await blockDeleteManyIfReferenced(ids, WORKER_DEPENDENTS);
    const result = await Worker.deleteMany({ _id: { $in: ids } });
    success(res, { deletedCount: result.deletedCount }, 'Workers deleted');
  } catch (err) {
    next(err);
  }
};
