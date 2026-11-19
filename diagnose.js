require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  try {
    console.log('Connecting to Atlas using MONGO_URI...');
    await mongoose.connect(process.env.MONGO_URI);
    
    console.log('✅ Connected to database:', mongoose.connection.name);
    
    const admin = mongoose.connection.db.admin();
    const dbs = await admin.listDatabases();
    
    console.log('\n--- Scanning databases ---');
    for (const dbInfo of dbs.databases) {
      if (['admin', 'local'].includes(dbInfo.name)) continue;
      
      const db = mongoose.connection.useDb(dbInfo.name);
      const collections = await db.db.listCollections().toArray();
      
      for (const col of collections) {
        const count = await db.collection(col.name).countDocuments();
        if (count > 0) {
          console.log(`Database: "${dbInfo.name}" | Collection: "${col.name}" | Documents: ${count}`);
        }
      }
    }
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
})();