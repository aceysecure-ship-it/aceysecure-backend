const Product = require('../models/Product');
const {
  cloudinaryReady,
  uploadBuffer,
  destroyUploaded,
  destroyByUrls,
} = require('../config/cloudinary');
const { MAX_IMAGE_BYTES } = require('../middleware/uploadMiddleware');

const MAX_EXTRA_MEDIA = 5; // extra photos and videos besides the main photo

// Only these fields can be set from a request body.
const ALLOWED_FIELDS = [
  'name',
  'description',
  'price',
  'image',
  'brand',
  'category',
  'countInStock',
  'rating',
  'power',
  'storage',
  'specs',
  'images',
  'badges',
];

const pickAllowedFields = (body = {}) =>
  ALLOWED_FIELDS.reduce((fields, key) => {
    if (body[key] !== undefined) fields[key] = body[key];
    return fields;
  }, {});

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Query values must be plain strings (blocks things like ?category[$ne]=x).
const asString = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

// In a multipart (file upload) request every value arrives as text, so lists and objects
// such as specs and badges are sent as JSON text and turned back into real data here.
const parseJsonField = (value) => {
  if (typeof value !== 'string') return { value };
  try {
    return { value: JSON.parse(value) };
  } catch {
    return { error: true };
  }
};

// Reads the text fields of the request. `kept` is the list of already-saved extra media the
// admin chose to keep (undefined when the request does not mention it).
const prepareFields = (body = {}) => {
  const fields = pickAllowedFields(body);

  for (const key of ['specs', 'badges']) {
    if (fields[key] !== undefined) {
      const parsed = parseJsonField(fields[key]);
      if (parsed.error) return { error: `The ${key} value is not valid.` };
      fields[key] = parsed.value;
    }
  }

  let kept;
  if (body.existingImages !== undefined) {
    const parsed = parseJsonField(body.existingImages);
    if (parsed.error || !Array.isArray(parsed.value) || !parsed.value.every((url) => typeof url === 'string')) {
      return { error: 'The list of kept photos is not valid.' };
    }
    kept = parsed.value;
  }

  return { fields, kept };
};

// Checks the uploaded files before anything is sent to Cloudinary.
const checkFiles = (mainFile, extraFiles, keptList) => {
  if (mainFile && !mainFile.mimetype.startsWith('image/')) {
    return 'The main photo must be an image. Videos can be added under extra photos and videos.';
  }
  if (keptList.length + extraFiles.length > MAX_EXTRA_MEDIA) {
    return `Use at most ${MAX_EXTRA_MEDIA} extra photos and videos.`;
  }
  const tooBig = [mainFile, ...extraFiles]
    .filter(Boolean)
    .find((file) => file.mimetype.startsWith('image/') && file.size > MAX_IMAGE_BYTES);
  if (tooBig) return `“${String(tooBig.originalname).slice(0, 60)}” is too large. Images can be up to 10 MB.`;
  return null;
};

// Sends every file to Cloudinary (in parallel). Each finished upload is recorded in `uploaded`,
// so it can be deleted again if anything later fails.
const uploadAll = (files, uploaded) =>
  Promise.all(
    files.map(async (file) => {
      const result = await uploadBuffer(file);
      uploaded.push(result);
      return result.url;
    })
  );

const handleError = (res, error, action) => {
  if (error.uploadFailed) {
    console.error('Cloudinary upload failed:', error.message);
    return res.status(502).json({ message: `We couldn’t upload your files (${error.message}). Please try again.` });
  }
  if (error.name === 'ValidationError') {
    const message = Object.values(error.errors)
      .map((e) => e.message)
      .join(', ');
    return res.status(400).json({ message });
  }
  if (error.name === 'CastError') {
    return res.status(404).json({ message: 'Product not found' });
  }
  console.error(`Error while ${action}:`, error);
  return res.status(500).json({ message: `Server error while ${action}` });
};

