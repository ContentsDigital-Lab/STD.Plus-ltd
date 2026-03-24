const Claim = require('../models/Claim');
const Counter = require('../models/Counter');
const Order = require('../models/Order');
const Material = require('../models/Material');
const Worker = require('../models/Worker');
const Pane = require('../models/Pane');
const { success, fail } = require('../utils/response');
const emit = require('../utils/emitEvent');
const { verifyReferences } = require('../services/integrity');
const paginate = require('../utils/paginate');

const POPULATE_FIELDS = ['order', 'material', 'pane', 'reportedBy', 'approvedBy', 'remadePane'];

exports.getAll = async (req, res, next) => {
  try {
    const filter = req.user.role === 'worker' ? { reportedBy: req.user._id } : {};
    const { data, pagination } = await paginate(Claim, {
      filter,
      populate: POPULATE_FIELDS,
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
    const claim = await Claim.findById(req.params.id).populate(POPULATE_FIELDS);
    if (!claim) return fail(res, 'Claim not found', 404);
    if (req.user.role === 'worker' && claim.reportedBy._id.toString() !== req.user._id.toString()) {
      return fail(res, 'Not authorized', 403);
    }
    success(res, claim);
  } catch (err) {
    next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    const { material, reportedBy, approvedBy, pane, remadePane } = req.validated.body;
    await verifyReferences([
      { model: Order, id: req.params.orderId, label: 'Order' },
      { model: Material, id: material, label: 'Material' },
      { model: Worker, id: reportedBy, label: 'Worker (reportedBy)' },
      { model: Worker, id: approvedBy, label: 'Worker (approvedBy)' },
      { model: Pane, id: pane, label: 'Pane' },
      { model: Pane, id: remadePane, label: 'Pane (remadePane)' },
    ]);

    const claimNumber = await Counter.getNext('claim', 'CLM');
    const claim = await Claim.create({
      ...req.validated.body,
      order: req.params.orderId,
      claimNumber,
    });
    const populated = await claim.populate(POPULATE_FIELDS);
    emit(req, 'claim:updated', { action: 'created', data: populated }, ['dashboard', 'claim']);
    success(res, populated, 'Claim created', 201);
  } catch (err) {
    next(err);
  }
};

exports.createFromPane = async (req, res, next) => {
  try {
    const { paneNumber, source, description, defectCode, defectStation, status, decision, reportedBy, approvedBy, remadePane, photos, claimDate } = req.validated.body;

    const pane = await Pane.findOne({ paneNumber });
    if (!pane) return fail(res, 'Pane not found', 404);
    if (!pane.order) return fail(res, 'Pane has no associated order', 400);
    if (!pane.material) return fail(res, 'Pane has no associated material', 400);

    await verifyReferences([
      { model: Worker, id: reportedBy, label: 'Worker (reportedBy)' },
      { model: Worker, id: approvedBy, label: 'Worker (approvedBy)' },
      { model: Pane, id: remadePane, label: 'Pane (remadePane)' },
    ]);

    const claimNumber = await Counter.getNext('claim', 'CLM');
    const claim = await Claim.create({
      order: pane.order,
      material: pane.material,
      pane: pane._id,
      source, description, defectCode, defectStation, status, decision,
      reportedBy, approvedBy, remadePane, photos, claimDate,
      claimNumber,
    });
    const populated = await claim.populate(POPULATE_FIELDS);
    emit(req, 'claim:updated', { action: 'created', data: populated }, ['dashboard', 'claim']);
    success(res, populated, 'Claim created from pane', 201);
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    if (req.user.role === 'worker') {
      const existing = await Claim.findById(req.params.id);
      if (!existing) return fail(res, 'Claim not found', 404);
      if (existing.reportedBy.toString() !== req.user._id.toString()) {
        return fail(res, 'Not authorized', 403);
      }
    }

    const { material, reportedBy, approvedBy, pane, remadePane } = req.validated.body;
    await verifyReferences([
      { model: Material, id: material, label: 'Material' },
      { model: Worker, id: reportedBy, label: 'Worker (reportedBy)' },
      { model: Worker, id: approvedBy, label: 'Worker (approvedBy)' },
      { model: Pane, id: pane, label: 'Pane' },
      { model: Pane, id: remadePane, label: 'Pane (remadePane)' },
    ]);

    const claim = await Claim.findByIdAndUpdate(req.params.id, req.validated.body, {
      new: true,
      runValidators: true,
    }).populate(POPULATE_FIELDS);
    if (!claim) return fail(res, 'Claim not found', 404);
    emit(req, 'claim:updated', { action: 'updated', data: claim }, ['dashboard', 'claim']);
    success(res, claim, 'Claim updated');
  } catch (err) {
    next(err);
  }
};

exports.deleteOne = async (req, res, next) => {
  try {
    const claim = await Claim.findByIdAndDelete(req.params.id);
    if (!claim) return fail(res, 'Claim not found', 404);
    emit(req, 'claim:updated', { action: 'deleted', data: claim }, ['dashboard', 'claim']);
    success(res, null, 'Claim deleted');
  } catch (err) {
    next(err);
  }
};

exports.deleteMany = async (req, res, next) => {
  try {
    const { ids } = req.validated.body;
    const result = await Claim.deleteMany({ _id: { $in: ids } });
    emit(req, 'claim:updated', { action: 'deleted', data: { ids } }, ['dashboard', 'claim']);
    success(res, { deletedCount: result.deletedCount }, 'Claims deleted');
  } catch (err) {
    next(err);
  }
};
