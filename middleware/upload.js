const multer = require('multer');

const MAX_PHOTO_SIZE = 10 * 1024 * 1024; // 10 MB upload; stored copy is compressed to under 1 MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Keep the file in memory; it is streamed straight to Supabase Storage.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_PHOTO_SIZE },
    fileFilter: (req, file, cb) => {
        if (ALLOWED_TYPES.includes(file.mimetype)) return cb(null, true);
        cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'photo'));
    },
});

// Wraps multer so its errors become clean 400 JSON responses.
const uploadPhoto = (req, res, next) => {
    upload.single('photo')(req, res, (err) => {
        if (!err) return next();
        const message = err.code === 'LIMIT_FILE_SIZE'
            ? 'Profile photo must be 10 MB or smaller.'
            : 'Profile photo must be a JPG, PNG or WEBP image.';
        res.status(400).json({ message });
    });
};

module.exports = { uploadPhoto };
