// Run ONCE, right after adding email verification and BEFORE anyone signs up again:
//   node verifyExistingUsers.js
//
// Accounts created before this feature have no "isVerified" value, so they would be
// locked out. This marks exactly those accounts as verified. Accounts created with the
// new sign-up flow already store isVerified, so running it again changes nothing.
require('dotenv').config();

const mongoose = require('mongoose');
const dbModule = require('./config/db');
const User = require('./models/User');

// Works whether db.js exports the function directly or as { connectDB }
const connectDB = dbModule.connectDB || dbModule;

const run = async () => {
  try {
    await connectDB();
    // Uses the raw collection so the model's default (false) is not applied to the filter.
    const result = await User.collection.updateMany(
      { isVerified: { $exists: false } },
      { $set: { isVerified: true } }
    );
    console.log(`Marked ${result.modifiedCount} existing account(s) as verified.`);
  } catch (error) {
    console.error('Failed:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
    process.exit();
  }
};

run();
