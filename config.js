const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname);

module.exports = { DATA_DIR };
