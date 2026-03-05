const MaterialLog = require('../models/MaterialLog');
const { success, fail } = require('../utils/response');

const POPULATE_FIELDS = ['material', 'order', 'parentLog'];

exports.getAll = async (req, res, next) => {
  try {
    const logs = await MaterialLog.find().populate(POPULATE_FIELDS);
    success(res, logs);
  } catch (err) {
    next(err);
  }
};

exports.getById = async (req, res, next) => {
  try {
    const log = await MaterialLog.findById(req.params.id).populate(POPULATE_FIELDS);
    if (!log) return fail(res, 'Material log not found', 404);
    success(res, log);
  } catch (err) {
    next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    const log = await MaterialLog.create(req.validated.body);
    const populated = await log.populate(POPULATE_FIELDS);
    success(res, populated, 'Material log created', 201);
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const log = await MaterialLog.findByIdAndUpdate(req.params.id, req.validated.body, {
      returnDocument: 'after',
      runValidators: true,
    }).populate(POPULATE_FIELDS);
    if (!log) return fail(res, 'Material log not found', 404);
    success(res, log, 'Material log updated');
  } catch (err) {
    next(err);
  }
};

exports.deleteOne = async (req, res, next) => {
  try {
    const log = await MaterialLog.findByIdAndDelete(req.params.id);
    if (!log) return fail(res, 'Material log not found', 404);
    success(res, null, 'Material log deleted');
  } catch (err) {
    next(err);
  }
};

exports.deleteMany = async (req, res, next) => {
  try {
    const { ids } = req.validated.body;
    const result = await MaterialLog.deleteMany({ _id: { $in: ids } });
    success(res, { deletedCount: result.deletedCount }, 'Material logs deleted');
  } catch (err) {
    next(err);
  }
};
