(() => {
  const source = document.getElementById('source');
  const stage = document.getElementById('crop-stage');
  const selection = document.getElementById('selection');
  const preview = document.getElementById('preview');
  const previewImage = document.getElementById('preview-image');
  const loading = document.getElementById('loading');
  const saveButton = document.getElementById('save');
  let startX = 0;
  let startY = 0;
  let selecting = false;
  let previewDataUrl = '';

  const cancel = () => chrome.runtime.sendMessage({ type: 'AGENDA_CANCEL_SIGNATURE_CROP' }).catch(() => window.close());

  function clampPoint(event) {
    const imageRect = source.getBoundingClientRect();
    return {
      x: Math.max(imageRect.left, Math.min(imageRect.right, event.clientX)),
      y: Math.max(imageRect.top, Math.min(imageRect.bottom, event.clientY)),
      imageRect
    };
  }

  function processCrop(rect) {
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(source, Math.round(rect.x), Math.round(rect.y), width, height, 0, 0, width, height);
    const imageData = context.getImageData(0, 0, width, height);
    const data = imageData.data;
    let left = width;
    let top = height;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4;
        const red = data[offset];
        const green = data[offset + 1];
        const blue = data[offset + 2];
        const max = Math.max(red, green, blue);
        const min = Math.min(red, green, blue);
        const brightness = (red + green + blue) / 3;
        if (brightness > 248 && max - min < 18) data[offset + 3] = 0;
        else if (brightness > 218 && max - min < 38) data[offset + 3] = Math.max(0, Math.round(255 * (248 - brightness) / 30));
        if (data[offset + 3] > 18) {
          left = Math.min(left, x);
          right = Math.max(right, x);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
      }
    }
    if (right < left || bottom < top) throw new Error('No se han detectado trazos en el recorte');
    context.putImageData(imageData, 0, 0);
    const padding = 8;
    left = Math.max(0, left - padding);
    top = Math.max(0, top - padding);
    right = Math.min(width - 1, right + padding);
    bottom = Math.min(height - 1, bottom + padding);
    const output = document.createElement('canvas');
    output.width = right - left + 1;
    output.height = bottom - top + 1;
    output.getContext('2d').drawImage(canvas, left, top, output.width, output.height, 0, 0, output.width, output.height);
    return output.toDataURL('image/png');
  }

  stage.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !source.complete) return;
    const point = clampPoint(event);
    if (event.clientX < point.imageRect.left || event.clientX > point.imageRect.right || event.clientY < point.imageRect.top || event.clientY > point.imageRect.bottom) return;
    selecting = true;
    startX = point.x;
    startY = point.y;
    selection.hidden = false;
    Object.assign(selection.style, { left: `${startX}px`, top: `${startY}px`, width: '0px', height: '0px' });
    stage.setPointerCapture(event.pointerId);
  });

  stage.addEventListener('pointermove', event => {
    if (!selecting) return;
    const point = clampPoint(event);
    const left = Math.min(startX, point.x);
    const top = Math.min(startY, point.y);
    Object.assign(selection.style, { left: `${left}px`, top: `${top}px`, width: `${Math.abs(point.x - startX)}px`, height: `${Math.abs(point.y - startY)}px` });
  });

  stage.addEventListener('pointerup', async event => {
    if (!selecting) return;
    selecting = false;
    const rect = selection.getBoundingClientRect();
    const imageRect = source.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) {
      selection.hidden = true;
      return;
    }
    const scaleX = source.naturalWidth / imageRect.width;
    const scaleY = source.naturalHeight / imageRect.height;
    loading.hidden = false;
    selection.hidden = true;
    try {
      previewDataUrl = processCrop({
        x: (rect.left - imageRect.left) * scaleX,
        y: (rect.top - imageRect.top) * scaleY,
        width: rect.width * scaleX,
        height: rect.height * scaleY
      });
    } catch (error) {
      loading.hidden = true;
      alert(error.message || 'No se ha podido realizar el recorte');
      return;
    }
    loading.hidden = true;
    previewImage.src = previewDataUrl;
    preview.hidden = false;
  });

  document.getElementById('repeat').addEventListener('click', () => {
    preview.hidden = true;
    selection.hidden = true;
  });
  document.getElementById('cancel').addEventListener('click', cancel);
  document.getElementById('preview-cancel').addEventListener('click', cancel);
  saveButton.addEventListener('click', async () => {
    saveButton.disabled = true;
    saveButton.textContent = 'Guardando…';
    const result = await chrome.runtime.sendMessage({ type: 'AGENDA_CONFIRM_SIGNATURE_CROP', imageUrl: previewDataUrl });
    if (!result?.success) {
      saveButton.disabled = false;
      saveButton.textContent = 'Guardar firma';
      alert(result?.error || 'No se ha podido guardar la firma');
    }
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') cancel(); });

  chrome.runtime.sendMessage({ type: 'AGENDA_GET_SIGNATURE_CROP_SOURCE' }).then(result => {
    if (!result?.success) throw new Error(result?.error || 'No se ha podido recuperar la captura');
    document.getElementById('title').textContent = `Recortar firma de ${result.name}`;
    source.onload = () => { loading.hidden = true; };
    source.src = result.dataUrl;
  }).catch(error => {
    loading.textContent = error.message || 'No se ha podido abrir el recortador';
  });
})();
