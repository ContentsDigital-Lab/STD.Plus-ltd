const mongoose = require('mongoose');
const Pane = require('../models/Pane');
const PaneLog = require('../models/PaneLog');
const Order = require('../models/Order');
const Counter = require('../models/Counter');
const Request = require('../models/Request');
const Withdrawal = require('../models/Withdrawal');
const ProductionLog = require('../models/ProductionLog');
const { success, fail } = require('../utils/response');
const emit = require('../utils/emitEvent');
const { verifyReferences, cascadeDeleteReferenced, cascadeDeleteManyReferenced } = require('../services/integrity');
const paginate = require('../utils/paginate');
const { createRemakeFromSource } = require('../services/remakePane');

const Claim = require('../models/Claim');
const MaterialLog = require('../models/MaterialLog');
const Inventory = require('../models/Inventory');
const Station = require('../models/Station');

const POPULATE_FIELDS = [
  {
    path: 'order',
    select: 'orderNumber code customer material priority',
    populate: { path: 'request', select: 'deadline' }
  },
  { path: 'request',        select: 'code deadline' },
  { path: 'withdrawal' },
  { path: 'remakeOf' },
  { path: 'material',       select: 'name' },
  { path: 'currentStation', select: 'name' },
  { path: 'routing',        select: 'name' },
  { path: 'parentPane',     select: 'paneNumber laminateRole' },
  { path: 'childPanes',     select: 'paneNumber sheetLabel currentStatus currentStation laminateRole' },
  { path: 'laminateStation', select: 'name' },
  { path: 'mergedInto', select: 'paneNumber currentStatus laminateRole' },
];

const restoreInventory = async (materialId, stockType, quantity) => {
  const inventory = await Inventory.findOne({ material: materialId, stockType }).sort({ createdAt: 1 });
  if (inventory) {
    inventory.quantity += quantity;
    await inventory.save();
  }
};

const PANE_DEPENDENTS = [
  { model: PaneLog, field: 'pane' },
  { model: ProductionLog, field: 'pane' },
  { model: Claim, field: 'pane' },
  { model: MaterialLog, field: 'pane' },
  { model: Withdrawal, field: 'pane', beforeDelete: async (docs) => {
    for (const w of docs) await restoreInventory(w.material, w.stockType, w.quantity);
  }},
];

// ── GET /panes ────────────────────────────────────────────────────────────────
exports.getAll = async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.order)    filter.order    = req.query.order;
    if (req.query.request)  filter.request  = req.query.request;
    if (req.query.material) filter.material = req.query.material;
    if (req.query.station) {
      filter.currentStation = req.query.station === 'null' ? null : req.query.station;
    }
    if (req.query.status)    filter.currentStatus = req.query.status;
    if (req.query.status_ne) filter.currentStatus = { $ne: req.query.status_ne };
    if (req.query.laminateRole) filter.laminateRole = req.query.laminateRole;
    if (req.query.parentPane)   filter.parentPane   = req.query.parentPane;

    if (!req.query.status && !req.query.status_ne && req.query.includeMerged !== 'true') {
      filter.currentStatus = { $ne: 'merged_into' };
    }

    // Filter for withdrawal status
    if (req.query.isWithdrawn === 'true') {
      filter.withdrawal = { $ne: null };
    } else if (req.query.isWithdrawn === 'false') {
      filter.withdrawal = null;
    }

    const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit) || 200));
    const sort  = req.query.sort || '-createdAt';

    const populate = req.query.populate === 'true' ? POPULATE_FIELDS : POPULATE_FIELDS.map(f => {
      if (f.path === 'order') return { ...f, populate: undefined };
      return f;
    });

    const data = await Pane.find(filter).sort(sort).limit(limit).populate(populate).lean();
    success(res, data);
  } catch (err) {
    next(err);
  }
};

// ── GET /panes/:id ────────────────────────────────────────────────────────────
exports.getById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const populate = req.query.populate === 'true' ? POPULATE_FIELDS : POPULATE_FIELDS.map(f => {
      if (f.path === 'order') return { ...f, populate: undefined };
      return f;
    });

    const pane = mongoose.Types.ObjectId.isValid(id)
      ? await Pane.findById(id).populate(populate).lean()
      : await Pane.findOne({ paneNumber: id.toUpperCase() }).populate(populate).lean();
    if (!pane) return fail(res, 'Pane not found', 404);
    success(res, pane);
  } catch (err) {
    next(err);
  }
};

