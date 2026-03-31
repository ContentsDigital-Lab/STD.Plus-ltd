require('dotenv').config();

const mongoose = require('mongoose');
const Worker = require('../src/models/Worker');
const Role = require('../src/models/Role');
const env = require('../src/config/env');
const { SYSTEM_ROLES } = require('../src/config/permissions');

const seed = async () => {
  await mongoose.connect(env.MONGODB_URI);

  for (const [slug, def] of Object.entries(SYSTEM_ROLES)) {
    const existing = await Role.findOne({ slug });
    if (existing) {
      existing.permissions = def.permissions;
      existing.isSystem = def.isSystem;
      existing.name = def.name;
      await existing.save();
      console.log(`Role "${slug}" updated.`);
    } else {
      await Role.create(def);
      console.log(`Role "${slug}" created.`);
    }
  }

  const adminRole = await Role.findOne({ slug: 'admin' });

  const exists = await Worker.findOne({ username: 'admin' });
  if (exists) {
    exists.role = adminRole._id;
    await exists.save();
    console.log('Admin worker already exists — updated role.');
    process.exit(0);
  }

  await Worker.create({
    name: 'Admin',
    username: 'admin',
    password: 'admin123',
    position: 'admin',
    role: adminRole._id,
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
