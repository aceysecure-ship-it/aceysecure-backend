const { v2: cloudinary } = require('cloudinary');

const FOLDER = 'aceysecure/products'; // where uploads are stored inside your Cloudinary account
const ALLOWED_FORMATS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'mp4', 'webm', 'mov'];

// True when all three values exist in .env
const cloudinaryReady = () =>
  Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
  );

// Set up the SDK the first time it is needed (so .env is always loaded by then).
let configured = false;
const getCloudinary = () => {
  if (!configured) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true, // always give back https links
    });
    configured = true;
  }
  return cloudinary;
};

// Upload one file that is held in memory (multer memoryStorage), without touching the disk.
// Works for images and videos. Resolves with { url, publicId, resourceType }.
const uploadBuffer = (file) =>
  new Promise((resolve, reject) => {
    const stream = getCloudinary().uploader.upload_stream(
      {
        folder: FOLDER,
        resource_type: 'auto', // Cloudinary decides: image or video
        allowed_formats: ALLOWED_FORMATS,
      },
      (error, result) => {
        if (error || !result) {
          const failure = new Error(error?.message || 'Upload to Cloudinary failed');
          failure.uploadFailed = true;
          return reject(failure);
        }
        resolve({
          url: result.secure_url,
          publicId: result.public_id,
          resourceType: result.resource_type,
        });
      }
    );
    stream.end(file.buffer);
  });

// Work out which Cloudinary file a saved link points to, so it can be deleted later.
// Only links from YOUR cloud are recognised; anything else (like a pasted image link) returns null.
const parseCloudinaryUrl = (url) => {
  if (typeof url !== 'string') return null;
  const match = /^https:\/\/res\.cloudinary\.com\/([^/]+)\/(image|video|raw)\/upload\/v\d+\/([^?#]+)$/.exec(url);
  if (!match || match[1] !== process.env.CLOUDINARY_CLOUD_NAME) return null;
  return {
    resourceType: match[2],
    publicId: decodeURIComponent(match[3]).replace(/\.[^./]+$/, ''), // drop the .jpg / .mp4 ending
  };
};

// Delete files that were just uploaded (used when saving the product fails afterwards).
const destroyUploaded = async (uploaded) => {
  if (!uploaded.length) return;
  await Promise.allSettled(
    uploaded.map((item) =>
      getCloudinary().uploader.destroy(item.publicId, { resource_type: item.resourceType, invalidate: true })
    )
  );
};

// Delete the Cloudinary files behind some saved links. Best effort: a failure is logged,
// never shown to the admin, because the product itself has already been saved.
const destroyByUrls = async (urls) => {
  if (!cloudinaryReady()) return;
  const targets = [...new Set(urls)].map(parseCloudinaryUrl).filter(Boolean);
  const results = await Promise.allSettled(
    targets.map((target) =>
      getCloudinary().uploader.destroy(target.publicId, {
        resource_type: target.resourceType,
        invalidate: true,
      })
    )
  );
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.error(`Could not delete ${targets[index].publicId} from Cloudinary:`, result.reason?.message);
    }
  });
};

module.exports = {
  cloudinary,
  getCloudinary,
  cloudinaryReady,
  uploadBuffer,
  parseCloudinaryUrl,
  destroyUploaded,
  destroyByUrls,
};
