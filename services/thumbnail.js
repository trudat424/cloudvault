const sharp = require('sharp');

async function generateThumbnail(inputPath, outputPath) {
  try {
    await sharp(inputPath)
      .resize(300)
      .jpeg({ quality: 80 })
      .toFile(outputPath);
    return true;
  } catch (err) {
    console.error('Thumbnail generation failed:', err.message);
    return false;
  }
}

module.exports = { generateThumbnail };