// ── POST /panes ───────────────────────────────────────────────────────────────
const SHEET_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const logInventoryCut = async (req, body) => {
  if (!body.inventory) return;
  const inv = await Inventory.findById(body.inventory).lean();
  if (inv) {
    await MaterialLog.create({
      material:        inv.material,
      actionType:      'cut',
      quantityChanged: -1,
      referenceId:     inv._id,
      stockType:       inv.stockType ?? null,
      order:           body.order ?? null,
    }).catch(err => console.error('[pane.create] MaterialLog cut failed:', err));
    emit(req, 'log:updated', { action: 'created' }, ['log']);
  }
};

exports.create = async (req, res, next) => {
  try {
    const { request, order, withdrawal, remakeOf } = req.validated.body;
    await verifyReferences([
      { model: Request,    id: request,    label: 'Request' },
      { model: Order,      id: order,      label: 'Order' },
      { model: Withdrawal, id: withdrawal, label: 'Withdrawal' },
      { model: Pane,       id: remakeOf,   label: 'Pane (remakeOf)' },
    ]);
    const body = { ...req.validated.body };
    if (!body.paneNumber) {
      body.paneNumber = await Counter.getNext('pane', 'PNE');
    }
    body.qrCode = `STDPLUS:${body.paneNumber}`;

    const sheetsPerPane = body.rawGlass?.sheetsPerPane || 1;
    const hasRouting = body.routing?.length > 0;

    if (sheetsPerPane > 1 && hasRouting) {
      const routingIds = body.routing.map(String);
      const stations = await Station.find({ _id: { $in: routingIds } }).lean();
      const stationMap = Object.fromEntries(stations.map(s => [s._id.toString(), s]));
      const lamIdx = routingIds.findIndex(id => stationMap[id]?.isLaminateStation);

      if (lamIdx === -1) {
        return fail(res, 'Routing must include a lamination station when sheetsPerPane > 1', 400);
      }

      const laminateStationId = routingIds[lamIdx];
      const childRouting = routingIds.slice(0, lamIdx + 1);
      const parentRouting = routingIds.slice(lamIdx + 1);

      const parentPane = await Pane.create({
        ...body,
        laminateRole: 'parent',
        laminateStation: laminateStationId,
        routing: parentRouting,
        currentStation: null,
        currentStatus: 'pending',
      });

      const childIds = [];
      const createdSheets = [];
      for (let i = 0; i < sheetsPerPane; i++) {
        const label = SHEET_LABELS[i] || `S${i + 1}`;
        const childNumber = `${body.paneNumber}-${label}`;
        const child = await Pane.create({
          ...body,
          paneNumber: childNumber,
          qrCode: `STDPLUS:${childNumber}`,
          laminateRole: 'sheet',
          parentPane: parentPane._id,
          sheetLabel: label,
          laminateStation: laminateStationId,
          routing: childRouting,
          currentStation: childRouting[0],
          currentStatus: 'pending',
        });
        childIds.push(child._id);
        createdSheets.push(child);
      }

      parentPane.childPanes = childIds;
      await parentPane.save();

      const populatedParent = await parentPane.populate(POPULATE_FIELDS);

      await logInventoryCut(req, body);

      emit(req, 'pane:updated', { action: 'created', data: populatedParent });
      for (const sheet of createdSheets) {
        emit(req, 'pane:updated', { action: 'created', data: sheet });
      }

      return success(res, { parent: populatedParent, sheets: createdSheets }, 'Laminate pane created', 201);
    }

    const pane = await Pane.create(body);
    const populated = await pane.populate(POPULATE_FIELDS);

    await logInventoryCut(req, body);

    emit(req, 'pane:updated', { action: 'created', data: populated }, []);
    success(res, populated, 'Pane created', 201);
  } catch (err) {
    next(err);
  }
};

