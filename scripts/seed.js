require('dotenv').config();

const mongoose = require('mongoose');
const Worker = require('../src/models/Worker');
const env = require('../src/config/env');

const seed = async () => {
  await mongoose.connect(env.MONGODB_URI);

  const exists = await Worker.findOne({ username: 'admin' });
  if (exists) {
    exists.role = 'admin';
    await exists.save();
    console.log('Admin worker already exists — updated role to "admin".');
    process.exit(0);
  }

  await Worker.create({
    name: 'Admin',
    username: 'admin',
    password: 'admin123',
    position: 'admin',
    role: 'admin',
  });

  console.log('Seed complete — admin worker created');
  console.log('  username: admin');
  console.log('  password: admin123');
  process.exit(0);
};

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
