const fs = require('fs');
const path = require('path');
const BSON = require('bson');
const mongoose = require('mongoose');
require('dotenv').config();

const env = require('../src/config/env');

const dumpDir = process.argv[2];
if (!dumpDir) {
  console.error("❌ Usage: node scripts/reverse-migrate.js <path-to-dump-folder>");
  process.exit(1);
}

if (!fs.existsSync(dumpDir)) {
  console.error(`❌ Folder not found: ${dumpDir}`);
  process.exit(1);
}

const DEPENDENCY_COLLECTIONS = [
  'requests', 'stations', 'customers', 'inventories', 
  'orders', 'claims', 'withdrawals', 'materiallogs', 
  'panes', 'panelogs', 'productionlogs', 'workers',
  'roles', 'notifications', 'jobtypes', 'counters',
  'pricingsettings', 'stationtemplates', 'stickertemplates'
];

async function main() {
  await mongoose.connect(env.MONGODB_URI);
  console.log("Connected to MongoDB.");
  
  console.log("\n--- REVERSE MIGRATION: UNDOING RESTORE ---");
  
  // 1. Reversing Materials
  const materialsBsonPath = path.join(dumpDir, 'materials.bson');
  if (fs.existsSync(materialsBsonPath)) {
    console.log("Reversing materials...");
    const materialsData = fs.readFileSync(materialsBsonPath);
    const materialIds = [];
    
    let index = 0;
    while (index < materialsData.length) {
      const size = materialsData.readInt32LE(index);
      const doc = BSON.deserialize(materialsData.subarray(index, index + size));
      materialIds.push(doc._id);
      index += size;
    }
    
    if (materialIds.length > 0) {
      const collection = mongoose.connection.db.collection('materials');
      const res = await collection.deleteMany({ _id: { $in: materialIds } });
      console.log(`-> Removed ${res.deletedCount} materials from database (undo).`);
    }
  }

  // 2. Reversing Dependencies
  for (const collName of DEPENDENCY_COLLECTIONS) {
    const bsonPath = path.join(dumpDir, `${collName}.bson`);
    if (!fs.existsSync(bsonPath)) {
      continue;
    }

    console.log(`Reversing ${collName}...`);
    const data = fs.readFileSync(bsonPath);
    const ids = [];
    
    let idx = 0;
    while (idx < data.length) {
      const size = data.readInt32LE(idx);
      const doc = BSON.deserialize(data.subarray(idx, idx + size));
      ids.push(doc._id);
      idx += size;
    }

    if (ids.length > 0) {
      const collection = mongoose.connection.db.collection(collName);
      
      // Delete in batches to avoid document size limits on $in queries
      let deletedCount = 0;
      const BATCH_SIZE = 5000;
      
      for (let i = 0; i < ids.length; i += BATCH_SIZE) {
        const batch = ids.slice(i, i + BATCH_SIZE);
        const res = await collection.deleteMany({ _id: { $in: batch } });
        deletedCount += res.deletedCount;
      }
      
      console.log(`-> Removed ${deletedCount} documents from ${collName}.`);
    }
  }

  console.log("\n✅ Reverse Migration Complete! Database is back to pre-migration state.");
  process.exit(0);
}

main().catch(err => {
  console.error("❌ Fatal Error:", err);
  process.exit(1);
});