// ── PATCH /panes/:id ──────────────────────────────────────────────────────────
exports.update = async (req, res, next) => {
  try {
    const body = req.validated?.body ?? req.body;
    const { request, order, withdrawal, remakeOf } = body;
    await verifyReferences([
      { model: Request, id: request, label: 'Request' },
      { model: Order, id: order, label: 'Order' },
      { model: Withdrawal, id: withdrawal, label: 'Withdrawal' },
      { model: Pane, id: remakeOf, label: 'Pane (remakeOf)' },
    ]);

    const existingPane = await Pane.findById(req.params.id).lean();
    if (!existingPane) return fail(res, 'Pane not found', 404);

    const effectiveRouting = body.routing || existingPane.routing || [];
    const effectiveSheetsPerPane = body.rawGlass?.sheetsPerPane ?? existingPane.rawGlass?.sheetsPerPane ?? 1;
    const isSingle = (existingPane.laminateRole || 'single') === 'single';

    if (isSingle && effectiveSheetsPerPane > 1 && effectiveRouting.length > 0) {
      const routingIds = effectiveRouting.map(String);
      const stations = await Station.find({ _id: { $in: routingIds } }).lean();
      const stationMap = Object.fromEntries(stations.map(s => [s._id.toString(), s]));
      const lamIdx = routingIds.findIndex(id => stationMap[id]?.isLaminateStation);

      if (lamIdx !== -1) {
        const laminateStationId = routingIds[lamIdx];
        const childRouting = routingIds.slice(0, lamIdx + 1);
        const parentRouting = routingIds.slice(lamIdx + 1);

        const mergedData = { ...existingPane, ...body };

        const parentPane = await Pane.findByIdAndUpdate(
          req.params.id,
          {
            ...body,
            laminateRole: 'parent',
            laminateStation: laminateStationId,
            routing: parentRouting,
            currentStation: null,
            currentStatus: 'pending',
          },
          { new: true, runValidators: true }
        );

        const paneNumber = existingPane.paneNumber;
        const childIds = [];
        const createdSheets = [];
        for (let i = 0; i < effectiveSheetsPerPane; i++) {
          const label = SHEET_LABELS[i] || `S${i + 1}`;
          const childNumber = `${paneNumber}-${label}`;
          const child = await Pane.create({
            request: mergedData.request,
            order: mergedData.order || null,
            material: mergedData.material || null,
            withdrawal: mergedData.withdrawal || null,
            inventory: mergedData.inventory || null,
            dimensions: mergedData.dimensions,
            jobType: mergedData.jobType,
            rawGlass: mergedData.rawGlass,
            glassType: mergedData.glassType,
            glassTypeLabel: mergedData.glassTypeLabel,
            cornerSpec: mergedData.cornerSpec,
            dimensionTolerance: mergedData.dimensionTolerance,
            holes: mergedData.holes || [],
            notches: mergedData.notches || [],
            processes: mergedData.processes || [],
            edgeTasks: mergedData.edgeTasks || [],
            customRouting: mergedData.customRouting || false,
            paneNumber: childNumber,
            qrCode: `STDPLUS:${childNumber}`,
            laminateRole: 'sheet',
            parentPane: parentPane._id,
            sheetLabel: label,
            laminateStation: laminateStationId,
            routing: childRouting,
            currentStation: childRouting[0],
            currentStatus: 'pending',
          });
          childIds.push(child._id);
          createdSheets.push(child);
        }

        parentPane.childPanes = childIds;
        await parentPane.save();

        const populatedParent = await parentPane.populate(POPULATE_FIELDS);

        emit(req, 'pane:updated', { action: 'updated', data: populatedParent }, ['dashboard', 'pane', 'production']);
        for (const sheet of createdSheets) {
          emit(req, 'pane:updated', { action: 'created', data: sheet }, ['dashboard', 'pane', 'production']);
        }

        return success(res, { parent: populatedParent, sheets: createdSheets }, 'Laminate pane split created');
      }
    }

    const pane = await Pane.findByIdAndUpdate(
      req.params.id,
      body,
      { new: true, runValidators: true }
    ).populate(POPULATE_FIELDS).lean();
    if (!pane) return fail(res, 'Pane not found', 404);

    const wasUnlinked = !existingPane.order;
    const isNowLinked = !!order;
    const isSheet = (pane.laminateRole || existingPane.laminateRole) === 'sheet';
    if (wasUnlinked && isNowLinked && !isSheet) {
      const targetOrder = await Order.findById(order);
      if (targetOrder) {
        targetOrder.paneCount = (targetOrder.paneCount || 0) + 1;
        if (targetOrder.paneCount > 0) {
          targetOrder.progressPercent = Math.round(
            ((targetOrder.panesCompleted || 0) / targetOrder.paneCount) * 100
          );
        }
        await targetOrder.save();
        const populatedOrder = await targetOrder.populate([
          'request', 'customer', 'material', 'claim', 'withdrawal', 'assignedTo',
        ]);
        emit(req, 'order:updated', { action: 'updated', data: populatedOrder }, ['dashboard', 'order']);
      }
    }

    emit(req, 'pane:updated', { action: 'updated', data: pane });
    success(res, pane, 'Pane updated');
  } catch (err) {
    next(err);
  }
};

