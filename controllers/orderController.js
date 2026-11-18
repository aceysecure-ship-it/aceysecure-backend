const crypto = require('crypto');
const axios = require('axios');
const Product = require('../models/Product');
const Order = require('../models/Order');
const { sendAdminAlert } = require('../utils/sendEmail');

const PAYSTACK_BASE_URL = 'https://api.paystack.co';
const MAX_LINES = 50; // different products in one order
const MAX_QUANTITY = 100; // of any one product
const OBJECT_ID_RE = /^[a-f\d]{24}$/i;
const REFERENCE_RE = /^[A-Za-z0-9_-]{6,100}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PAID_STATUSES = ['paid', 'shipped', 'delivered'];

// Read settings when needed (not at require time) so .env is always loaded first.
const settings = () => ({
  secret: process.env.PAYSTACK_SECRET_KEY,
  currency: process.env.PAYSTACK_CURRENCY || 'NGN',
  frontendUrl: (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, ''),
  backendUrl: (process.env.BACKEND_URL || 'http://localhost:5000').replace(/\/$/, ''),
});

// ---------- mock payments (testing without a Paystack account) ----------

// A key that is missing, or still a placeholder such as sk_test_xxxx
const isPlaceholderKey = (secret) => {
  const key = String(secret || '').trim().toLowerCase();
  return !key || key === 'sk_test_replace_me' || /^sk_(test|live)_x+$/.test(key);
};

const isLocalUrl = (value) => {
  try {
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(value).hostname);
  } catch {
    return false;
  }
};

// Safety net: a mock payment marks an order as PAID without charging anyone.
// So mock mode works only outside production AND while FRONTEND_URL points at your own computer.
const mockPaymentsAllowed = (frontendUrl) =>
  process.env.NODE_ENV !== 'production' && isLocalUrl(frontendUrl);

const paystack = (secret) =>
  axios.create({
    baseURL: PAYSTACK_BASE_URL,
    timeout: 15000,
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
  });

const asText = (value) => (typeof value === 'string' ? value.trim() : '');

// Tell the shop owner about a new order. It never delays or breaks the checkout:
// if the email fails, the problem is only written to the terminal.
const notifyAdmin = (order) => {
  Promise.resolve()
    .then(() => sendAdminAlert(order))
    .catch((error) => console.error('Admin alert email failed:', error.message));
};

// ---------- input cleaning ----------

const cleanCustomer = (input) => {
  const customer = {
    name: asText(input?.name),
    email: asText(input?.email).toLowerCase(),
    phone: asText(input?.phone),
    address: asText(input?.address),
  };
  const problems = [];

  if (!customer.name || customer.name.length > 100) problems.push('Enter a valid name.');
  if (!EMAIL_RE.test(customer.email) || customer.email.length > 120) {
    problems.push('Enter a valid email address.');
  }
  const digits = customer.phone.replace(/\D/g, '');
  if (!/^[+\d][\d\s()-]*$/.test(customer.phone) || digits.length < 7 || digits.length > 15) {
    problems.push('Enter a valid phone number.');
  }
  if (customer.address.length < 10 || customer.address.length > 300) {
    problems.push('Enter a full delivery address.');
  }

  return { customer, problems };
};

// Only product ids and quantities are read from the browser. Prices are ignored.
const cleanItems = (items) => {
  if (!Array.isArray(items) || items.length === 0) return { error: 'Your cart is empty.' };
  if (items.length > MAX_LINES) return { error: 'There are too many items in one order.' };

  const merged = new Map(); // product id -> quantity (duplicates are added together)
  for (const item of items) {
    const productId = asText(item?.productId);
    const quantity = Number(item?.quantity);
    if (!OBJECT_ID_RE.test(productId) || !Number.isInteger(quantity) || quantity < 1) {
      return { error: 'One of the items in your cart is invalid.' };
    }
    merged.set(productId, (merged.get(productId) || 0) + quantity);
  }

  const lines = [...merged].map(([productId, quantity]) => ({ productId, quantity }));
  if (lines.some((line) => line.quantity > MAX_QUANTITY)) {
    return { error: `You can order at most ${MAX_QUANTITY} of one item.` };
  }
  return { lines };
};

// ---------- helpers ----------

const redirectToStore = (res, status, reference) => {
  const { frontendUrl } = settings();
  const params = new URLSearchParams({ status });
  if (reference) params.set('reference', reference);
  res.redirect(`${frontendUrl}/order-status?${params.toString()}`);
};

