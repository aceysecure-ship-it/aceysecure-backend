const multer = require('multer');

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB (also Cloudinary's free-plan limit for images)
const MAX_VIDEO_BYTES = 40 * 1024 * 1024; // 40 MB. Files are held in memory while uploading.

const badFileType = (message) => Object.assign(new Error(message), { code: 'BAD_FILE_TYPE' });

const upload = multer({
  storage: multer.memoryStorage(), // nothing is written to disk
  limits: {
    fileSize: MAX_VIDEO_BYTES,
    files: 6, // 1 main photo + up to 5 extras
    fields: 40,
    fieldSize: 200 * 1024, // text fields (description, specs...) up to 200 KB
  },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'image') {
      if (!IMAGE_TYPES.includes(file.mimetype)) {
        return cb(badFileType('The main photo must be a JPG, PNG, WebP, GIF or AVIF image.'));
      }
    } else if (!IMAGE_TYPES.includes(file.mimetype) && !VIDEO_TYPES.includes(file.mimetype)) {
      return cb(badFileType('Only JPG, PNG, WebP, GIF or AVIF images and MP4, WebM or MOV videos are allowed.'));
    }
    return cb(null, true);
  },
});

const mediaFields = upload.fields([
  { name: 'image', maxCount: 1 }, // the main photo
  { name: 'images', maxCount: 5 }, // extra photos and videos
]);

// Runs multer and turns its errors into a clear JSON message.
// Requests that are not multipart (plain JSON, such as a stock update) pass straight through.
const uploadProductMedia = (req, res, next) => {
  mediaFields(req, res, (error) => {
    if (!error) return next();

    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        message: 'A file is too large. Images can be up to 10 MB and videos up to 40 MB.',
      });
    }
    if (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ message: 'Too many files. Use 1 main photo and up to 5 extras.' });
    }
    if (error.code === 'BAD_FILE_TYPE') {
      return res.status(400).json({ message: error.message });
    }
    return res.status(400).json({ message: 'The upload could not be read. Please try again.' });
  });
};

module.exports = { uploadProductMedia, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES };
