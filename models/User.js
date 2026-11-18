const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'Name is required'], trim: true, maxlength: 100 },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Enter a valid email address'],
    },
    // select: false means queries do not return the password unless asked for.
    password: { type: String, required: [true, 'Password is required'], select: false },
    isAdmin: { type: Boolean, default: false },

    // Contact and legal details collected at sign-up
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true,
      maxlength: 30,
    },
    // Date of birth is sensitive, so it is left out of normal queries (select: false).
    dateOfBirth: {
      type: Date,
      required: [true, 'Date of birth is required'],
      select: false,
    },
    // Must be true. (A plain "required" would also accept false for a Boolean.)
    acceptsTerms: {
      type: Boolean,
      required: [true, 'You must accept the Terms of Use and Privacy Policy'],
      validate: {
        validator: (value) => value === true,
        message: 'You must accept the Terms of Use and Privacy Policy',
      },
    },
    // When they accepted, as a record of consent
    termsAcceptedAt: { type: Date },
    // Optional: security tips and offers. Always starts as false.
    marketingOptIn: { type: Boolean, default: false },

    // Email verification. An account cannot log in until isVerified is true.
    isVerified: { type: Boolean, default: false },
    // Only a hash of the 6-digit code is stored, never the code itself.
    // select: false keeps these out of normal queries and API replies.
    otp: { type: String, select: false },
    otpExpires: { type: Date, select: false },
    // Wrong guesses for the current code (the code is locked after 5)
    otpAttempts: { type: Number, default: 0, select: false },
  },
  { timestamps: true }
);

// Hash the password whenever it is new or changed.
userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 12);
});

userSchema.methods.matchPassword = function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
