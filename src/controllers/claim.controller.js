const Claim = require('../models/Claim');
const Counter = require('../models/Counter');
const Order = require('../models/Order');
const Material = require('../models/Material');
const Worker = require('../models/Worker');
const Pane = require('../models/Pane');
const Station = require('../models/Station');
const MaterialLog = require('../models/MaterialLog');
const Notification = require('../models/Notification');
const { success, fail } = require('../utils/response');
const emit = require('../utils/emitEvent');
const { verifyReferences } = require('../services/integrity');
const paginate = require('../utils/paginate');
const { hasPermission } = require('../config/permissions');

const POPULATE_FIELDS = [
  'order', 'material', 'pane', 'reportedBy', 'approvedBy', 'remadePane',
  { path: 'defectStation', select: 'name' },
];

const pullPaneFromStation = async (paneId, req) => {
  if (!paneId) return;
  const pane = await Pane.findById(paneId);
  if (!pane || pane.currentStatus === 'completed') return;

  const previousStationId = pane.currentStation ? pane.currentStation.toString() : null;
  pane.currentStation = null;
  pane.currentStatus = 'claimed';
  await pane.save();

  if (pane.order && previousStationId) {
    const order = await Order.findById(pane.order);
    if (order) {
      const breakdown = order.stationBreakdown instanceof Map
        ? order.stationBreakdown
        : new Map(Object.entries(order.stationBreakdown || {}));
      const count = breakdown.get(previousStationId) || 0;
      if (count > 0) breakdown.set(previousStationId, count - 1);
      order.stationBreakdown = breakdown;
      await order.save();

      emit(req, 'order:updated', { action: 'updated', data: order }, ['dashboard', 'order']);
    }
  }

  const rooms = ['dashboard', 'pane', 'production'];
  if (previousStationId) rooms.push(`station:${previousStationId}`);
  emit(req, 'pane:updated', { action: 'claimed', data: pane }, rooms);
};

