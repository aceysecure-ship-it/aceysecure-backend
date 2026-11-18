const mongoose = require('mongoose');

// One line of the specifications table, for example { label: 'Resolution', value: '4MP' }
const specSchema = new mongoose.Schema(
  {
    label: {
      type: String,
      required: [true, 'Each spec needs a label'],
      trim: true,
      maxlength: [60, 'Spec labels can be up to 60 characters'],
    },
    value: {
      type: String,
      required: [true, 'Each spec needs a value'],
      trim: true,
      maxlength: [120, 'Spec values can be up to 120 characters'],
    },
  },
  { _id: false }
);

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Product name is required'],
      trim: true,
    },
    description: {
      type: String,
      required: [true, 'Product description is required'],
      trim: true,
    },
    // Stored in normal currency units (e.g. 45000 = ₦45,000).
    // Convert to kobo (x 100) only when you send the amount to Paystack.
    price: {
      type: Number,
      required: [true, 'Price is required'],
      min: [0, 'Price cannot be negative'],
      default: 0,
    },
    image: {
      type: String,
      required: [true, 'Image URL is required'],
      trim: true,
    },
    brand: {
      type: String,
      required: [true, 'Brand is required'],
      trim: true,
    },
    category: {
      type: String,
      required: [true, 'Category is required'],
      trim: true,
    },
    countInStock: {
      type: Number,
      required: [true, 'Stock count is required'],
      min: [0, 'Stock cannot be negative'],
      default: 0,
    },
    rating: {
      type: Number,
      min: [0, 'Rating cannot be below 0'],
      max: [5, 'Rating cannot be above 5'],
      default: 0,
    },

    // How the camera is powered, for example "Plug-in", "Battery" or "Solar"
    power: { type: String, trim: true, maxlength: 40, default: '' },

    // Where footage is kept, for example "Cloud", "Memory Card", "Both" or "Recorder"
    storage: { type: String, trim: true, maxlength: 40, default: '' },

    // Specifications table: [{ label: 'Resolution', value: '4MP' }, ...]
    specs: {
      type: [specSchema],
      default: [],
      validate: {
        validator: (items) => items.length <= 20,
        message: 'Use at most 20 specs',
      },
    },

    // Extra photos for the gallery (the main photo stays in "image")
    images: {
      type: [
        {
          type: String,
          trim: true,
          match: [/^https?:\/\//i, 'Extra image links must start with http:// or https://'],
        },
      ],
      default: [],
      validate: {
        validator: (items) => items.length <= 5,
        message: 'Use at most 5 extra images',
      },
    },

    // Trust badges the admin can switch on for this product (shown on its page).
    // Only switch on what is true for the product, for example the warranty.
    badges: {
      warranty: { type: Boolean, default: false },
      secureCheckout: { type: Boolean, default: true },
      fastShipping: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Product', productSchema);
