const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { DATA_DIR } = require('../config');

const storage = multer.diskStorage({
  destination: path.join(DATA_DIR, 'uploads', 'originals'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, uuidv4() + ext);
  },
});

const fileFilter = (req, file, cb) => {
  const allowed = /^(image|video)\//;
  if (allowed.test(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only image and video files are allowed'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 500 * 1024 * 1024,
    files: 20,
  },
});

module.exports = upload;
