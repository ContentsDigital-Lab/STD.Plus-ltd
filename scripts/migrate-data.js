const fs = require('fs');
const path = require('path');
const BSON = require('bson');
const mongoose = require('mongoose');
require('dotenv').config();

const env = require('../src/config/env');
const Material = require('../src/models/Material');

// Ensure folder path is provided
const dumpDir = process.argv[2];
if (!dumpDir) {
  console.error("❌ Usage: node scripts/migrate-data.js <path-to-dump-folder>");
  process.exit(1);
}

if (!fs.existsSync(dumpDir)) {
  console.error(`❌ Folder not found: ${dumpDir}`);
  process.exit(1);
}

// Collections to safely restore dependencies for.
// We only restore exactly what is needed to fix the broken orders and missing references.
const DEPENDENCY_COLLECTIONS = [
  'requests', 'stations', 'customers', 'inventories', 
  'orders', 'claims', 'withdrawals', 'materiallogs', 
  'panes', 'panelogs'
];

async function main() {
  await mongoose.connect(env.MONGODB_URI);
  console.log("Connected to MongoDB.");

  // 1. Read old materials from dump to find missing materials
  const materialsBsonPath = path.join(dumpDir, 'materials.bson');
  if (!fs.existsSync(materialsBsonPath)) {
    console.error("❌ materials.bson not found in the dump folder. Required for mapping.");
    process.exit(1);
  }

  console.log("\n--- PHASE 1: RESTORING MISSING MATERIALS ---");
  const materialsData = fs.readFileSync(materialsBsonPath);
  const oldMaterials = [];
  const oldMaterialMap = {}; // oldId -> identifier (code or name)

  let index = 0;
  while (index < materialsData.length) {
    const size = materialsData.readInt32LE(index);
    const doc = BSON.deserialize(materialsData.subarray(index, index + size));
    oldMaterials.push(doc);
    const identifier = doc.code || doc.name;
    if (identifier) oldMaterialMap[doc._id.toString()] = identifier;
    index += size;
  }

  const liveMaterials = await Material.find({});
  const liveIdentifiers = new Set();
  const identifierToNewId = {};

  for (const m of liveMaterials) {
    const identifier = m.code || m.name;
    if (identifier) {
      liveIdentifiers.add(identifier);
      identifierToNewId[identifier] = m._id;
    }
  }

  const missingMaterials = oldMaterials.filter(m => {
    const identifier = m.code || m.name;
    return !liveIdentifiers.has(identifier);
  });

  if (missingMaterials.length > 0) {
    console.log(`Found ${missingMaterials.length} missing original materials. Restoring...`);
    const matCollection = mongoose.connection.db.collection('materials');
    let insertedMats = 0;
    for (const mat of missingMaterials) {
      const res = await matCollection.updateOne(
        { _id: mat._id },
        { $setOnInsert: mat },
        { upsert: true }
      );
      if (res.upsertedCount) insertedMats++;
    }
    console.log(`Restored ${insertedMats} missing materials.`);
  } else {
    console.log("No missing materials to restore.");
  }

  // 2. Build ID mapping dictionary for the dependencies
  console.log("\n--- PHASE 2: BUILDING MATERIAL ID MAPPINGS ---");
  const oldIdToNewId = {};
  for (const [oldId, identifier] of Object.entries(oldMaterialMap)) {
    if (identifierToNewId[identifier]) {
      oldIdToNewId[oldId] = identifierToNewId[identifier];
    }
  }
  console.log(`Ready to remap ${Object.keys(oldIdToNewId).length} material IDs in dependencies.`);

  // 3. Process Dependency Collections
  console.log("\n--- PHASE 3: RESTORING & REMAPPING DEPENDENCIES ---");
  for (const collName of DEPENDENCY_COLLECTIONS) {
    const bsonPath = path.join(dumpDir, `${collName}.bson`);
    if (!fs.existsSync(bsonPath)) {
      console.log(`Skipping ${collName}... file not found in dump folder.`);
      continue;
    }

    console.log(`Processing ${collName}...`);
    const data = fs.readFileSync(bsonPath);
    let idx = 0;
    let inserted = 0;
    let total = 0;

    const collection = mongoose.connection.db.collection(collName);
    const bulkOps = [];

    while (idx < data.length) {
      const size = data.readInt32LE(idx);
      const doc = BSON.deserialize(data.subarray(idx, idx + size));
      total++;
      
      // Remap material reference if it exists
      if (doc.material) {
        const oldIdStr = doc.material.toString();
        if (oldIdToNewId[oldIdStr]) {
          doc.material = oldIdToNewId[oldIdStr];
        }
      }

      // Prepare upsert operation ($setOnInsert safely ignores documents that already exist)
      bulkOps.push({
        updateOne: {
          filter: { _id: doc._id },
          update: { $setOnInsert: doc },
          upsert: true
        }
      });

      idx += size;

      // Execute in batches to save memory
      if (bulkOps.length >= 1000) {
        const res = await collection.bulkWrite(bulkOps, { ordered: false }).catch(e => e); // Catch unique constraint errors
        inserted += res.upsertedCount || 0;
        bulkOps.length = 0;
      }
    }

    if (bulkOps.length > 0) {
      const res = await collection.bulkWrite(bulkOps, { ordered: false }).catch(e => e);
      inserted += res.upsertedCount || 0;
    }

    console.log(`-> Restored ${inserted} missing documents (out of ${total} found in backup)`);
  }

  console.log("\n✅ Data Restoration and Migration Complete!");
  process.exit(0);
}

main().catch(err => {
  console.error("❌ Fatal Error:", err);
  process.exit(1);
});
