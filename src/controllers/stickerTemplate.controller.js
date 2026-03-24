const StickerTemplate = require('../models/StickerTemplate');
const { success, fail } = require('../utils/response');
const emit = require('../utils/emitEvent');
const paginate = require('../utils/paginate');

exports.getAll = async (req, res, next) => {
  try {
    const { data, pagination } = await paginate(StickerTemplate, {
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
    const template = await StickerTemplate.findById(req.params.id);
    if (!template) return fail(res, 'Sticker template not found', 404);
    success(res, template);
  } catch (err) {
    next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    const template = await StickerTemplate.create(req.validated.body);
    emit(req, 'sticker-template:updated', { action: 'created', data: template }, ['dashboard']);
    success(res, template, 'Sticker template created', 201);
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const template = await StickerTemplate.findByIdAndUpdate(req.params.id, req.validated.body, {
      returnDocument: 'after',
      runValidators: true,
    });
    if (!template) return fail(res, 'Sticker template not found', 404);
    emit(req, 'sticker-template:updated', { action: 'updated', data: template }, ['dashboard']);
    success(res, template, 'Sticker template updated');
  } catch (err) {
    next(err);
  }
};

exports.deleteOne = async (req, res, next) => {
  try {
    const template = await StickerTemplate.findByIdAndDelete(req.params.id);
    if (!template) return fail(res, 'Sticker template not found', 404);
    emit(req, 'sticker-template:updated', { action: 'deleted', data: template }, ['dashboard']);
    success(res, null, 'Sticker template deleted');
  } catch (err) {
    next(err);
  }
};

exports.deleteMany = async (req, res, next) => {
  try {
    const { ids } = req.validated.body;
    const result = await StickerTemplate.deleteMany({ _id: { $in: ids } });
    emit(req, 'sticker-template:updated', { action: 'deleted', data: { ids } }, ['dashboard']);
    success(res, { deletedCount: result.deletedCount }, 'Sticker templates deleted');
  } catch (err) {
    next(err);
  }
};