const createRemakePane = async (claim, remakeStationId, req) => {
  const originalPane = await Pane.findById(claim.pane);
  if (!originalPane) return null;

  const originalOrder = await Order.findById(claim.order);
  if (!originalOrder) return null;

  const routing = originalPane.routing?.length > 0
    ? [...originalPane.routing]
    : (originalOrder.stations?.length > 0 ? [...originalOrder.stations] : []);

  let finalRemakeStationId = remakeStationId;
  if (!finalRemakeStationId) {
    const orderRelessStation = await Station.findOne({ 
      name: { $regex: /order\s*rele[a]?[s]?[s]?/i } 
    });
    if (orderRelessStation) {
      finalRemakeStationId = orderRelessStation._id;
    } else if (routing.length > 0) {
      finalRemakeStationId = routing[0];
    }
  }

  const paneNumber = await Counter.getNext('pane', 'PNE');
  const qrCode = `STDPLUS:${paneNumber}`;

  const remadePane = await Pane.create({
    paneNumber,
    qrCode,
    order: null,
    request: originalOrder.request,
    material: claim.material._id || claim.material,
    remakeOf: originalPane._id,
    currentStation: finalRemakeStationId || null,
    currentStatus: 'pending',
    routing,
    customRouting: originalPane.customRouting,
    dimensions: {
      width: originalPane.dimensions?.width || 0,
      height: originalPane.dimensions?.height || 0,
      thickness: originalPane.dimensions?.thickness || 0,
    },
    jobType: originalPane.jobType || '',
    rawGlass: {
      glassType: originalPane.rawGlass?.glassType || '',
      color: originalPane.rawGlass?.color || '',
      thickness: originalPane.rawGlass?.thickness || 0,
      sheetsPerPane: originalPane.rawGlass?.sheetsPerPane || 1,
    },
    glassType: originalPane.glassType || '',
    glassTypeLabel: originalPane.glassTypeLabel || '',
    holes: originalPane.holes || 0,
    notches: originalPane.notches || 0,
    processes: originalPane.processes ? [...originalPane.processes] : [],
    edgeTasks: originalPane.edgeTasks
      ? originalPane.edgeTasks.map(t => ({ side: t.side, edgeProfile: t.edgeProfile, machineType: t.machineType, status: 'pending' }))
      : [],
  });

  await Claim.findByIdAndUpdate(claim._id, { remadePane: remadePane._id });

  await MaterialLog.create({
    material: claim.material._id || claim.material,
    pane: remadePane._id,
    actionType: 'remake',
    quantityChanged: 0,
    referenceId: claim._id,
    referenceType: 'claim',
    order: null,
    worker: req.user._id,
  }).catch(err => console.error('[claim.approve] MaterialLog remake failed:', err));

  emit(req, 'pane:updated', { action: 'created', data: remadePane }, ['dashboard', 'pane', 'production']);
  emit(req, 'log:updated', { action: 'created' }, ['log']);

  if (finalRemakeStationId) {
    const stationIdStr = finalRemakeStationId.toString();
    emit(req, 'station:pane_arrived', {
      paneNumber: remadePane.paneNumber,
      paneId: remadePane._id,
      fromStation: null,
      toStation: stationIdStr,
      isRemake: true,
    }, [`station:${stationIdStr}`, 'station']);

    const io = req.app.get('io');
    if (io) {
      io.to(`station:${stationIdStr}`).emit('notification', {
        type: 'pane_arrived',
        title: 'มีกระจกรีเมคเข้าสถานี',
        message: `กระจกรีเมค ${remadePane.paneNumber} (แทน ${originalPane.paneNumber}) arrived`,
        referenceId: remadePane._id,
        referenceType: 'Pane',
        priority: 'high',
        readStatus: false,
      });
    }
  }

  const recipientId = originalOrder.assignedTo?._id || originalOrder.assignedTo;
  if (recipientId) {
    const notification = await Notification.create({
      recipient: recipientId,
      type: 'claim_approved',
      title: 'เคลมอนุมัติ — สร้างกระจกรีเมคแล้ว',
      message: `เคลม ${claim.claimNumber}: กระจก ${originalPane.paneNumber} → รีเมค ${remadePane.paneNumber}`,
      referenceId: claim._id,
      referenceType: 'Claim',
      priority: 'high',
    });
    emit(req, 'notification', notification, [`user:${recipientId}`]);
  }

  return remadePane;
};

exports.getAll = async (req, res, next) => {
  try {
    const filter = hasPermission(req.user, 'claims:manage') ? {} : { reportedBy: req.user._id };
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
    if (!hasPermission(req.user, 'claims:manage') && claim.reportedBy._id.toString() !== req.user._id.toString()) {
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

    await pullPaneFromStation(claim.pane, req);

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
    await pullPaneFromStation(pane._id, req);

    const populated = await claim.populate(POPULATE_FIELDS);
    emit(req, 'claim:updated', { action: 'created', data: populated }, ['dashboard', 'claim']);
    success(res, populated, 'Claim created from pane', 201);
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const existing = await Claim.findById(req.params.id);
    if (!existing) return fail(res, 'Claim not found', 404);

    if (!hasPermission(req.user, 'claims:manage')) {
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

    const isBeingApproved =
      req.validated.body.status === 'approved' &&
      existing.status !== 'approved' &&
      !existing.remadePane;

    const claim = await Claim.findByIdAndUpdate(req.params.id, req.validated.body, {
      new: true,
      runValidators: true,
    }).populate(POPULATE_FIELDS);
    if (!claim) return fail(res, 'Claim not found', 404);

    if (isBeingApproved) {
      const { remakeStation } = req.validated.body;
      const newPane = await createRemakePane(claim, remakeStation || null, req);
      if (newPane) {
        claim.remadePane = newPane._id;
        await claim.populate('remadePane');
      }
    }

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
