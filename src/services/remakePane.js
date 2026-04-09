const Pane = require('../models/Pane');
const Order = require('../models/Order');
const Station = require('../models/Station');
const Counter = require('../models/Counter');
const MaterialLog = require('../models/MaterialLog');
const Notification = require('../models/Notification');
const Claim = require('../models/Claim');
const emit = require('../utils/emitEvent');

const ORDER_RELEASE_REGEX = /order\s*rele[a]?[s]?[s]?/i;

const SHEET_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * @param {object} params
 * @param {import('mongoose').Document} params.originalPane
 * @param {import('express').Request} params.req
 * @param {string|null|undefined} params.remakeStationId
 * @param {'claim'|'qc_fail'} params.mode
 * @param {import('mongoose').Document|null} [params.claim]
 * @param {import('mongoose').Types.ObjectId|string} params.materialId
 * @param {import('mongoose').Types.ObjectId|string|null} [params.orderIdForLookup] - e.g. claim.order when pane.order is unset
 * @returns {Promise<import('mongoose').Document|null>}
 */
async function createRemakeFromSource({ originalPane, req, remakeStationId, mode, claim, materialId, orderIdForLookup }) {
  const orderId = orderIdForLookup ?? originalPane.order;
  const originalOrder = orderId ? await Order.findById(orderId) : null;

  const routing = originalPane.routing?.length > 0
    ? [...originalPane.routing]
    : (originalOrder?.stations?.length > 0 ? [...originalOrder.stations] : []);

  let finalRemakeStationId = remakeStationId || null;

  if (mode === 'qc_fail') {
    if (!finalRemakeStationId && routing.length > 0) {
      finalRemakeStationId = routing[0];
    }
  } else if (!finalRemakeStationId) {
    const orderReleaseStation = await Station.findOne({ name: { $regex: ORDER_RELEASE_REGEX } });
    if (orderReleaseStation) {
      finalRemakeStationId = orderReleaseStation._id;
    } else if (routing.length > 0) {
      finalRemakeStationId = routing[0];
    }
  }

  const paneNumber = await Counter.getNext('pane', 'PNE');
  const qrCode = `STDPLUS:${paneNumber}`;

  const isSheet = originalPane.laminateRole === 'sheet';

  let remakeSheetLabel = '';
  if (isSheet) {
    const baseLabel = (originalPane.sheetLabel || 'A').replace(/\d+$/, '');
    const existingSiblings = await Pane.find({ parentPane: originalPane.parentPane, laminateRole: 'sheet' }).lean();
    const suffix = existingSiblings.length > 0 ? existingSiblings.length : 2;
    remakeSheetLabel = `${baseLabel}${suffix}`;
  }

  const orderIdForRemake = mode === 'qc_fail' ? originalPane.order : null;
  const requestIdForRemake = mode === 'qc_fail'
    ? (originalPane.request || originalOrder?.request || null)
    : (originalOrder?.request ?? null);

  const remadePane = await Pane.create({
    paneNumber,
    qrCode,
    order: orderIdForRemake,
    request: requestIdForRemake,
    material: materialId,
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
    cornerSpec: originalPane.cornerSpec || '',
    dimensionTolerance: originalPane.dimensionTolerance || '',
    holes: originalPane.holes?.length ? originalPane.holes.map(h => (h.toObject ? h.toObject() : { ...h })) : [],
    notches: originalPane.notches?.length ? originalPane.notches.map(n => (n.toObject ? n.toObject() : { ...n })) : [],
    processes: originalPane.processes ? [...originalPane.processes] : [],
    edgeTasks: originalPane.edgeTasks
      ? originalPane.edgeTasks.map(t => ({
        side: t.side,
        edgeProfile: t.edgeProfile,
        machineType: t.machineType,
        status: 'pending',
      }))
      : [],
    laminateRole: isSheet ? 'sheet' : originalPane.laminateRole || 'single',
    parentPane: isSheet ? originalPane.parentPane : null,
    sheetLabel: remakeSheetLabel,
    laminateStation: isSheet ? originalPane.laminateStation : null,
  });

  if (isSheet && originalPane.parentPane) {
    await Pane.findByIdAndUpdate(originalPane.parentPane, {
      $push: { childPanes: remadePane._id },
    });
  }

  if (mode === 'claim' && claim) {
    await Claim.findByIdAndUpdate(claim._id, { remadePane: remadePane._id });
  }

  const matLogBase = {
    material: materialId,
    panes: [remadePane._id],
    actionType: 'remake',
    quantityChanged: 0,
    worker: req.user._id,
  };

  if (mode === 'claim' && claim) {
    matLogBase.referenceId = claim._id;
    matLogBase.referenceType = 'claim';
    matLogBase.order = null;
  } else {
    matLogBase.referenceId = originalPane._id;
    matLogBase.referenceType = 'qc_remake';
    matLogBase.order = originalPane.order ?? null;
  }

  await MaterialLog.create(matLogBase).catch((err) => {
    console.error(`[remakePane] MaterialLog failed (${mode}):`, err);
  });

  if (mode === 'qc_fail' && originalOrder && originalPane.laminateRole !== 'sheet') {
    originalOrder.paneCount = (originalOrder.paneCount || 0) + 1;
    if (originalOrder.paneCount > 0) {
      originalOrder.progressPercent = Math.round(
        ((originalOrder.panesCompleted || 0) / originalOrder.paneCount) * 100,
      );
    }
    await originalOrder.save();
  }

  const POPULATE_FIELDS = [
    {
      path: 'order',
      select: 'orderNumber code customer material priority',
      populate: { path: 'request', select: 'deadline' },
    },
    { path: 'request', select: 'code deadline' },
    { path: 'withdrawal' },
    { path: 'remakeOf' },
    { path: 'material', select: 'name' },
    { path: 'currentStation', select: 'name' },
    { path: 'routing', select: 'name' },
    { path: 'parentPane', select: 'paneNumber laminateRole' },
    { path: 'childPanes', select: 'paneNumber sheetLabel currentStatus currentStation laminateRole' },
    { path: 'laminateStation', select: 'name' },
    { path: 'mergedInto', select: 'paneNumber currentStatus' },
  ];

  const populatedRemade = await remadePane.populate(POPULATE_FIELDS);

  emit(req, 'pane:updated', { action: 'created', data: populatedRemade }, ['dashboard', 'pane', 'production']);
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
      const title = mode === 'qc_fail' ? 'มีกระจกรีเมค (QC) เข้าสถานี' : 'มีกระจกรีเมคเข้าสถานี';
      const message = mode === 'qc_fail'
        ? `กระจกรีเมค ${remadePane.paneNumber} (แทน ${originalPane.paneNumber} — QC fail) arrived`
        : `กระจกรีเมค ${remadePane.paneNumber} (แทน ${originalPane.paneNumber}) arrived`;
      io.to(`station:${stationIdStr}`).emit('notification', {
        type: 'pane_arrived',
        title,
        message,
        referenceId: remadePane._id,
        referenceType: 'Pane',
        priority: 'high',
        readStatus: false,
      });
    }
  }

  if (originalOrder) {
    const recipientId = originalOrder.assignedTo?._id || originalOrder.assignedTo;
    if (recipientId) {
      const notification = await Notification.create({
        recipient: recipientId,
        type: mode === 'qc_fail' ? 'qc_remake' : 'claim_approved',
        title: mode === 'qc_fail' ? 'QC ไม่ผ่าน — สร้างกระจกรีเมคแล้ว' : 'เคลมอนุมัติ — สร้างกระจกรีเมคแล้ว',
        message: mode === 'qc_fail'
          ? `กระจก ${originalPane.paneNumber} ชำรุด (QC) → รีเมค ${remadePane.paneNumber}`
          : `เคลม ${claim.claimNumber}: กระจก ${originalPane.paneNumber} → รีเมค ${remadePane.paneNumber}`,
        referenceId: mode === 'qc_fail' ? remadePane._id : claim._id,
        referenceType: mode === 'qc_fail' ? 'Pane' : 'Claim',
        priority: 'high',
      });
      emit(req, 'notification', notification, [`user:${recipientId}`]);
    }
  }

  return populatedRemade;
}

module.exports = { createRemakeFromSource };
