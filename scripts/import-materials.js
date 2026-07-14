const fs = require('fs');
const csv = require('csv-parser');
const mongoose = require('mongoose');
require('dotenv').config();

const env = require('../src/config/env');
const Material = require('../src/models/Material');

const filePath = process.argv[2];

if (!filePath) {
  console.error("Please provide the path to the CSV file.");
  console.error("Usage: node scripts/import-materials.js ./path/to/file.csv");
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
      let thickness = getVal('ความหนา');
      if (thickness) {
        thickness = thickness.replace(/มม\.?/g, '').trim();
      }
      const glassType = getVal('ประเภท');
      const color = getVal('สี');
      const widthStr = getVal('กว้าง');
      const lengthStr = getVal('สูง');
      const brand = getVal('ยี่ห้อ');
      const sqft = getVal('ตร.ฟ.');
      
      // Name is required by the schema
      if (!name) return;
      
      materialsToProcess.push({
         code: code,
         name: name,
         brand: brand,
         unit: 'แผ่น', // Default unit as discussed
         reorderPoint: 10, // Default reorder point as discussed
         specDetails: {
           thickness: thickness,
           glassType: glassType,
           color: color,
           width: widthStr ? parseFloat(widthStr) : 0,
           length: lengthStr ? parseFloat(lengthStr) : 0,
           sqft: sqft,
           dimensionUnit: 'inch'
         }
      });
    })
    .on('end', async () => {
      console.log(`Successfully parsed ${materialsToProcess.length} valid rows from CSV.`);
      console.log("Starting import to database...");
      
      try {
        let inserted = 0;
        let updated = 0;

        for (const data of materialsToProcess) {
           // If it has a code, try to find an existing one to update (prevents duplicates if run twice)
           if (data.code) {
             const existing = await Material.findOne({ code: data.code });
             if (existing) {
                await Material.updateOne({ code: data.code }, data);
                updated++;
             } else {
                await Material.create(data);
                inserted++;
             }
           } else {
             // If no code, just create it
             await Material.create(data);
             inserted++;
           }
        }

        console.log(`\nImport complete!`);
        console.log(`- Inserted new materials: ${inserted}`);
        console.log(`- Updated existing materials: ${updated}`);
        
        process.exit(0);
      } catch (err) {
        console.error("Error occurred during database import:", err);
        process.exit(1);
      }
    });
}).catch(err => {
  console.error("Failed to connect to MongoDB:", err);
  process.exit(1);
});
