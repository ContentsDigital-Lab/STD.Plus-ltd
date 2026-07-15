const mongoose = require('mongoose');
require('dotenv').config();

async function main() {
  await mongoose.connect('mongodb://localhost:27017/std-plus');
  const stations = await mongoose.connection.db.collection('stations').find().toArray();
  console.log('Stations:');
  stations.forEach(s => console.log(s._id, s.name));
  
  const requests = await mongoose.connection.db.collection('requests').find({ requestNumber: 'REQ-0024' }).toArray(); // Just an example, let's just get the first request
  const firstReq = await mongoose.connection.db.collection('requests').findOne();
  console.log('First Request:', firstReq ? firstReq._id : 'None');
  process.exit(0);
}

main();
