const express = require('express');
const rateLimit = require('express-rate-limit');
const { initializeOrder, verifyOrder, getOrders } = require('../controllers/orderController');
const { protect, admin } = require('../middleware/authMiddleware');

const router = express.Router();

// Every call to /initialize creates an order and talks to Paystack,
// so slow down anyone who hammers it.
const initializeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many checkout attempts. Please wait a few minutes and try again.' },
});

// Only a logged-in admin can list orders
router.route('/').get(protect, admin, getOrders);

router.post('/initialize', initializeLimiter, initializeOrder);
router.get('/verify', verifyOrder);

module.exports = router;
