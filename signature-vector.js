(() => {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';

  function svgToDataUrl(svg) {
    return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
  }

  function dataUrlToSvg(value) {
    if (!value) return '';
    if (value.startsWith('data:image/svg+xml;base64,')) {
      return decodeURIComponent(escape(atob(value.split(',')[1])));
    }
    if (value.startsWith('data:image/svg+xml,')) return decodeURIComponent(value.split(',').slice(1).join(','));
    return value.trim().startsWith('<svg') ? value : '';
  }

  function pointsPath(points) {
    if (!points.length) return '';
    if (points.length === 1) return `M ${points[0].x} ${points[0].y} l .01 .01`;
    let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
    for (let index = 1; index < points.length - 1; index++) {
      const point = points[index];
      const next = points[index + 1];
      d += ` Q ${point.x.toFixed(2)} ${point.y.toFixed(2)} ${((point.x + next.x) / 2).toFixed(2)} ${((point.y + next.y) / 2).toFixed(2)}`;
    }
    const last = points[points.length - 1];
    return `${d} L ${last.x.toFixed(2)} ${last.y.toFixed(2)}`;
  }

  function pathsToSvg(paths, options = {}) {
    const usable = (paths || []).filter(path => Array.isArray(path) && path.length).map(path => path.map(point => ({ x: Number(point.x), y: Number(point.y) })));
    if (!usable.length) throw new Error('La firma no contiene trazos');
    const strokeWidth = Math.max(1, Number(options.strokeWidth) || 3);
    const all = usable.flat();
    const minX = Math.min(...all.map(point => point.x));
    const minY = Math.min(...all.map(point => point.y));
    const maxX = Math.max(...all.map(point => point.x));
    const maxY = Math.max(...all.map(point => point.y));
    const padding = Math.max(4, strokeWidth * 2);
    const width = Math.max(1, maxX - minX + padding * 2);
    const height = Math.max(1, maxY - minY + padding * 2);
    const translated = usable.map(path => path.map(point => ({ x: point.x - minX + padding, y: point.y - minY + padding })));
    const body = translated.map(path => `<path d="${pointsPath(path)}"/>`).join('');
    const color = options.color || '#111827';
    return `<svg xmlns="${SVG_NS}" viewBox="0 0 ${width.toFixed(2)} ${height.toFixed(2)}" preserveAspectRatio="xMidYMid meet"><g fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`;
  }

  function pointLineDistance(point, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (!dx && !dy) return Math.hypot(point.x - start.x, point.y - start.y);
    const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
  }

  function simplify(points, tolerance = 1.2) {
    if (points.length <= 3) return points;
    let maxDistance = 0;
    let split = 0;
    for (let index = 1; index < points.length - 1; index++) {
      const distance = pointLineDistance(points[index], points[0], points[points.length - 1]);
      if (distance > maxDistance) { maxDistance = distance; split = index; }
    }
    if (maxDistance <= tolerance) return [points[0], points[points.length - 1]];
    return [...simplify(points.slice(0, split + 1), tolerance).slice(0, -1), ...simplify(points.slice(split), tolerance)];
  }

  function contourPath(points) {
    if (points.length < 3) return '';
    const firstMid = { x: (points[0].x + points[points.length - 1].x) / 2, y: (points[0].y + points[points.length - 1].y) / 2 };
    let d = `M ${firstMid.x.toFixed(2)} ${firstMid.y.toFixed(2)}`;
    for (let index = 0; index < points.length; index++) {
      const point = points[index];
      const next = points[(index + 1) % points.length];
      d += ` Q ${point.x.toFixed(2)} ${point.y.toFixed(2)} ${((point.x + next.x) / 2).toFixed(2)} ${((point.y + next.y) / 2).toFixed(2)}`;
    }
    return `${d} Z`;
  }

  function traceMask(mask, width, height) {
    const key = (x, y) => `${x},${y}`;
    const edges = new Map();
    const add = (ax, ay, bx, by) => {
      const start = key(ax, ay);
      if (!edges.has(start)) edges.set(start, []);
      edges.get(start).push({ x: bx, y: by });
    };
    const ink = (x, y) => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (!ink(x, y)) continue;
      if (!ink(x, y - 1)) add(x, y, x + 1, y);
      if (!ink(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!ink(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!ink(x - 1, y)) add(x, y + 1, x, y);
    }
    const contours = [];
    while (edges.size) {
      const [startKey, targets] = edges.entries().next().value;
      const [sx, sy] = startKey.split(',').map(Number);
      const points = [{ x: sx, y: sy }];
      let currentKey = startKey;
      let guard = width * height * 8;
      while (guard-- > 0) {
        const choices = edges.get(currentKey);
        if (!choices?.length) break;
        const next = choices.shift();
        if (!choices.length) edges.delete(currentKey);
        points.push(next);
        currentKey = key(next.x, next.y);
        if (currentKey === startKey) break;
      }
      if (points.length > 6 && currentKey === startKey) contours.push(points.slice(0, -1));
    }
    return contours;
  }

  function maskToSvg(mask, width, height, options = {}) {
    const active = Array.from(mask).reduce((sum, value) => sum + Number(Boolean(value)), 0);
    if (!active) throw new Error('No se detectaron trazos vectorizables');
    let minX = width, minY = height, maxX = 0, maxY = 0;
    for (let index = 0; index < mask.length; index++) if (mask[index]) {
      const x = index % width, y = Math.floor(index / width);
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x + 1); maxY = Math.max(maxY, y + 1);
    }
    const padding = 3;
    const contours = traceMask(mask, width, height);
    const pathData = contours.map(contour => simplify(contour, Number(options.tolerance) || 1.15).map(point => ({ x: point.x - minX + padding, y: point.y - minY + padding }))).map(contourPath).filter(Boolean).join(' ');
    if (!pathData) throw new Error('No se pudieron construir paths SVG');
    const viewWidth = maxX - minX + padding * 2;
    const viewHeight = maxY - minY + padding * 2;
    const svg = `<svg xmlns="${SVG_NS}" viewBox="0 0 ${viewWidth} ${viewHeight}" preserveAspectRatio="xMidYMid meet"><path d="${pathData}" fill="${options.color || '#111827'}" fill-rule="evenodd"/></svg>`;
    return { svg, dataUrl: svgToDataUrl(svg), width: viewWidth, height: viewHeight, contourCount: contours.length };
  }

  async function pngToSvg(src, options = {}) {
    const image = await new Promise((resolve, reject) => {
      const loaded = new Image();
      loaded.crossOrigin = 'anonymous';
      loaded.onload = () => resolve(loaded);
      loaded.onerror = () => reject(new Error('No se pudo leer la firma PNG'));
      loaded.src = src;
    });
    const scale = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    let transparent = 0;
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index] < 245) transparent++;
    const hasTransparency = transparent > width * height * 0.005;
    const corners = [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]].map(([x, y]) => {
      const index = (y * width + x) * 4;
      return [pixels[index], pixels[index + 1], pixels[index + 2]];
    });
    const background = [0, 1, 2].map(channel => corners.reduce((sum, color) => sum + color[channel], 0) / corners.length);
    const mask = new Uint8Array(width * height);
    for (let index = 0; index < mask.length; index++) {
      const offset = index * 4;
      const alpha = pixels[offset + 3];
      const distance = Math.hypot(pixels[offset] - background[0], pixels[offset + 1] - background[1], pixels[offset + 2] - background[2]);
      mask[index] = hasTransparency ? Number(alpha > 28) : Number(alpha > 28 && distance > 34);
    }

    // Remove isolated components while retaining dots belonging to the signature.
    const visited = new Uint8Array(mask.length);
    const components = [];
    for (let start = 0; start < mask.length; start++) {
      if (!mask[start] || visited[start]) continue;
      const queue = [start];
      const component = [];
      visited[start] = 1;
      while (queue.length) {
        const current = queue.pop();
        component.push(current);
        const x = current % width;
        const y = Math.floor(current / width);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          const next = ny * width + nx;
          if (nx >= 0 && ny >= 0 && nx < width && ny < height && mask[next] && !visited[next]) { visited[next] = 1; queue.push(next); }
        }
      }
      components.push(component);
    }
    const largest = Math.max(0, ...components.map(component => component.length));
    mask.fill(0);
    components.filter(component => component.length >= Math.max(3, largest * 0.002)).forEach(component => component.forEach(index => { mask[index] = 1; }));
    return maskToSvg(mask, width, height, options);
  }

  function dimensions(svgValue) {
    const svg = dataUrlToSvg(svgValue);
    const match = svg.match(/viewBox=["']\s*([\d.+-]+)[ ,]+([\d.+-]+)[ ,]+([\d.+-]+)[ ,]+([\d.+-]+)\s*["']/i);
    return match ? { width: Number(match[3]), height: Number(match[4]) } : { width: 1, height: 1 };
  }

  async function renderSvg(svgValue, width, height) {
    const dataUrl = svgValue.startsWith('data:') ? svgValue : svgToDataUrl(svgValue);
    const image = await new Promise((resolve, reject) => {
      const loaded = new Image();
      loaded.onload = () => resolve(loaded);
      loaded.onerror = () => reject(new Error('No se pudo renderizar el SVG'));
      loaded.src = dataUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  }

  window.AgendaSignatureVector = { svgToDataUrl, dataUrlToSvg, pathsToSvg, pngToSvg, maskToSvg, dimensions, renderSvg };
})();
