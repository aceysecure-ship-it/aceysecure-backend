const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { sendOtpEmail } = require('../utils/sendEmail');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PHONE_RE = /^[+\d][\d\s()-]*$/;
const MIN_AGE = 18;

const OTP_TTL_MS = 10 * 60 * 1000; // a code works for 10 minutes
const RESEND_COOLDOWN_MS = 60 * 1000; // at most one new code per minute
const MAX_OTP_ATTEMPTS = 5; // wrong guesses allowed per code

// Used when an email is not found, so a wrong email takes as long as a wrong password.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

const asText = (value) => (typeof value === 'string' ? value.trim() : '');

const generateToken = (id) => {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not set');
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
};

const publicUser = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  isAdmin: user.isAdmin,
});

// ---------- date of birth helpers ----------

// Accepts "YYYY-MM-DD" (what <input type="date"> sends) and rejects impossible dates like 2000-02-30.
const parseDob = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const real =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return real ? { date, year, month, day } : null;
};

// Whole years since the birth date, counted on today's date (UTC)
const ageOf = (dob, now = new Date()) => {
  let age = now.getUTCFullYear() - dob.year;
  const month = now.getUTCMonth() + 1;
  if (month < dob.month || (month === dob.month && now.getUTCDate() < dob.day)) age -= 1;
  return age;
};

// ---------- one-time code helpers ----------

const generateOtp = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');

// The database stores only this keyed hash of the code.
const hashOtp = (userId, otp) => {
  const secret = process.env.OTP_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return crypto.createHmac('sha256', secret).update(`${userId}:${otp}`).digest('hex');
};

const safeEqual = (a, b) => {
  const first = Buffer.from(String(a));
  const second = Buffer.from(String(b));
  return first.length === second.length && crypto.timingSafeEqual(first, second);
};

// The time the last code was sent, worked out from its expiry time.
const sentRecently = (user) =>
  Boolean(user.otpExpires) &&
  Date.now() - (user.otpExpires.getTime() - OTP_TTL_MS) < RESEND_COOLDOWN_MS;

// Make a new code, save its hash, and email the code itself.
const issueOtp = async (user) => {
  const otp = generateOtp();

  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        otp: hashOtp(user._id, otp),
        otpExpires: new Date(Date.now() + OTP_TTL_MS),
        otpAttempts: 0,
      },
    }
  );

  await sendOtpEmail({ to: user.email, name: user.name, otp, minutes: OTP_TTL_MS / 60000 });
};

const EMAIL_FAILED = {
  message: 'We couldn’t send the verification email. Please try again in a moment.',
};

// @desc    Start signing up: create the account (unverified) and email a 6-digit code.
//          The user is NOT logged in yet.
// @route   POST /api/users/register
// @access  Public
const registerUser = async (req, res) => {
  try {
    const name = asText(req.body?.name);
    const email = asText(req.body?.email).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!name || name.length > 100) return res.status(400).json({ message: 'Enter your name.' });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ message: 'Enter a valid email address.' });
    // bcrypt only reads the first 72 bytes, so longer passwords are refused.
    if (password.length < 8 || Buffer.byteLength(password) > 72) {
      return res.status(400).json({ message: 'Password must be 8 to 72 characters long.' });
    }

    const phone = asText(req.body?.phone);
    const phoneDigits = phone.replace(/\D/g, '');
    if (!PHONE_RE.test(phone) || phoneDigits.length < 7 || phoneDigits.length > 15) {
      return res.status(400).json({ message: 'Enter a valid phone number.' });
    }

    // Age check is done here on the server, so it cannot be skipped by editing the page.
    const dob = parseDob(req.body?.dateOfBirth);
    const age = dob ? ageOf(dob) : null;
    if (age === null || age < 0 || age > 120) {
      return res.status(400).json({ message: 'Enter a valid date of birth.' });
    }
    if (age < MIN_AGE) {
      return res.status(400).json({ message: 'You must be at least 18 years old to create an account.' });
    }

    // Must be the real boolean true (not "true", 1 or missing)
    if (req.body?.acceptsTerms !== true) {
      return res
        .status(400)
        .json({ message: 'You must accept the Terms of Use and Privacy Policy to create an account.' });
    }
    const marketingOptIn = req.body?.marketingOptIn === true;

    let user = await User.findOne({ email }).select('+password +otpExpires');

    if (user && user.isVerified) {
      return res.status(409).json({ message: 'An account with this email already exists.' });
    }

    if (user) {
      // Signed up before but never verified: send a fresh code (at most once a minute).
      if (sentRecently(user)) {
        return res.status(429).json({ message: 'A code was just sent. Please wait a minute before asking for another.' });
      }
      user.name = name;
      user.password = password; // hashed again by the model
      user.phone = phone;
      user.dateOfBirth = dob.date;
      user.acceptsTerms = true;
      user.termsAcceptedAt = new Date();
      user.marketingOptIn = marketingOptIn;
      await user.save();
    } else {
      // isAdmin and isVerified are deliberately NOT read from the request.
      user = await User.create({
        name,
        email,
        password,
        phone,
        dateOfBirth: dob.date,
        acceptsTerms: true,
        termsAcceptedAt: new Date(),
        marketingOptIn,
      });
    }

    try {
      await issueOtp(user);
    } catch (error) {
      console.error('Could not send verification email:', error.message);
      return res.status(502).json(EMAIL_FAILED);
    }

    res.status(201).json({
      message: 'OTP sent. Check your email for the 6-digit code.',
      email: user.email,
      expiresInMinutes: OTP_TTL_MS / 60000,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: 'An account with this email already exists.' });
    }
    console.error('registerUser error:', error);
    res.status(500).json({ message: 'Server error while creating your account.' });
  }
};