// ── DELETE /panes/:id ─────────────────────────────────────────────────────────
exports.deleteOne = async (req, res, next) => {
  try {
    await cascadeDeleteReferenced(req.params.id, PANE_DEPENDENTS);
    const pane = await Pane.findByIdAndDelete(req.params.id);
    if (!pane) return fail(res, 'Pane not found', 404);
    emit(req, 'pane:updated', { action: 'deleted', data: { _id: pane._id } }, ['dashboard', 'pane', 'production']);
    success(res, null, 'Pane deleted');
  } catch (err) {
    next(err);
  }
};

exports.deleteMany = async (req, res, next) => {
  try {
    const { ids } = req.validated.body;
    await cascadeDeleteManyReferenced(ids, PANE_DEPENDENTS);
    const result = await Pane.deleteMany({ _id: { $in: ids } });
    emit(req, 'pane:updated', { action: 'deleted', data: { ids } }, ['dashboard', 'pane', 'production']);
    success(res, { deletedCount: result.deletedCount }, 'Panes deleted');
  } catch (err) {
    next(err);
  }
};

// ── POST /panes/:paneNumber/scan ──────────────────────────────────────────────
exports.scan = async (req, res, next) => {
  try {
    const body = req.validated?.body ?? req.body;
    const { paneNumber } = req.params;
    const { station, action, reason, description, remakeStationId, laminateSurvivorPaneNumber } = body;

    if (!station) return fail(res, 'station is required', 400);
    if (!['scan_in', 'start', 'complete', 'scan_out', 'laminate', 'qc_pass', 'qc_fail'].includes(action)) {
      return fail(res, 'Invalid action', 400);
    }

    const pane = await Pane.findOne({ paneNumber: paneNumber.toUpperCase() });
    if (!pane) return fail(res, `ไม่พบกระจก ${paneNumber}`, 404);

    if (pane.currentStatus === 'merged_into') {
      const sid = pane.mergedInto;
      const mergedSurvivor = sid
        ? await Pane.findById(sid).select('paneNumber').lean()
        : null;
      return fail(
        res,
        mergedSurvivor?.paneNumber
          ? `กระจกรวมแล้ว — ใช้ QR ${mergedSurvivor.paneNumber}`
          : 'กระจกนี้ถูกรวมเข้าแผ่นอื่นแล้ว',
        400,
        {
          code: 'MERGED_INTO',
          survivorPaneNumber: mergedSurvivor?.paneNumber ?? null,
        },
      );
    }

    // ── LAMINATE action — one sheet keeps its QR; others + parent → merged_into ──
    if (action === 'laminate') {
      let parentDoc;
      const contextPane = pane;

      if (pane.laminateRole === 'sheet') {
        if (!pane.parentPane) {
          return fail(res, 'Sheet pane has no parent', 400);
        }
        parentDoc = await Pane.findById(pane.parentPane);
        if (!parentDoc) return fail(res, 'Parent pane not found', 400);
      } else if (pane.laminateRole === 'parent') {
        parentDoc = pane;
        if (!laminateSurvivorPaneNumber) {
          return fail(res, 'laminateSurvivorPaneNumber is required when merging via parent pane', 400);
        }
      } else {
        return fail(res, 'Laminate merge must use a sheet pane (QR) or the dormant parent pane', 400);
      }

      const activeSheets = await Pane.find({
        parentPane: parentDoc._id,
        currentStatus: { $nin: ['claimed', 'merged_into'] },
      });

      if (activeSheets.length === 0) {
        return fail(res, 'No active child sheets found', 400);
      }

      const lamStationStr = parentDoc.laminateStation ? parentDoc.laminateStation.toString() : station;
      const allPresent = activeSheets.every((s) => {
        const sStation = s.currentStation ? s.currentStation.toString() : null;
        return sStation === lamStationStr && ['in_progress', 'awaiting_scan_out'].includes(s.currentStatus);
      });
      if (!allPresent) {
        const arrived = activeSheets.filter((s) => {
          const sStation = s.currentStation ? s.currentStation.toString() : null;
          return sStation === lamStationStr && ['in_progress', 'awaiting_scan_out'].includes(s.currentStatus);
        }).length;
        return fail(res, `Not all sheets present at lamination station (${arrived}/${activeSheets.length})`, 400);
      }

      const survivorNum = (laminateSurvivorPaneNumber || contextPane.paneNumber).toUpperCase();
      const survivor = activeSheets.find((s) => s.paneNumber === survivorNum);
      if (!survivor) {
        return fail(
          res,
          `Survivor sheet ${survivorNum} is not an active sheet in this laminate group`,
          400,
        );
      }

      const parentRouting = Array.isArray(parentDoc.routing)
        ? parentDoc.routing.map((r) => r)
        : [];
      const now = new Date();
      const retiredPaneNumbers = [];

      for (const sheet of activeSheets) {
        if (sheet._id.equals(survivor._id)) continue;
        sheet.currentStation = null;
        sheet.currentStatus = 'merged_into';
        sheet.mergedInto = survivor._id;
        sheet.completedAt = null;
        await sheet.save();
        retiredPaneNumbers.push(sheet.paneNumber);
        await PaneLog.create({
          pane: sheet._id,
          order: sheet.order ?? parentDoc.order ?? null,
          material: sheet.material ?? parentDoc.material ?? null,
          worker: req.user?._id ?? null,
          station: lamStationStr,
          action: 'laminate_complete',
          completedAt: now,
        });
      }

      parentDoc.currentStation = null;
      parentDoc.currentStatus = 'merged_into';
      parentDoc.mergedInto = survivor._id;
      await parentDoc.save();
      retiredPaneNumbers.push(parentDoc.paneNumber);

      await PaneLog.create({
        pane: parentDoc._id,
        order: parentDoc.order ?? null,
        material: parentDoc.material ?? null,
        worker: req.user?._id ?? null,
        station: lamStationStr,
        action: 'laminate_complete',
        completedAt: now,
      });

      survivor.laminateRole = 'single';
      survivor.routing = parentRouting;
      survivor.parentPane = null;
      survivor.currentStation = lamStationStr;
      survivor.currentStatus = 'awaiting_scan_out';
      survivor.laminateMergedAt = now;
      survivor.laminateStation = parentDoc.laminateStation;
      if (!survivor.startedAt) survivor.startedAt = now;
      await survivor.save();

      await PaneLog.create({
        pane: survivor._id,
        order: survivor.order ?? parentDoc.order ?? null,
        material: survivor.material ?? parentDoc.material ?? null,
        worker: req.user?._id ?? null,
        station: lamStationStr,
        action: 'laminate_start',
        completedAt: null,
      });

      if (parentDoc.order) {
        const order = await Order.findById(parentDoc.order);
        if (order) {
          const breakdown = order.stationBreakdown instanceof Map
            ? order.stationBreakdown
            : new Map(Object.entries(order.stationBreakdown || {}));
          const lamCount = breakdown.get(lamStationStr) || 0;
          if (lamCount > 0) breakdown.set(lamStationStr, Math.max(0, lamCount - activeSheets.length));
          breakdown.set(lamStationStr, (breakdown.get(lamStationStr) || 0) + 1);
          order.stationBreakdown = breakdown;
          await order.save();
        }
      }

      const populated = await Pane.findById(survivor._id).populate(POPULATE_FIELDS);
      const surv = populated.toObject ? populated.toObject() : populated;

      emit(req, 'pane:laminated', {
        survivor: surv,
        parent: surv,
        sheets: activeSheets.map((s) => s.paneNumber),
        retiredPaneNumbers,
        parentPaneNumber: parentDoc.paneNumber,
      }, ['dashboard', 'pane', 'production', `station:${lamStationStr}`]);

      return success(res, {
        pane: surv,
        mergedSheets: activeSheets.length,
        survivorPaneNumber: survivor.paneNumber,
        retiredPaneNumbers,
        parentRetired: true,
      });
    }

    // ── QC fail: mark defected, log, auto-remake ──
    if (action === 'qc_fail') {
      if (['defected', 'completed', 'claimed'].includes(pane.currentStatus)) {
        return fail(res, `กระจก ${pane.paneNumber} cannot be QC failed in its current state`, 400);
      }

      const qcStationStr = pane.currentStation ? pane.currentStation.toString() : null;
      if (qcStationStr !== station) {
        return fail(res, `กระจกอยู่ที่สถานี ${qcStationStr} ไม่ใช่ ${station}`, 400);
      }
      if (pane.currentStatus !== 'awaiting_scan_out') {
        return fail(res, 'กระจกต้องอยู่ในสถานะ awaiting_scan_out (กดเสร็จสิ้นก่อน) ก่อน QC fail', 400);
      }

      const now = new Date();

      if (pane.order) {
        const orderForBreakdown = await Order.findById(pane.order);
        if (orderForBreakdown) {
          const breakdown = orderForBreakdown.stationBreakdown instanceof Map
            ? orderForBreakdown.stationBreakdown
            : new Map(Object.entries(orderForBreakdown.stationBreakdown || {}));
          const prevCount = breakdown.get(station) || 0;
          if (prevCount > 0) breakdown.set(station, prevCount - 1);
          orderForBreakdown.stationBreakdown = breakdown;
          await orderForBreakdown.save();
        }
      }

      pane.currentStation = null;
      pane.currentStatus = 'defected';
      await pane.save();

      let materialId = pane.material ?? null;
      if (!materialId && pane.order) {
        const ord = await Order.findById(pane.order).select('material').lean();
        materialId = ord?.material ?? null;
        if (materialId) await Pane.updateOne({ _id: pane._id }, { material: materialId });
      }
      if (!materialId) {
        return fail(res, 'Cannot create remake: pane has no material (link an order with material)', 400);
      }

      const log = await PaneLog.create({
        pane: pane._id,
        order: pane.order ?? null,
        material: materialId,
        worker: req.user?._id ?? null,
        station,
        action: 'qc_fail',
        reason,
        description: description ?? '',
        completedAt: now,
      });

      const originalForRemake = await Pane.findById(pane._id);
      const remadePane = await createRemakeFromSource({
        originalPane: originalForRemake,
        req,
        remakeStationId: remakeStationId || undefined,
        mode: 'qc_fail',
        claim: null,
        materialId,
      });

      const populatedDefected = await Pane.findById(pane._id).populate(POPULATE_FIELDS);
      emit(req, 'pane:updated', { action: 'qc_failed', data: populatedDefected }, ['dashboard', 'pane', 'production']);
      emit(req, 'log:updated', { action: 'pane_scanned', data: { paneLog: log, material: materialId } }, ['log']);

      if (pane.order) {
        const orderFresh = await Order.findById(pane.order).populate([
          'request', 'customer', 'material', 'claim', 'withdrawal', 'assignedTo',
        ]);
        if (orderFresh) {
          emit(req, 'order:updated', { action: 'updated', data: orderFresh }, ['dashboard', 'order']);
        }
      }

      return success(res, {
        pane: populatedDefected.toObject ? populatedDefected.toObject() : populatedDefected,
        log: log.toObject(),
        remadePane: remadePane.toObject ? remadePane.toObject() : remadePane,
      });
    }

    // ── Normal scan actions ──
    if (pane.currentStatus === 'completed' || pane.currentStatus === 'defected') {
      return fail(res, `กระจก ${pane.paneNumber} already completed or defected`, 400);
    }

    const currentStationStr = pane.currentStation ? pane.currentStation.toString() : null;

    if (['complete', 'scan_out', 'qc_pass'].includes(action) && currentStationStr !== station) {
      return fail(res, `กระจกอยู่ที่สถานี ${currentStationStr} ไม่ใช่ ${station}`, 400);
    }

    const now = new Date();
    let nextStation = null;

    if (action === 'scan_in') {
      pane.currentStation = station;
      pane.currentStatus  = 'in_progress';
      if (!pane.startedAt) pane.startedAt = now;
    }

    if (action === 'start') {
      pane.currentStation = station;
      pane.currentStatus  = 'in_progress';
    }

    if (action === 'complete') {
      pane.currentStation = station;
      pane.currentStatus  = 'awaiting_scan_out';
    }

    if (action === 'scan_out' || action === 'qc_pass') {
      if (pane.currentStatus !== 'awaiting_scan_out') {
        return fail(res, 'กระจกยังไม่เสร็จสิ้น ต้องกด "เสร็จสิ้น" ก่อน scan out / QC pass', 400);
      }

      const route = Array.isArray(pane.routing) ? pane.routing.map((r) => r.toString()) : [];
      const lamStr = pane.laminateStation ? pane.laminateStation.toString() : null;
      const atLamAfterMerge = Boolean(pane.laminateMergedAt && lamStr && lamStr === station);

      let nextRouteId;
      if (atLamAfterMerge) {
        nextRouteId = route.length > 0 ? route[0] : null;
      } else {
        const idx = route.indexOf(station);
        nextRouteId = (idx >= 0 && idx < route.length - 1) ? route[idx + 1] : null;
      }
      nextStation = nextRouteId;

      if (nextStation) {
        pane.currentStation = nextStation;
        pane.currentStatus  = 'pending';
      } else {
        pane.currentStation = null;
        pane.currentStatus  = 'completed';
        pane.completedAt    = now;
      }

      if (atLamAfterMerge) {
        pane.laminateMergedAt = null;
      }
    }

    await pane.save();
    const populated = await pane.populate(POPULATE_FIELDS);

    let materialId = pane.material ?? null;
    if (!materialId && pane.order) {
      const ord = await Order.findById(pane.order).select('material').lean();
      materialId = ord?.material ?? null;
      if (materialId) await Pane.updateOne({ _id: pane._id }, { material: materialId });
    }

    const log = await PaneLog.create({
      pane:        pane._id,
      order:       pane.order ?? null,
      material:    materialId,
      worker:      req.user?._id ?? null,
      station,
      action,
      completedAt: action === 'scan_out' || action === 'qc_pass' ? now : null,
    });

    emit(req, 'pane:updated', { action: 'scanned', data: populated });
    emit(req, 'log:updated', { action: 'pane_scanned', data: { paneLog: log, material: materialId } }, ['log']);

    // Lamination awareness: when a sheet scans in at its laminate station, check siblings
    if (action === 'scan_in' && pane.laminateRole === 'sheet' && pane.parentPane) {
      const parentPane = await Pane.findById(pane.parentPane);
      const lamStationStr = parentPane?.laminateStation?.toString() ?? null;
      if (lamStationStr && lamStationStr === station) {
        const siblings = await Pane.find({ parentPane: pane.parentPane, currentStatus: { $nin: ['claimed', 'merged_into'] } });
        const arrived = siblings.filter(s => {
          const sStation = s.currentStation ? s.currentStation.toString() : null;
          return sStation === lamStationStr && ['in_progress', 'awaiting_scan_out'].includes(s.currentStatus);
        });
        if (arrived.length >= siblings.length) {
          emit(req, 'laminate:ready', {
            parentPaneNumber: parentPane.paneNumber,
            parentPaneId: parentPane._id,
            sheetsPresent: arrived.length,
            sheetsTotal: siblings.length,
          }, ['dashboard', 'pane', 'production', `station:${lamStationStr}`]);
        } else {
          emit(req, 'laminate:waiting', {
            parentPaneNumber: parentPane.paneNumber,
            parentPaneId: parentPane._id,
            sheetsPresent: arrived.length,
            sheetsTotal: siblings.length,
          }, [`station:${lamStationStr}`]);
        }
      }
    }

    if (action === 'scan_out' || action === 'qc_pass') {
      const isLastStation = !nextStation;

      if (pane.order) {
        const order = await Order.findById(pane.order);
        if (order) {
          const breakdown = order.stationBreakdown instanceof Map
            ? order.stationBreakdown
            : new Map(Object.entries(order.stationBreakdown || {}));
          const prevCount = breakdown.get(station) || 0;
          if (prevCount > 0) breakdown.set(station, prevCount - 1);
          if (nextStation) breakdown.set(nextStation, (breakdown.get(nextStation) || 0) + 1);
          order.stationBreakdown = breakdown;

          if (isLastStation && pane.laminateRole !== 'sheet') {
            order.panesCompleted = (order.panesCompleted || 0) + 1;
            if (order.paneCount > 0) {
              order.progressPercent = Math.round((order.panesCompleted / order.paneCount) * 100);
            }
            if (order.panesCompleted >= order.paneCount && order.paneCount > 0) {
              order.status = 'completed';
            }
          }

          await order.save();
          const populatedOrder = await order.populate(['request', 'customer', 'material', 'claim', 'withdrawal', 'assignedTo']);
          emit(req, 'order:updated', { action: 'updated', data: populatedOrder }, ['dashboard', 'order']);

          const recipientId = populatedOrder.assignedTo?._id || populatedOrder.assignedTo;
          if (recipientId && pane.laminateRole !== 'sheet') {
            const Notification = require('../models/Notification');
            const title = isLastStation ? 'กระจกเสร็จสมบูรณ์' : 'มีกระจกเข้าสถานี';
            const message = isLastStation
              ? `กระจก ${pane.paneNumber} completed all stations`
              : `กระจก ${pane.paneNumber} arrived at next station`;
            const notification = await Notification.create({
              recipient: recipientId,
              type: 'pane_arrived',
              title,
              message,
              referenceId: pane._id,
              referenceType: 'Pane',
              priority: isLastStation ? 'low' : 'medium',
            });
            emit(req, 'notification', notification, [`user:${recipientId}`]);
          }
        }
      }

      if (nextStation) {
        emit(req, 'station:pane_arrived', {
          paneNumber: pane.paneNumber, paneId: pane._id,
          fromStation: station, toStation: nextStation, orderId: pane.order,
        }, [`station:${nextStation}`, 'station']);

        const io = req.app.get('io');
        if (io) {
          io.to(`station:${nextStation}`).emit('notification', {
            type:    'pane_arrived',
            title:   'มีกระจกเข้าสถานี',
            message: `กระจก ${pane.paneNumber} เข้าสถานีนี้แล้ว`,
          });
        }
      }
    }

    success(res, {
      pane:        populated.toObject ? populated.toObject() : populated,
      log:         log.toObject(),
      nextStation: nextStation ?? undefined,
    });
  } catch (err) {
    next(err);
  }
};

