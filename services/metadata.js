const exifr = require('exifr');

async function extractMetadata(filePath) {
  try {
    const data = await exifr.parse(filePath, {
      pick: [
        'DateTimeOriginal', 'CreateDate',
        'GPSLatitude', 'GPSLongitude',
        'Make', 'Model',
        'ImageWidth', 'ImageHeight',
        'ExifImageWidth', 'ExifImageHeight',
      ],
      gps: true,
    });

    if (!data) return {};

    return {
      dateTaken: data.DateTimeOriginal
        ? data.DateTimeOriginal.toISOString()
        : data.CreateDate
          ? data.CreateDate.toISOString()
          : null,
      latitude: data.latitude || null,
      longitude: data.longitude || null,
      cameraMake: data.Make || null,
      cameraModel: data.Model || null,
      width: data.ExifImageWidth || data.ImageWidth || null,
      height: data.ExifImageHeight || data.ImageHeight || null,
    };
  } catch (err) {
    console.error('EXIF extraction failed:', err.message);
    return {};
  }
}

module.exports = { extractMetadata };
