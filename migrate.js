require('dotenv').config();
const mongoose = require('mongoose');

const LOCAL_URI = 'mongodb://localhost:27017/aceysecure';
const CLOUD_URI = process.env.MONGO_URI;

async function migrate() {
  try {
    console.log('1. Connecting to LOCAL database...');
    await mongoose.connect(LOCAL_URI);

    console.log('2. Fetching local data...');
    // Fetch products using the native driver to avoid Mongoose strict schema issues
    const localProducts = await mongoose.connection.db.collection('products').find({}).toArray();
    
    // ONLY fetch the specific admin user
    const localAdmin = await mongoose.connection.db.collection('users').findOne({ email: 'aceysecure@gmail.com' });
    
    console.log(`Found ${localProducts.length} products and admin: ${localAdmin ? 'YES' : 'NO'}`);

    console.log('3. Disconnecting from LOCAL...');
    await mongoose.disconnect();

    console.log('4. Connecting to CLOUD (Atlas) database...');
    await mongoose.connect(CLOUD_URI);

    console.log('5. Wiping the cloud database clean...');
    await mongoose.connection.db.collection('products').deleteMany({});
    await mongoose.connection.db.collection('users').deleteMany({});

    console.log('6. Uploading products...');
    if (localProducts.length > 0) {
      await mongoose.connection.db.collection('products').insertMany(localProducts);
    }

    console.log('7. Uploading admin user...');
    if (localAdmin) {
      // Ensure required fields exist to prevent future crashes
      localAdmin.phone = localAdmin.phone || '0000000000';
      localAdmin.acceptsTerms = true;
      localAdmin.dateOfBirth = localAdmin.dateOfBirth || new Date('1990-01-01');
      
      // If somehow the password is missing, set a default one so you can log in
      if (!localAdmin.password) {
        const bcrypt = require('bcryptjs');
        localAdmin.password = await bcrypt.hash('AceySecureAdmin2026!', 10);
        console.log('⚠️ NO PASSWORD FOUND. Set to: AceySecureAdmin2026!');
      }

      await mongoose.connection.db.collection('users').insertOne(localAdmin);
    }

    console.log('✅ MIGRATION SUCCESSFUL! Data moved to the cloud.');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  }
}

migrate();