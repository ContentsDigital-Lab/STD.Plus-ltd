require('dotenv').config();

const mongoose = require('mongoose');
const env = require('../src/config/env');

const reset = async () => {
  await mongoose.connect(env.MONGODB_URI);

  const collections = await mongoose.connection.db.listCollections().toArray();

  for (const { name } of collections) {
    await mongoose.connection.db.dropCollection(name);
    console.log(`  Dropped: ${name}`);
  }

  console.log(`\nDatabase "${mongoose.connection.db.databaseName}" is now empty.`);
  process.exit(0);
};

reset().catch((err) => {
  console.error(err);
  process.exit(1);
});