// @desc    Check the 6-digit code. If right, verify the account and log the user in.
// @route   POST /api/users/verify-otp
// @access  Public
const verifyOtp = async (req, res) => {
  try {
    const email = asText(req.body?.email).toLowerCase();
    const code = asText(req.body?.otp);

    if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ message: 'Enter the 6-digit code from your email.' });
    }

    const user = await User.findOne({ email }).select('+otp +otpExpires +otpAttempts');
    if (!user) return res.status(400).json({ message: 'That code is not valid.' });

    if (user.isVerified) {
      return res.status(400).json({ message: 'This email is already verified. Please log in.' });
    }

    if (!user.otp || !user.otpExpires || user.otpExpires.getTime() < Date.now()) {
      return res.status(400).json({ message: 'This code has expired. Request a new one.', expired: true });
    }

    const attempts = user.otpAttempts || 0;
    if (attempts >= MAX_OTP_ATTEMPTS) {
      return res.status(429).json({ message: 'Too many wrong tries. Request a new code.', expired: true });
    }

    if (!safeEqual(user.otp, hashOtp(user._id, code))) {
      await User.updateOne({ _id: user._id }, { $inc: { otpAttempts: 1 } });
      const left = MAX_OTP_ATTEMPTS - (attempts + 1);
      return res.status(400).json({
        message:
          left > 0
            ? `That code isn’t right. ${left} ${left === 1 ? 'try' : 'tries'} left.`
            : 'Too many wrong tries. Request a new code.',
        expired: left <= 0,
      });
    }

    // Right code. This update succeeds only once, even if two requests arrive together.
    const verified = await User.findOneAndUpdate(
      { _id: user._id, isVerified: false, otp: user.otp, otpExpires: { $gt: new Date() } },
      { $set: { isVerified: true }, $unset: { otp: '', otpExpires: '', otpAttempts: '' } },
      { new: true }
    );
    if (!verified) {
      return res.status(400).json({ message: 'This code has already been used or has expired.', expired: true });
    }

    res.json({ ...publicUser(verified), token: generateToken(verified._id) });
  } catch (error) {
    console.error('verifyOtp error:', error);
    res.status(500).json({ message: 'Server error while verifying your email.' });
  }
};

// @desc    Send a new code to an account that is waiting for verification
// @route   POST /api/users/resend-otp
// @access  Public
const resendOtp = async (req, res) => {
  try {
    const email = asText(req.body?.email).toLowerCase();
    if (!EMAIL_RE.test(email)) return res.status(400).json({ message: 'Enter a valid email address.' });

    const user = await User.findOne({ email }).select('+otpExpires');

    // The reply is the same whether or not the email exists, so this cannot be used
    // to find out who has an account.
    if (user && !user.isVerified && !sentRecently(user)) {
      try {
        await issueOtp(user);
      } catch (error) {
        console.error('Could not send verification email:', error.message);
        return res.status(502).json(EMAIL_FAILED);
      }
    }

    res.json({ message: 'If this email is waiting for verification, a new code is on its way.' });
  } catch (error) {
    console.error('resendOtp error:', error);
    res.status(500).json({ message: 'Server error while sending a new code.' });
  }
};

// @desc    Log in and receive a token (verified accounts only)
// @route   POST /api/users/login
// @access  Public
const loginUser = async (req, res) => {
  try {
    const email = asText(req.body?.email).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    const user = email ? await User.findOne({ email }).select('+password') : null;
    const passwordOk = user ? await user.matchPassword(password) : await bcrypt.compare(password, DUMMY_HASH);

    if (!user || !passwordOk) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    // Checked only AFTER the password is right, so strangers cannot probe which emails exist.
    if (!user.isVerified) {
      return res.status(403).json({
        message: 'Please verify your email first. Check your inbox for the 6-digit code.',
        needsVerification: true,
        email: user.email,
      });
    }

    res.json({ ...publicUser(user), token: generateToken(user._id) });
  } catch (error) {
    console.error('loginUser error:', error);
    res.status(500).json({ message: 'Server error while logging in.' });
  }
};

// @desc    Get the logged-in user's profile
// @route   GET /api/users/profile
// @access  Private
const getUserProfile = async (req, res) => {
  res.json(publicUser(req.user));
};

module.exports = { registerUser, verifyOtp, resendOtp, loginUser, getUserProfile };
