const fs = require('fs');
const csv = require('csv-parser');
const mongoose = require('mongoose');
require('dotenv').config();

const env = require('../src/config/env');
const Material = require('../src/models/Material');
const { MATERIAL_DEPENDENTS } = require('../src/controllers/material.controller');
const { cascadeDeleteManyReferenced } = require('../src/services/integrity');

const filePath = process.argv[2];

if (!filePath) {
  console.error("Please provide the path to the CSV file.");
  console.error("Usage: node scripts/delete-materials-from-csv.js ./path/to/file.csv");
  process.exit(1);
}

if (!fs.existsSync(filePath)) {
  console.error(`File not found at path: ${filePath}`);
  process.exit(1);
}

mongoose.connect(env.MONGODB_URI).then(() => {
  console.log("Connected to MongoDB.");
  console.log(`Reading CSV file: ${filePath}`);
  
  const materialsToProcess = [];
  
  fs.createReadStream(filePath)
    .pipe(csv({
      // Clean up headers (remove BOM character, trim spaces)
      mapHeaders: ({ header }) => header.trim().replace(/^\uFEFF/, '')
    }))
    .on('data', (row) => {
      // Helper function to safely get and trim string values
      const getVal = (key) => row[key] ? row[key].trim() : '';

      const code = getVal('รหัส');
      const name = getVal('ชื่อวัสดุ');
      
      // Name is required by the schema (matches import logic)
      if (!name) return;
      
      materialsToProcess.push({
         code: code,
         name: name
      });
    })
    .on('end', async () => {
      console.log(`Successfully parsed ${materialsToProcess.length} valid rows from CSV.`);
      console.log("Starting deletion from database...");
      
      try {
        let deleted = 0;

        for (const data of materialsToProcess) {
           let query = {};
           if (data.code) {
             query = { code: data.code };
           } else {
             // If there's no code, we delete by name only
             query = { name: data.name };
           }
           
           const docs = await Material.find(query).select('_id');
           if (docs.length > 0) {
             const ids = docs.map(d => d._id);
             await cascadeDeleteManyReferenced(ids, MATERIAL_DEPENDENTS);
             const result = await Material.deleteMany({ _id: { $in: ids } });
             deleted += result.deletedCount;
           }
        }

        console.log(`\nDeletion complete!`);
        console.log(`- Deleted materials: ${deleted}`);
        
        process.exit(0);
      } catch (err) {
        console.error("Error occurred during database deletion:", err);
        process.exit(1);
      }
    });
}).catch(err => {
  console.error("Failed to connect to MongoDB:", err);
  process.exit(1);
});