// Lower stock for a paid order. Each product is changed only if enough is left.
const reserveStock = async (order) => {
  let problem = false;

  for (const item of order.orderItems) {
    try {
      const result = await Product.updateOne(
        { _id: item.product, countInStock: { $gte: item.quantity } },
        { $inc: { countInStock: -item.quantity } }
      );
      if (result.modifiedCount !== 1) {
        problem = true;
        console.warn(`Order ${order.reference}: not enough stock to deduct ${item.quantity} x ${item.name}`);
      }
    } catch (error) {
      problem = true;
      console.error(`Order ${order.reference}: stock update failed for ${item.name}:`, error.message);
    }
  }

  if (problem) await Order.updateOne({ _id: order._id }, { $set: { stockIssue: true } });
};

// @desc    Start a Paystack payment for the items in a cart
// @route   POST /api/orders/initialize
// @access  Public (guests can check out)
const initializeOrder = async (req, res) => {
  try {
    const { secret, currency, backendUrl, frontendUrl } = settings();

    // No real Paystack key yet? Use MOCK mode, but only where it is safe (see above).
    const mockMode = isPlaceholderKey(secret);
    if (mockMode && !mockPaymentsAllowed(frontendUrl)) {
      console.error(
        'PAYSTACK_SECRET_KEY is missing or a placeholder, and mock payments are only allowed outside production on localhost. Order refused.'
      );
      return res.status(500).json({ message: 'Payments are not available right now.' });
    }

    const { customer, problems } = cleanCustomer(req.body?.customer);
    const { lines, error: itemsError } = cleanItems(req.body?.items);
    if (problems.length > 0 || itemsError) {
      return res.status(400).json({ message: [...problems, itemsError].filter(Boolean).join(' ') });
    }

    // Real prices and stock come from the database, never from the browser.
    const products = await Product.find({ _id: { $in: lines.map((line) => line.productId) } });
    const productsById = new Map(products.map((product) => [String(product._id), product]));

    let totalKobo = 0; // whole kobo avoids decimal rounding problems
    const orderItems = [];

    for (const line of lines) {
      const product = productsById.get(line.productId);
      if (!product) {
        return res.status(400).json({
          message: 'One of the items in your cart is no longer available. Please review your cart.',
        });
      }
      if (product.countInStock < line.quantity) {
        return res.status(400).json({
          message:
            product.countInStock === 0
              ? `${product.name} is out of stock.`
              : `Only ${product.countInStock} of ${product.name} left in stock.`,
        });
      }

      totalKobo += Math.round(product.price * 100) * line.quantity;
      orderItems.push({
        product: product._id,
        name: product.name,
        image: product.image,
        price: product.price,
        quantity: line.quantity,
      });
    }

    if (totalKobo <= 0) {
      return res.status(400).json({ message: 'This order has no payable amount.' });
    }

    // MOCK MODE: skip Paystack. Save the order as paid, lower the stock, and send the customer
    // straight to the success page on your own frontend.
    if (mockMode) {
      const mockReference = `MOCK-${crypto.randomBytes(6).toString('hex')}`;

      const mockOrder = await Order.create({
        customer,
        orderItems,
        totalPrice: totalKobo / 100,
        currency,
        reference: mockReference,
        status: 'paid',
        paidAt: new Date(),
        paymentResult: {
          id: mockReference,
          status: 'success',
          reference: mockReference,
          channel: 'mock', // how to tell test orders apart later
          amount: totalKobo,
          currency,
        },
      });

      await reserveStock(mockOrder);
      notifyAdmin(mockOrder); // email the owner (marked as a TEST order)
      console.warn(
        `[MOCK PAYMENT] Order ${mockReference} was marked PAID without charging anyone (${currency} ${totalKobo / 100}).`
      );

      return res.json({
        authorization_url: `${frontendUrl}/order-status?status=success&reference=${mockReference}`,
        reference: mockReference,
        mock: true,
      });
    }

    const reference = `ACEY-${crypto.randomBytes(9).toString('hex')}`;

    // Save the order first so the reference always has a record behind it.
    const order = await Order.create({
      customer,
      orderItems,
      totalPrice: totalKobo / 100,
      currency,
      reference,
    });

    try {
      const { data } = await paystack(secret).post('/transaction/initialize', {
        email: customer.email,
        amount: totalKobo, // Paystack wants kobo as a whole number
        currency,
        reference,
        callback_url: `${backendUrl}/api/orders/verify`,
        metadata: { orderId: String(order._id) },
      });

      const authorizationUrl = data?.data?.authorization_url;
      if (data?.status !== true || !authorizationUrl) {
        throw new Error('Paystack did not return a payment link');
      }

      notifyAdmin(order); // email the owner (marked as awaiting payment)
      return res.json({ authorization_url: authorizationUrl, reference });
    } catch (paystackError) {
      console.error(
        'Paystack initialize failed:',
        paystackError.response?.status,
        paystackError.response?.data?.message || paystackError.message
      );
      await Order.updateOne({ _id: order._id }, { $set: { status: 'cancelled' } });
      return res
        .status(502)
        .json({ message: 'We could not start your payment. Please try again.' });
    }
  } catch (error) {
    console.error('initializeOrder error:', error);
    res.status(500).json({ message: 'Server error while starting your payment.' });
  }
};

