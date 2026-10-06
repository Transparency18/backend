const sharp = require('sharp');

const TARGET_SIZE = 1024 * 1024; // 1 MB
const WIDTHS = [1600, 1280, 1024, 800, 600];
const QUALITIES = [85, 75, 65, 55, 45];

// Returns { buffer, mimetype }. Images already under 1 MB are returned unchanged;
// larger ones are re-encoded as JPEG, stepping down quality then size until under 1 MB.
async function compressImage(buffer, mimetype) {
    if (buffer.length <= TARGET_SIZE) return { buffer, mimetype };

    for (const width of WIDTHS) {
        for (const quality of QUALITIES) {
            const output = await sharp(buffer)
                .rotate() // apply EXIF orientation before metadata is stripped
                .resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
                .flatten({ background: '#ffffff' }) // PNG transparency -> white for JPEG
                .jpeg({ quality, mozjpeg: true })
                .toBuffer();
            if (output.length <= TARGET_SIZE) return { buffer: output, mimetype: 'image/jpeg' };
        }
    }
    throw new Error('Could not compress image below 1 MB.');
}

module.exports = { compressImage };
