const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

global.window = {};
require('../signature-vector.js');

async function main() {
  const input = process.argv[2];
  const output = process.argv[3];
  if (!input || !output) throw new Error('Uso: node tests/signature-vector-test.js entrada.png salida.svg');
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const mask = new Uint8Array(info.width * info.height);
  for (let index = 0; index < mask.length; index++) mask[index] = data[index * 4 + 3] > 28 ? 1 : 0;
  const traced = window.AgendaSignatureVector.maskToSvg(mask, info.width, info.height);
  if (/<image\b/i.test(traced.svg)) throw new Error('El SVG contiene una imagen raster incrustada');
  if (!/<path\b/i.test(traced.svg)) throw new Error('El SVG no contiene paths');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, traced.svg);
  console.log(JSON.stringify({ input: { width: info.width, height: info.height }, output: { width: traced.width, height: traced.height, contours: traced.contourCount }, hasPath: true, hasImage: false }));
}

main().catch(error => { console.error(error); process.exit(1); });