// @desc    Paystack sends the customer here after payment. We confirm with Paystack,
//          update the order, then send the customer back to the store.
// @route   GET /api/orders/verify?reference=...
// @access  Public (the browser is redirected here by Paystack)
const verifyOrder = async (req, res) => {
  const raw = req.query.reference || req.query.trxref;
  const reference = typeof raw === 'string' ? raw.trim() : '';
  if (!REFERENCE_RE.test(reference)) return redirectToStore(res, 'failed');

  try {
    const { secret } = settings();

    const order = await Order.findOne({ reference });
    if (!order) return redirectToStore(res, 'failed');

    // Already handled (for example the customer refreshed this page): do not repeat the work.
    if (PAID_STATUSES.includes(order.status)) return redirectToStore(res, 'success', reference);
    if (order.status !== 'pending') {
      return redirectToStore(res, order.status === 'needs_review' ? 'error' : 'failed', reference);
    }

    // Only a still-pending order gets here, and confirming it needs a real Paystack key.
    if (isPlaceholderKey(secret)) throw new Error('PAYSTACK_SECRET_KEY is not set');

    const { data } = await paystack(secret).get(
      `/transaction/verify/${encodeURIComponent(reference)}`
    );
    const tx = data?.data;
    if (data?.status !== true || !tx) throw new Error('Unexpected reply from Paystack');

    const paymentResult = {
      id: String(tx.id),
      status: tx.status,
      reference: tx.reference,
      channel: tx.channel,
      amount: tx.amount,
      currency: tx.currency,
    };

    if (tx.status === 'success') {
      const expectedKobo = Math.round(order.totalPrice * 100);
      const matches =
        tx.reference === order.reference &&
        tx.amount === expectedKobo &&
        tx.currency === order.currency;

      if (!matches) {
        console.error(
          `Order ${order.reference}: payment mismatch. Expected ${expectedKobo} ${order.currency}, got ${tx.amount} ${tx.currency}`
        );
        await Order.updateOne(
          { _id: order._id, status: 'pending' },
          { $set: { status: 'needs_review', paymentResult } }
        );
        return redirectToStore(res, 'error', reference);
      }

      // Only the request that flips pending -> paid goes on to reduce stock,
      // so a refresh or a second click can never deduct stock twice.
      const paidAt = tx.paid_at && !Number.isNaN(Date.parse(tx.paid_at)) ? new Date(tx.paid_at) : new Date();
      const paidOrder = await Order.findOneAndUpdate(
        { _id: order._id, status: 'pending' },
        { $set: { status: 'paid', paidAt, paymentResult } },
        { new: true }
      );
      if (paidOrder) await reserveStock(paidOrder);

      return redirectToStore(res, 'success', reference);
    }

    if (tx.status === 'failed' || tx.status === 'reversed') {
      await Order.updateOne(
        { _id: order._id, status: 'pending' },
        { $set: { status: 'failed', paymentResult } }
      );
    }

    // Anything else (abandoned, still processing) leaves the order pending.
    return redirectToStore(res, 'failed', reference);
  } catch (error) {
    console.error('verifyOrder error:', error.response?.data?.message || error.message);
    return redirectToStore(res, 'error', reference);
  }
};

// @desc    Get all orders, newest first
// @route   GET /api/orders
// @access  Admin
const getOrders = async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 }).lean();
    res.json(orders);
  } catch (error) {
    console.error('getOrders error:', error);
    res.status(500).json({ message: 'Server error while fetching orders.' });
  }
};

module.exports = { initializeOrder, verifyOrder, getOrders };
