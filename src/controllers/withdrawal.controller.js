const Withdrawal = require('../models/Withdrawal');
const { success, fail } = require('../utils/response');

const POPULATE_FIELDS = ['withdrawnBy', 'material'];

exports.getAll = async (req, res, next) => {
  try {
    const withdrawals = await Withdrawal.find().populate(POPULATE_FIELDS);
    success(res, withdrawals);
  } catch (err) {
    next(err);
  }
};

exports.getById = async (req, res, next) => {
  try {
    const withdrawal = await Withdrawal.findById(req.params.id).populate(POPULATE_FIELDS);
    if (!withdrawal) return fail(res, 'Withdrawal not found', 404);
    success(res, withdrawal);
  } catch (err) {
    next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    const withdrawal = await Withdrawal.create(req.validated.body);
    const populated = await withdrawal.populate(POPULATE_FIELDS);
    success(res, populated, 'Withdrawal created', 201);
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const withdrawal = await Withdrawal.findByIdAndUpdate(req.params.id, req.validated.body, {
      returnDocument: 'after',
      runValidators: true,
    }).populate(POPULATE_FIELDS);
    if (!withdrawal) return fail(res, 'Withdrawal not found', 404);
    success(res, withdrawal, 'Withdrawal updated');
  } catch (err) {
    next(err);
  }
};

exports.deleteOne = async (req, res, next) => {
  try {
    const withdrawal = await Withdrawal.findByIdAndDelete(req.params.id);
    if (!withdrawal) return fail(res, 'Withdrawal not found', 404);
    success(res, null, 'Withdrawal deleted');
  } catch (err) {
    next(err);
  }
};

exports.deleteMany = async (req, res, next) => {
  try {
    const { ids } = req.validated.body;
    const result = await Withdrawal.deleteMany({ _id: { $in: ids } });
    success(res, { deletedCount: result.deletedCount }, 'Withdrawals deleted');
  } catch (err) {
    next(err);
  }
};
