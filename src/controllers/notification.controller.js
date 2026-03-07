const Notification = require('../models/Notification');
const { success, fail } = require('../utils/response');
const emit = require('../utils/emitEvent');

const POPULATE_FIELDS = ['recipient'];

exports.getAll = async (req, res, next) => {
  try {
    const notifications = await Notification.find().populate(POPULATE_FIELDS);
    success(res, notifications);
  } catch (err) {
    next(err);
  }
};

exports.getById = async (req, res, next) => {
  try {
    const notification = await Notification.findById(req.params.id).populate(POPULATE_FIELDS);
    if (!notification) return fail(res, 'Notification not found', 404);
    success(res, notification);
  } catch (err) {
    next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    const notification = await Notification.create(req.validated.body);
    const recipientId = notification.recipient;
    const populated = await notification.populate(POPULATE_FIELDS);
    emit(req, 'notification', populated, [`user:${recipientId}`]);
    success(res, populated, 'Notification created', 201);
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const notification = await Notification.findByIdAndUpdate(req.params.id, req.validated.body, {
      returnDocument: 'after',
      runValidators: true,
    }).populate(POPULATE_FIELDS);
    if (!notification) return fail(res, 'Notification not found', 404);
    success(res, notification, 'Notification updated');
  } catch (err) {
    next(err);
  }
};

exports.deleteOne = async (req, res, next) => {
  try {
    const notification = await Notification.findByIdAndDelete(req.params.id);
    if (!notification) return fail(res, 'Notification not found', 404);
    success(res, null, 'Notification deleted');
  } catch (err) {
    next(err);
  }
};

exports.deleteMany = async (req, res, next) => {
  try {
    const { ids } = req.validated.body;
    const result = await Notification.deleteMany({ _id: { $in: ids } });
    success(res, { deletedCount: result.deletedCount }, 'Notifications deleted');
  } catch (err) {
    next(err);
  }
};
