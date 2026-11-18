const express = require('express');
const rateLimit = require('express-rate-limit');
const {
  registerUser,
  verifyOtp,
  resendOtp,
  loginUser,
  getUserProfile,
} = require('../controllers/userController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

// Slows down password guessing and fake sign-ups.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many attempts. Please wait a few minutes and try again.' },
});

// Slows down code guessing and email spam. Each code is also locked after 5 wrong tries.
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many attempts. Please wait a few minutes and try again.' },
});

router.post('/register', authLimiter, registerUser);
router.post('/verify-otp', otpLimiter, verifyOtp);
router.post('/resend-otp', otpLimiter, resendOtp);
router.post('/login', authLimiter, loginUser);
router.get('/profile', protect, getUserProfile);

module.exports = router;
