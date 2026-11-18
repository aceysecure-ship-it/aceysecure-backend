const mongoose = require('mongoose');

// One line of the order. Name and price are copied from the product at the
// moment of purchase, so later price changes never rewrite old orders.
const orderItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, required: true },
    image: { type: String },
    price: { type: Number, required: true, min: 0 }, // price per unit
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    // Optional: checkout works for guests. Set this later if you link orders to accounts.
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    customer: {
      name: { type: String, required: true, trim: true },
      email: { type: String, required: true, trim: true, lowercase: true },
      phone: { type: String, required: true, trim: true },
      address: { type: String, required: true, trim: true },
    },

    orderItems: {
      type: [orderItemSchema],
      validate: {
        validator: (items) => items.length > 0,
        message: 'An order needs at least one item',
      },
    },

    // Whole currency units (for example naira), worked out on the server.
    totalPrice: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'NGN' },

    // Our own unique reference. It is also the Paystack transaction reference.
    reference: { type: String, required: true, unique: true },

    // pending      = created, waiting for payment
    // paid         = Paystack confirmed the right amount
    // needs_review = Paystack says paid but something did not match; check by hand
    status: {
      type: String,
      enum: ['pending', 'paid', 'shipped', 'delivered', 'failed', 'cancelled', 'needs_review'],
      default: 'pending',
      index: true,
    },

    paymentResult: {
      _id: false,
      id: { type: String },
      status: { type: String },
      reference: { type: String },
      channel: { type: String },
      amount: { type: Number }, // in kobo, exactly as Paystack reports it
      currency: { type: String },
    },

    paidAt: { type: Date },

    // Set if payment succeeded but stock could not be reduced (for example it sold out
    // in the meantime). Look at these orders by hand.
    stockIssue: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Order', orderSchema);
