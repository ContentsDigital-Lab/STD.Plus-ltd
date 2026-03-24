require('dotenv').config();

const mongoose = require('mongoose');
const env = require('../src/config/env');
const Request = require('../src/models/Request');
const Order = require('../src/models/Order');
const Claim = require('../src/models/Claim');
const Pane = require('../src/models/Pane');
const Counter = require('../src/models/Counter');

async function backfillCollection(Model, field, counterName, prefix) {
  const docs = await Model.find({ [field]: { $exists: false } }).sort({ createdAt: 1 });

  if (docs.length === 0) {
    console.log(`  All ${counterName}s already have ${field}. Skipping.`);
    return;
  }

  console.log(`  Found ${docs.length} ${counterName}(s) without ${field}. Backfilling...`);

  for (const doc of docs) {
    const number = await Counter.getNext(counterName, prefix);
    doc[field] = number;
    await doc.save();
    console.log(`    ${doc._id} → ${number}`);
  }
}

const backfill = async () => {
  await mongoose.connect(env.MONGODB_URI);

  console.log('Backfilling auto-numbers...\n');

  await backfillCollection(Request, 'requestNumber', 'request', 'REQ');
  await backfillCollection(Order, 'orderNumber', 'order', 'ORD');
  await backfillCollection(Claim, 'claimNumber', 'claim', 'CLM');
  await backfillCollection(Pane, 'paneNumber', 'pane', 'PNE');

  console.log('\nBackfill complete.');
  process.exit(0);
};

backfill().catch((err) => {
  console.error(err);
  process.exit(1);
});