// @desc    Get all products (optional ?keyword= and ?category=)
// @route   GET /api/products
// @access  Public
const getProducts = async (req, res) => {
  try {
    const filter = {};
    const keyword = asString(req.query.keyword);
    const category = asString(req.query.category);

    if (keyword) filter.name = { $regex: escapeRegex(keyword), $options: 'i' };
    if (category) filter.category = category;

    const products = await Product.find(filter).sort({ createdAt: -1 });
    res.json(products);
  } catch (error) {
    handleError(res, error, 'fetching products');
  }
};

// @desc    Get one product
// @route   GET /api/products/:id
// @access  Public
const getProductById = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: 'Product not found' });
    res.json(product);
  } catch (error) {
    handleError(res, error, 'fetching the product');
  }
};

// @desc    Create a product. Accepts JSON, or multipart form data with files:
//          "image" = main photo, "images" = extra photos and videos
// @route   POST /api/products
// @access  Admin
const createProduct = async (req, res) => {
  const uploaded = [];

  try {
    const { fields, kept, error } = prepareFields(req.body);
    if (error) return res.status(400).json({ message: error });

    const mainFile = req.files?.image?.[0];
    const extraFiles = req.files?.images || [];
    const keptList = kept ?? fields.images ?? [];

    const problem = checkFiles(mainFile, extraFiles, keptList);
    if (problem) return res.status(400).json({ message: problem });

    if ((mainFile || extraFiles.length) && !cloudinaryReady()) {
      return res.status(500).json({
        message: 'File uploads are not set up on the server. Check the CLOUDINARY_ values in .env.',
      });
    }

    if (mainFile) fields.image = (await uploadAll([mainFile], uploaded))[0];
    const extraUrls = await uploadAll(extraFiles, uploaded);
    if (kept !== undefined || fields.images !== undefined || extraUrls.length > 0) {
      fields.images = [...keptList, ...extraUrls];
    }

    if (!fields.image) return res.status(400).json({ message: 'Add a main photo for the product.' });

    const product = await Product.create(fields);
    res.status(201).json(product);
  } catch (error) {
    await destroyUploaded(uploaded); // do not leave files behind for a product that was not saved
    handleError(res, error, 'creating the product');
  }
};

// @desc    Update a product (JSON for small changes, multipart when files are included)
// @route   PUT /api/products/:id
// @access  Admin
const updateProduct = async (req, res) => {
  const uploaded = [];

  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: 'Product not found' });

    const { fields, kept, error } = prepareFields(req.body);
    if (error) return res.status(400).json({ message: error });

    const mainFile = req.files?.image?.[0];
    const extraFiles = req.files?.images || [];
    const providedList = kept ?? fields.images; // undefined = the request does not touch the extras
    const keptList = providedList ?? [...(product.images || [])];

    const problem = checkFiles(mainFile, extraFiles, keptList);
    if (problem) return res.status(400).json({ message: problem });

    if ((mainFile || extraFiles.length) && !cloudinaryReady()) {
      return res.status(500).json({
        message: 'File uploads are not set up on the server. Check the CLOUDINARY_ values in .env.',
      });
    }

    if (mainFile) fields.image = (await uploadAll([mainFile], uploaded))[0];
    const extraUrls = await uploadAll(extraFiles, uploaded);
    if (providedList !== undefined || extraUrls.length > 0) {
      fields.images = [...keptList, ...extraUrls];
    }

    const oldImage = product.image;
    const oldImages = [...(product.images || [])];

    Object.assign(product, fields);
    const updated = await product.save();

    // The product is saved. Now delete files it no longer uses (best effort).
    const stale = oldImages.filter((url) => !updated.images.includes(url));
    if (oldImage !== updated.image) stale.push(oldImage);
    await destroyByUrls(stale);

    res.json(updated);
  } catch (error) {
    await destroyUploaded(uploaded);
    handleError(res, error, 'updating the product');
  }
};

// @desc    Delete a product (and its uploaded photos and videos)
// @route   DELETE /api/products/:id
// @access  Admin
const deleteProduct = async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json({ message: 'Product not found' });

    await destroyByUrls([product.image, ...(product.images || [])]);
    res.json({ message: 'Product deleted' });
  } catch (error) {
    handleError(res, error, 'deleting the product');
  }
};

module.exports = {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
};
