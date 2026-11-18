// Turns an existing account into an admin.
//   1. Register normally (POST /api/users/register or your signup page)
//   2. Run:  node makeAdmin.js you@example.com
require('dotenv').config();

const mongoose = require('mongoose');
const dbModule = require('./config/db');
const User = require('./models/User');

// Works whether db.js exports the function directly or as { connectDB }
const connectDB = dbModule.connectDB || dbModule;

const email = (process.argv[2] || '').trim().toLowerCase();

const run = async () => {
  if (!email) {
    console.log('Usage: node makeAdmin.js you@example.com');
    process.exitCode = 1;
    return;
  }

  try {
    await connectDB();
    const result = await User.updateOne({ email }, { $set: { isAdmin: true } });

    if (result.matchedCount === 0) {
      console.error(`No account found for ${email}. Register on the site first.`);
      process.exitCode = 1;
    } else {
      console.log(`${email} is now an admin.`);
    }
  } catch (error) {
    console.error('Failed:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
    process.exit();
  }
};

run();
