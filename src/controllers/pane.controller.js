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
    const { paneNumber } = req.params;
    const { station, action } = req.body;

    if (!station) return fail(res, 'station is required', 400);
    if (!['scan_in', 'start', 'complete', 'scan_out', 'laminate'].includes(action)) return fail(res, 'Invalid action', 400);

    const pane = await Pane.findOne({ paneNumber: paneNumber.toUpperCase() });
    if (!pane) return fail(res, `ไม่พบกระจก ${paneNumber}`, 404);

    // ── LAMINATE action — merge child sheets into parent ──
    if (action === 'laminate') {
      if (pane.laminateRole !== 'parent') {
        return fail(res, 'Only parent panes can be laminated', 400);
      }

      const activeSheets = await Pane.find({
        parentPane: pane._id,
        currentStatus: { $ne: 'claimed' },
      });

      if (activeSheets.length === 0) {
        return fail(res, 'No active child sheets found', 400);
      }

      const lamStationStr = pane.laminateStation ? pane.laminateStation.toString() : station;
      const allPresent = activeSheets.every(s => {
        const sStation = s.currentStation ? s.currentStation.toString() : null;
        return sStation === lamStationStr && ['in_progress', 'awaiting_scan_out'].includes(s.currentStatus);
      });
      if (!allPresent) {
        const arrived = activeSheets.filter(s => {
          const sStation = s.currentStation ? s.currentStation.toString() : null;
          return sStation === lamStationStr && ['in_progress', 'awaiting_scan_out'].includes(s.currentStatus);
        }).length;
        return fail(res, `Not all sheets present at lamination station (${arrived}/${activeSheets.length})`, 400);
      }

      const now = new Date();

      for (const sheet of activeSheets) {
        sheet.currentStation = null;
        sheet.currentStatus = 'completed';
        sheet.completedAt = now;
        await sheet.save();
        await PaneLog.create({
          pane: sheet._id, order: sheet.order ?? pane.order ?? null,
          material: sheet.material ?? pane.material ?? null,
          worker: req.user?._id ?? null, station: lamStationStr,
          action: 'laminate_complete', completedAt: now,
        });
      }

      pane.currentStation = lamStationStr;
      pane.currentStatus = 'awaiting_scan_out';
      if (!pane.startedAt) pane.startedAt = now;
      await pane.save();

      await PaneLog.create({
        pane: pane._id, order: pane.order ?? null,
        material: pane.material ?? null,
        worker: req.user?._id ?? null, station: lamStationStr,
        action: 'laminate_start', completedAt: null,
      });

      if (pane.order) {
        const order = await Order.findById(pane.order);
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

      const populated = await pane.populate(POPULATE_FIELDS);
      emit(req, 'pane:laminated', {
        parent: populated,
        sheets: activeSheets.map(s => s.paneNumber),
      }, ['dashboard', 'pane', 'production', `station:${lamStationStr}`]);

      return success(res, {
        pane: populated.toObject ? populated.toObject() : populated,
        mergedSheets: activeSheets.length,
      });
    }

    // ── Normal scan actions ──
    if (pane.currentStatus === 'completed') {
      return fail(res, `กระจก ${pane.paneNumber} already completed`, 400);
    }

    const currentStationStr = pane.currentStation ? pane.currentStation.toString() : null;

    if (['complete', 'scan_out'].includes(action) && currentStationStr !== station) {
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

    if (action === 'scan_out') {
      if (pane.currentStatus !== 'awaiting_scan_out') {
        return fail(res, 'กระจกยังไม่เสร็จสิ้น ต้องกด "เสร็จสิ้น" ก่อน scan out', 400);
      }

      const route = Array.isArray(pane.routing) ? pane.routing.map(r => r.toString()) : [];
      const isParentAtLamStation = pane.laminateRole === 'parent'
        && pane.laminateStation
        && pane.laminateStation.toString() === station;

      let nextRouteId;
      if (isParentAtLamStation) {
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
      completedAt: action === 'scan_out' ? now : null,
    });

    emit(req, 'pane:updated', { action: 'scanned', data: populated });
    emit(req, 'log:updated', { action: 'pane_scanned', data: { paneLog: log, material: materialId } }, ['log']);

    // Lamination awareness: when a sheet scans in at its laminate station, check siblings
    if (action === 'scan_in' && pane.laminateRole === 'sheet' && pane.parentPane) {
      const parentPane = await Pane.findById(pane.parentPane);
      const lamStationStr = parentPane?.laminateStation?.toString() ?? null;
      if (lamStationStr && lamStationStr === station) {
        const siblings = await Pane.find({ parentPane: pane.parentPane, currentStatus: { $ne: 'claimed' } });
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

    if (action === 'scan_out') {
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
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { paneNumbers, station, action } = req.validated.body;
    if (!['scan_in', 'start', 'complete'].includes(action)) {
      throw new Error(`Action ${action} not supported in batch-scan`);
    }

    const panes = await Pane.find({ paneNumber: { $in: paneNumbers.map(n => n.toUpperCase()) } }).session(session);
    if (panes.length === 0) {
      throw new Error('No valid panes found for the given numbers');
    }

    const now = new Date();
    const results = [];
    const logs = [];

    for (const pane of panes) {
      if (pane.currentStatus === 'completed') {
        throw new Error(`Pane ${pane.paneNumber} is already completed`);
      }

      if (action === 'scan_in' || action === 'start') {
        pane.currentStation = station;
        pane.currentStatus = 'in_progress';
        if (!pane.startedAt) pane.startedAt = now;
      } else if (action === 'complete') {
        const currentStationStr = pane.currentStation ? pane.currentStation.toString() : null;
        if (currentStationStr !== station) {
          throw new Error(`Pane ${pane.paneNumber} is at station ${currentStationStr}, cannot complete at ${station}`);
        }
        pane.currentStatus = 'awaiting_scan_out';
      }

      await pane.save({ session });

      let materialId = pane.material ?? null;
      if (!materialId && pane.order) {
        const ord = await Order.findById(pane.order).select('material').lean();
        materialId = ord?.material ?? null;
        if (materialId) {
          await Pane.updateOne({ _id: pane._id }, { material: materialId }, { session });
        }
      }

      const log = new PaneLog({
        pane: pane._id,
        order: pane.order ?? null,
        material: materialId,
        worker: req.user?._id ?? null,
        station,
        action,
        completedAt: null,
      });
      await log.save({ session });

      logs.push({ log, materialId, paneId: pane._id });
      results.push(pane);
    }

    await session.commitTransaction();
    session.endSession();

    // After commit, populate and emit
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
    await session.abortTransaction();
    session.endSession();
    next(err);
  }
};

