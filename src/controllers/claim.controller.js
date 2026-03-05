const Claim = require('../models/Claim');
const { success, fail } = require('../utils/response');

const POPULATE_FIELDS = ['material', 'reportedBy', 'approvedBy'];

exports.getAll = async (req, res, next) => {
  try {
    const claims = await Claim.find()
      .populate(POPULATE_FIELDS);
    success(res, claims);
  } catch (err) {
    next(err);
  }
};

exports.getById = async (req, res, next) => {
  try {
    const claim = await Claim.findById(req.params.id)
      .populate(POPULATE_FIELDS);
    if (!claim) return fail(res, 'Claim not found', 404);
    success(res, claim);
  } catch (err) {
    next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    const claim = await Claim.create({
      ...req.validated.body,
      order: req.params.orderId,
    });
    const populated = await claim.populate(POPULATE_FIELDS);
    success(res, populated, 'Claim created', 201);
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const claim = await Claim.findByIdAndUpdate(req.params.id, req.validated.body, {
      new: true,
      runValidators: true,
    }).populate(POPULATE_FIELDS);
    if (!claim) return fail(res, 'Claim not found', 404);
    success(res, claim, 'Claim updated');
  } catch (err) {
    next(err);
  }
};

exports.deleteOne = async (req, res, next) => {
  try {
    const claim = await Claim.findByIdAndDelete(req.params.id);
    if (!claim) return fail(res, 'Claim not found', 404);
    success(res, null, 'Claim deleted');
  } catch (err) {
    next(err);
  }
};

exports.deleteMany = async (req, res, next) => {
  try {
    const { ids } = req.validated.body;
    const result = await Claim.deleteMany({ _id: { $in: ids } });
    success(res, { deletedCount: result.deletedCount }, 'Claims deleted');
  } catch (err) {
    next(err);
  }
};
