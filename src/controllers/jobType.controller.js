const JobType = require('../models/JobType');
const { success, fail } = require('../utils/response');
const emit = require('../utils/emitEvent');
const paginate = require('../utils/paginate');

exports.getAll = async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.isActive !== undefined) filter.isActive = req.query.isActive === 'true';
    const { data, pagination } = await paginate(JobType, {
      filter,
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
    const jobType = await JobType.findById(req.params.id);
    if (!jobType) return fail(res, 'Job type not found', 404);
    success(res, jobType);
  } catch (err) {
    next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    const jobType = await JobType.create(req.validated.body);
    emit(req, 'jobType:updated', { action: 'created', data: jobType }, ['dashboard']);
    success(res, jobType, 'Job type created', 201);
  } catch (err) {
    if (err.code === 11000) return fail(res, 'Job type code already exists', 409);
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const jobType = await JobType.findByIdAndUpdate(req.params.id, req.validated.body, {
      new: true,
      runValidators: true,
    });
    if (!jobType) return fail(res, 'Job type not found', 404);
    emit(req, 'jobType:updated', { action: 'updated', data: jobType }, ['dashboard']);
    success(res, jobType, 'Job type updated');
  } catch (err) {
    if (err.code === 11000) return fail(res, 'Job type code already exists', 409);
    next(err);
  }
};

exports.deleteOne = async (req, res, next) => {
  try {
    const jobType = await JobType.findByIdAndDelete(req.params.id);
    if (!jobType) return fail(res, 'Job type not found', 404);
    emit(req, 'jobType:updated', { action: 'deleted', data: jobType }, ['dashboard']);
    success(res, null, 'Job type deleted');
  } catch (err) {
    next(err);
  }
};

exports.deleteMany = async (req, res, next) => {
  try {
    const { ids } = req.validated.body;
    const result = await JobType.deleteMany({ _id: { $in: ids } });
    emit(req, 'jobType:updated', { action: 'deleted', data: { ids } }, ['dashboard']);
    success(res, { deletedCount: result.deletedCount }, 'Job types deleted');
  } catch (err) {
    next(err);
  }
};
