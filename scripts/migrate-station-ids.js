require('dotenv').config();

const mongoose = require('mongoose');
const env = require('../src/config/env');

const VIRTUAL_STATES = new Set(['queue', 'ready', 'claimed', 'completed', '']);

async function main() {
  await mongoose.connect(env.MONGODB_URI);
  const db = mongoose.connection.db;

  const stations = await db.collection('stations').find({}).toArray();
  const nameToId = new Map();
  for (const s of stations) {
    nameToId.set(s.name, s._id);
    nameToId.set(s.name.toLowerCase(), s._id);
  }

  console.log(`Loaded ${stations.length} station(s): ${stations.map(s => `${s.name} → ${s._id}`).join(', ')}\n`);

  if (stations.length === 0) {
    console.log('No stations found. Nothing to migrate.');
    process.exit(0);
  }

  const resolve = (name) => {
    if (!name || VIRTUAL_STATES.has(name)) return null;
    if (mongoose.Types.ObjectId.isValid(name) && String(new mongoose.Types.ObjectId(name)) === name) {
      return new mongoose.Types.ObjectId(name);
    }
    const id = nameToId.get(name) || nameToId.get(name.toLowerCase());
    if (!id) {
      console.warn(`  ⚠  Station name "${name}" not found — skipping this field`);
      return undefined;
    }
    return id;
  };

  let totalUpdated = 0;

  // ── Panes ──────────────────────────────────────────────────────────
  console.log('━━ Panes ━━');
  const panes = await db.collection('panes').find({
    $or: [
      { currentStation: { $type: 'string' } },
      { 'routing.0': { $type: 'string' } },
    ],
  }).toArray();

  console.log(`  ${panes.length} pane(s) need migration`);
  for (const pane of panes) {
    const $set = {};

    if (typeof pane.currentStation === 'string') {
      const resolved = resolve(pane.currentStation);
      if (resolved !== undefined) $set.currentStation = resolved;
    }

    if (Array.isArray(pane.routing) && pane.routing.some(r => typeof r === 'string')) {
      const mapped = [];
      let skip = false;
      for (const r of pane.routing) {
        if (typeof r !== 'string') { mapped.push(r); continue; }
        const resolved = resolve(r);
        if (resolved === undefined) { skip = true; break; }
        if (resolved !== null) mapped.push(resolved);
      }
      if (!skip) $set.routing = mapped;
    }

    if (Object.keys($set).length > 0) {
      await db.collection('panes').updateOne({ _id: pane._id }, { $set });
      totalUpdated++;
      console.log(`    ✓ ${pane.paneNumber || pane._id}`);
    }
  }

  // ── Orders ─────────────────────────────────────────────────────────
  console.log('\n━━ Orders ━━');
  const orders = await db.collection('orders').find({
    $or: [
      { 'stations.0': { $type: 'string' } },
      { 'stationHistory.0.station': { $type: 'string' } },
    ],
  }).toArray();

  console.log(`  ${orders.length} order(s) need migration`);
  for (const order of orders) {
    const $set = {};

    if (Array.isArray(order.stations) && order.stations.some(s => typeof s === 'string')) {
      const mapped = [];
      let skip = false;
      for (const s of order.stations) {
        if (typeof s !== 'string') { mapped.push(s); continue; }
        const resolved = resolve(s);
        if (resolved === undefined) { skip = true; break; }
        if (resolved !== null) mapped.push(resolved);
      }
      if (!skip) $set.stations = mapped;
    }

    if (Array.isArray(order.stationHistory)) {
      const migrated = [];
      let changed = false;
      for (const entry of order.stationHistory) {
        if (typeof entry.station === 'string') {
          const resolved = resolve(entry.station);
          if (resolved === undefined || resolved === null) {
            migrated.push(entry);
          } else {
            migrated.push({ ...entry, station: resolved });
            changed = true;
          }
        } else {
          migrated.push(entry);
        }
      }
      if (changed) $set.stationHistory = migrated;
    }

    if (order.stationBreakdown) {
      const raw = order.stationBreakdown instanceof Map
        ? Object.fromEntries(order.stationBreakdown)
        : order.stationBreakdown;
      const newBreakdown = {};
      let changed = false;
      for (const [key, val] of Object.entries(raw)) {
        if (mongoose.Types.ObjectId.isValid(key) && String(new mongoose.Types.ObjectId(key)) === key) {
          newBreakdown[key] = val;
        } else {
          const resolved = resolve(key);
          if (resolved && resolved !== undefined) {
            newBreakdown[String(resolved)] = val;
            changed = true;
          } else {
            newBreakdown[key] = val;
          }
        }
      }
      if (changed) $set.stationBreakdown = newBreakdown;
    }

    if (order.stationData) {
      const raw = order.stationData instanceof Map
        ? Object.fromEntries(order.stationData)
        : order.stationData;
      const newData = {};
      let changed = false;
      for (const [key, val] of Object.entries(raw)) {
        if (mongoose.Types.ObjectId.isValid(key) && String(new mongoose.Types.ObjectId(key)) === key) {
          newData[key] = val;
        } else {
          const resolved = resolve(key);
          if (resolved && resolved !== undefined) {
            newData[String(resolved)] = val;
            changed = true;
          } else {
            newData[key] = val;
          }
        }
      }
      if (changed) $set.stationData = newData;
    }

    if (Object.keys($set).length > 0) {
      await db.collection('orders').updateOne({ _id: order._id }, { $set });
      totalUpdated++;
      console.log(`    ✓ ${order.orderNumber || order._id}`);
    }
  }

  // ── Claims ─────────────────────────────────────────────────────────
  console.log('\n━━ Claims ━━');
  const claims = await db.collection('claims').find({
    defectStation: { $type: 'string' },
  }).toArray();

  console.log(`  ${claims.length} claim(s) need migration`);
  for (const claim of claims) {
    const resolved = resolve(claim.defectStation);
    if (resolved !== undefined) {
      await db.collection('claims').updateOne({ _id: claim._id }, { $set: { defectStation: resolved } });
      totalUpdated++;
      console.log(`    ✓ ${claim.claimNumber || claim._id}`);
    }
  }

  // ── PaneLogs ───────────────────────────────────────────────────────
  console.log('\n━━ PaneLogs ━━');
  const paneLogs = await db.collection('panelogs').find({
    station: { $type: 'string' },
  }).toArray();

  console.log(`  ${paneLogs.length} pane log(s) need migration`);
  for (const log of paneLogs) {
    const resolved = resolve(log.station);
    if (resolved === undefined || resolved === null) {
      console.warn(`    ⚠  PaneLog ${log._id}: station "${log.station}" unresolvable — skipping`);
      continue;
    }
    await db.collection('panelogs').updateOne({ _id: log._id }, { $set: { station: resolved } });
    totalUpdated++;
  }
  if (paneLogs.length > 0) console.log(`    ✓ ${paneLogs.length} log(s) updated`);

  // ── ProductionLogs ─────────────────────────────────────────────────
  console.log('\n━━ ProductionLogs ━━');
  const prodLogs = await db.collection('productionlogs').find({
    station: { $type: 'string' },
  }).toArray();

  console.log(`  ${prodLogs.length} production log(s) need migration`);
  for (const log of prodLogs) {
    const resolved = resolve(log.station);
    if (resolved === undefined || resolved === null) {
      console.warn(`    ⚠  ProductionLog ${log._id}: station "${log.station}" unresolvable — skipping`);
      continue;
    }
    await db.collection('productionlogs').updateOne({ _id: log._id }, { $set: { station: resolved } });
    totalUpdated++;
  }
  if (prodLogs.length > 0) console.log(`    ✓ ${prodLogs.length} log(s) updated`);

  console.log(`\n━━ Done ━━  ${totalUpdated} document(s) updated total.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
