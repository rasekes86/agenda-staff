const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { PDFDocument, StandardFonts, rgb } = require('../pdf-lib.min.js');

const POINTS_PER_INCH = 72;
const TEST_DPI = 600;

async function renderForPdf(svg, widthPoints, heightPoints) {
  const width = Math.max(1, Math.ceil(widthPoints * TEST_DPI / POINTS_PER_INCH));
  const height = Math.max(1, Math.ceil(heightPoints * TEST_DPI / POINTS_PER_INCH));
  return sharp(Buffer.from(svg)).resize(width, height, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } }).png().toBuffer();
}

async function main() {
  const svgPath = process.argv[2];
  const outputPath = process.argv[3];
  if (!svgPath || !outputPath) throw new Error('Uso: node tests/signature-pdf-quality-test.js firma.svg salida.pdf');
  const svg = fs.readFileSync(svgPath, 'utf8');
  if (/<image\b/i.test(svg) || !/<path\b/i.test(svg)) throw new Error('La prueba requiere paths SVG reales');

  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const cases = [
    ['Firma pequeña', 100, 35],
    ['Firma grande', 430, 150],
    ['Campo muy ancho', 500, 60],
    ['Campo muy alto', 125, 310],
    ['Reducción extrema', 55, 20]
  ];
  for (const [label, boxWidth, boxHeight] of cases) {
    const page = document.addPage([595, 842]);
    page.drawText(`${label} · SVG renderizado a ${TEST_DPI} DPI para el tamaño final`, { x: 42, y: 790, size: 13, font });
    const x = (595 - boxWidth) / 2;
    const y = (842 - boxHeight) / 2;
    page.drawRectangle({ x, y, width: boxWidth, height: boxHeight, borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 0.5 });
    const png = await renderForPdf(svg, boxWidth, boxHeight);
    const embedded = await document.embedPng(png);
    const scale = Math.min(boxWidth / embedded.width, boxHeight / embedded.height);
    const drawWidth = embedded.width * scale;
    const drawHeight = embedded.height * scale;
    page.drawImage(embedded, { x: x + (boxWidth - drawWidth) / 2, y: y + (boxHeight - drawHeight) / 2, width: drawWidth, height: drawHeight });
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, await document.save());
  console.log(JSON.stringify({ pages: cases.length, dpi: TEST_DPI, cases: cases.map(([name, width, height]) => ({ name, width, height })) }));
}

main().catch(error => { console.error(error); process.exit(1); });