exports.batchScan = async (req, res, next) => {
  try {
    const { paneNumbers, station, action } = req.validated.body;
    if (!['scan_in', 'start', 'complete'].includes(action)) {
      return fail(res, `Action ${action} not supported in batch-scan`, 400);
    }

    const upper = paneNumbers.map(n => String(n).toUpperCase());
    const panes = await Pane.find({ paneNumber: { $in: upper } });
    if (panes.length === 0) {
      return fail(res, 'No valid panes found for the given numbers', 400);
    }

    const orderIdx = new Map(upper.map((n, i) => [n, i]));
    panes.sort((a, b) => (orderIdx.get(a.paneNumber) ?? 0) - (orderIdx.get(b.paneNumber) ?? 0));

    const snapById = new Map();
    for (const p of panes) {
      snapById.set(p._id.toString(), {
        currentStation: p.currentStation,
        currentStatus: p.currentStatus,
        startedAt: p.startedAt,
        material: p.material,
      });
    }

    const now = new Date();
    const results = [];
    const logs = [];
    const createdLogIds = [];
    const savedPaneIds = [];

    const rollback = async () => {
      if (createdLogIds.length) {
        await PaneLog.deleteMany({ _id: { $in: createdLogIds } });
      }
      for (const id of savedPaneIds) {
        const snap = snapById.get(id.toString());
        if (!snap) continue;
        await Pane.updateOne(
          { _id: id },
          {
            $set: {
              currentStation: snap.currentStation,
              currentStatus: snap.currentStatus,
              startedAt: snap.startedAt,
              material: snap.material,
            },
          }
        );
      }
    };

    try {
      for (const pane of panes) {
        if (pane.currentStatus === 'merged_into') {
          await rollback();
          return fail(res, `Pane ${pane.paneNumber} was merged into another pane`, 400);
        }
        if (pane.currentStatus === 'completed') {
          await rollback();
          return fail(res, `Pane ${pane.paneNumber} is already completed`, 400);
        }

        if (action === 'scan_in' || action === 'start') {
          pane.currentStation = station;
          pane.currentStatus = 'in_progress';
          if (!pane.startedAt) pane.startedAt = now;
        } else if (action === 'complete') {
          const currentStationStr = pane.currentStation ? pane.currentStation.toString() : null;
          if (currentStationStr !== station) {
            await rollback();
            return fail(
              res,
              `Pane ${pane.paneNumber} is at station ${currentStationStr}, cannot complete at ${station}`,
              400
            );
          }
          pane.currentStatus = 'awaiting_scan_out';
        }

        await pane.save();
        savedPaneIds.push(pane._id);

        let materialId = pane.material ?? null;
        if (!materialId && pane.order) {
          const ord = await Order.findById(pane.order).select('material').lean();
          materialId = ord?.material ?? null;
          if (materialId) {
            await Pane.updateOne({ _id: pane._id }, { material: materialId });
            pane.material = materialId;
          }
        }

        const log = await PaneLog.create({
          pane: pane._id,
          order: pane.order ?? null,
          material: materialId,
          worker: req.user?._id ?? null,
          station,
          action,
          completedAt: null,
        });
        createdLogIds.push(log._id);

        logs.push({ log, materialId, paneId: pane._id });
        results.push(pane);
      }
    } catch (err) {
      try {
        await rollback();
      } catch (rbErr) {
        return next(rbErr);
      }
      return next(err);
    }

    const populatedPanes = await Promise.all(results.map(p => p.populate(POPULATE_FIELDS)));

    for (let i = 0; i < populatedPanes.length; i++) {
      const p = populatedPanes[i];
      const logInfo = logs[i];
      emit(req, 'pane:updated', { action: 'scanned', data: p });
      emit(req, 'log:updated', { action: 'pane_scanned', data: { paneLog: logInfo.log, material: logInfo.materialId } }, ['log']);
    }

    success(res, {
      updatedCount: populatedPanes.length,
      panes: populatedPanes,
    });
  } catch (err) {
    next(err);
  }
};

