const fs = require('fs');
const path = require('path');

(async () => {
  try {
    // Import ESM modules using dynamic import
    const pngToIcoMod = await import('png-to-ico');
    const pngToIco = pngToIcoMod.default || pngToIcoMod;
    
    const JimpMod = await import('jimp');
    const Jimp = JimpMod.default || JimpMod;

    const projectRoot = path.join(__dirname, '..');
    const sourcePng = path.join(projectRoot, 'Remote USB Port Control.png');
    const assetsDir = path.join(projectRoot, 'assets');
    const destPng = path.join(assetsDir, 'icon.png');
    const destSquarePng = path.join(assetsDir, 'icon-square.png');
    const destIco = path.join(assetsDir, 'icon.ico');

    if (!fs.existsSync(sourcePng)) {
      console.error('Source PNG not found at', sourcePng);
      process.exit(1);
    }

    if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir);

    // Copy PNG into assets
    fs.copyFileSync(sourcePng, destPng);
    console.log('Copied PNG to', destPng);

    // Ensure square PNG using Jimp
    const image = await Jimp.read(destPng);
    const w = image.bitmap.width;
    const h = image.bitmap.height;
    if (w !== h) {
      const size = Math.max(w, h);
      const square = new Jimp(size, size, 0x00000000);
      const x = Math.floor((size - w) / 2);
      const y = Math.floor((size - h) / 2);
      square.composite(image, x, y);
      await square.writeAsync(destSquarePng);
      console.log('Wrote square PNG to', destSquarePng);
    } else {
      // If already square, use the original copied PNG
      fs.copyFileSync(destPng, destSquarePng);
      console.log('Image already square, copied to', destSquarePng);
    }

    // Convert PNG to ICO (generates multi-size ICO)
    const icoBuffer = await pngToIco(destSquarePng);
    fs.writeFileSync(destIco, icoBuffer);
    console.log('Generated ICO at', destIco);
  } catch (err) {
    console.error('Failed to create ICO:', err);
    process.exit(1);
  }
})();
