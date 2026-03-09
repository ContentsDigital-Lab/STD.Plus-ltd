const Worker = require('../models/Worker');
const { success, fail } = require('../utils/response');
const AppError = require('../utils/AppError');

exports.getAll = async (req, res, next) => {
  try {
    const workers = await Worker.find();
    success(res, workers);
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
    const { name, username, password, position, role } = req.validated.body;
    const worker = await Worker.create({ name, username, password, position, role });
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
    const updates = { ...req.validated.body };

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
    const result = await Worker.deleteMany({ _id: { $in: ids } });
    success(res, { deletedCount: result.deletedCount }, 'Workers deleted');
  } catch (err) {
    next(err);
  }
};
