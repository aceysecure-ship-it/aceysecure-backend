const express = require('express');
const {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
} = require('../controllers/productController');
const { protect, admin } = require('../middleware/authMiddleware');
const { uploadProductMedia } = require('../middleware/uploadMiddleware');

const router = express.Router();

// Anyone can look at products. Only a logged-in admin can change them.
// protect + admin run FIRST, so only a logged-in admin can send files at all.
// uploadProductMedia then reads multipart form data (and lets plain JSON requests through).
router.route('/').get(getProducts).post(protect, admin, uploadProductMedia, createProduct);

router
  .route('/:id')
  .get(getProductById)
  .put(protect, admin, uploadProductMedia, updateProduct)
  .delete(protect, admin, deleteProduct);

module.exports = router;
