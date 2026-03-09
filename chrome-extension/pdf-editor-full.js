// ============================================
// PDF EDITOR FULL SCREEN - AGENDA STAFF v5.17.0
// ============================================

const SUPABASE_URL = 'https://iugutcsukxkxlgpkmzxt.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1Z3V0Y3N1a3hreGxncGttenh0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzc5OTExMjksImV4cCI6MjA1MzU2NzEyOX0.PpolAzqqXNBOhRlUVzplqkKeGQxzfed4gH377CidVJE';

let pdfJsDoc = null;
let pdfDoc = null;
let pdfBytes = null;
let originalPdfBytes = null;
let currentPage = 1;
let totalPages = 0;
let elements = {};
let zoom = 1;
let selectedElement = null;
let pageWidth = 0;
let pageHeight = 0;

const $ = id => document.getElementById(id);

// Show status message
function showStatus(msg, type = '') {
  const el = $('statusMsg');
  el.textContent = msg;
  el.className = 'status-msg show ' + type;
  setTimeout(() => el.classList.remove('show'), 3000);
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  console.log('PDF Editor initializing...');
  
  // Configure pdf.js worker
  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdf.worker.min.js';
  }
  
  setupEventListeners();
  showStatus('Editor listo - Carga un PDF para comenzar');
});

function setupEventListeners() {
  const fileInput = $('fileInput');
  const uploadArea = $('uploadArea');
  const uploadWrapper = $('uploadWrapper');
  
  // File input change - PRIMARY METHOD
  fileInput.addEventListener('change', (e) => {
    console.log('File input changed');
    if (e.target.files && e.target.files.length > 0) {
      loadPdf(e.target.files[0]);
    }
  });
  
  // Drag and drop on upload wrapper
  uploadWrapper.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadArea.classList.add('drag-over');
  });
  
  uploadWrapper.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadArea.classList.remove('drag-over');
  });
  
  uploadWrapper.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadArea.classList.remove('drag-over');
    console.log('File dropped', e.dataTransfer.files);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      loadPdf(e.dataTransfer.files[0]);
    }
  });
  
  // Upload button
  $('btnUpload').addEventListener('click', () => {
    console.log('Upload button clicked');
    fileInput.click();
  });
  
  // Other buttons
  $('btnSave').addEventListener('click', savePdf);
  $('btnClear').addEventListener('click', clearEditor);
  $('btnPrevPage').addEventListener('click', () => navigatePage(-1));
  $('btnNextPage').addEventListener('click', () => navigatePage(1));
  $('btnZoomIn').addEventListener('click', () => changeZoom(0.25));
  $('btnZoomOut').addEventListener('click', () => changeZoom(-0.25));
  $('btnAddText').addEventListener('click', showTextModal);
  $('btnAddImage').addEventListener('click', addImage);
  $('btnAddSignature').addEventListener('click', showSignatureModal);
  
  // Text modal
  $('cancelText').addEventListener('click', () => $('textModal').classList.remove('show'));
  $('confirmText').addEventListener('click', confirmText);
  
  // Signature modal
  $('cancelSignature').addEventListener('click', () => $('signatureModal').classList.remove('show'));
  $('btnSearchSignature').addEventListener('click', searchSignatures);
  $('signatureSearchInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') searchSignatures();
  });
  
  console.log('Event listeners setup complete');
}

async function loadPdf(file) {
  console.log('Loading PDF:', file.name);
  
  if (!file.name.toLowerCase().endsWith('.pdf')) {
    showStatus('Por favor, selecciona un archivo PDF', 'error');
    return;
  }
  
  const pdfjsLib = window.pdfjsLib;
  const pdfLib = window.PDFLib;
  
  if (!pdfjsLib || !pdfLib) {
    showStatus('Error: Las librerías no están cargadas', 'error');
    return;
  }
  
  showStatus('Cargando PDF...');
  
  try {
    const arrayBuffer = await file.arrayBuffer();
    pdfBytes = new Uint8Array(arrayBuffer);
    originalPdfBytes = new Uint8Array(arrayBuffer);
    
    const loadingTask = pdfjsLib.getDocument({ data: pdfBytes.slice() });
    pdfJsDoc = await loadingTask.promise;
    totalPages = pdfJsDoc.numPages;
    currentPage = 1;
    
    const { PDFDocument } = pdfLib;
    pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    
    // Get page dimensions
    const page = pdfDoc.getPage(0);
    const { width, height } = page.getSize();
    pageWidth = width;
    pageHeight = height;
    
    elements = {};
    for (let i = 1; i <= totalPages; i++) {
      elements[i] = [];
    }
    
    // Hide upload, show controls
    $('uploadWrapper').style.display = 'none';
    $('btnSave').disabled = false;
    $('pageNav').style.display = 'flex';
    $('zoomControls').style.display = 'flex';
    zoom = 1;
    $('zoomLevel').textContent = '100%';
    
    renderPage();
    showStatus(`PDF cargado: ${totalPages} página${totalPages > 1 ? 's' : ''}`, 'success');
    
  } catch (err) {
    console.error('Error loading PDF:', err);
    showStatus('Error al cargar: ' + err.message, 'error');
  }
}

async function renderPage() {
  if (!pdfJsDoc) return;
  
  const canvasArea = $('canvasArea');
  canvasArea.innerHTML = '';
  
  try {
    const page = await pdfJsDoc.getPage(currentPage);
    const viewport = page.getViewport({ scale: 1 });
    
    const scale = zoom;
    const scaledViewport = page.getViewport({ scale });
    
    const canvas = document.createElement('canvas');
    canvas.width = scaledViewport.width;
    canvas.height = scaledViewport.height;
    
    const ctx = canvas.getContext('2d');
    
    await page.render({
      canvasContext: ctx,
      viewport: scaledViewport
    }).promise;
    
    const container = document.createElement('div');
    container.className = 'canvas-container';
    container.style.width = canvas.width + 'px';
    container.style.height = canvas.height + 'px';
    container.appendChild(canvas);
    
    const overlay = document.createElement('div');
    overlay.className = 'elements-overlay';
    overlay.style.width = canvas.width + 'px';
    overlay.style.height = canvas.height + 'px';
    
    const pageElements = elements[currentPage] || [];
    pageElements.forEach((el, idx) => {
      const elDiv = createElementDiv(el, idx, scale);
      overlay.appendChild(elDiv);
    });
    
    container.appendChild(overlay);
    canvasArea.appendChild(container);
    
    $('currentPageNum').textContent = currentPage;
    $('totalPagesNum').textContent = totalPages;
    
    $('btnPrevPage').disabled = currentPage <= 1;
    $('btnNextPage').disabled = currentPage >= totalPages;
    
  } catch (err) {
    console.error('Error rendering page:', err);
  }
}

function createElementDiv(el, idx, scale) {
  const div = document.createElement('div');
  div.className = 'pdf-element pdf-element-' + el.type;
  div.dataset.idx = idx;
  div.style.left = (el.x * scale) + 'px';
  div.style.top = (el.y * scale) + 'px';
  
  if (el.type === 'text') {
    // Create a span for the text content
    const textSpan = document.createElement('span');
    textSpan.className = 'pdf-element-text-content';
    textSpan.textContent = el.text;
    textSpan.style.color = el.color || '#000';
    div.appendChild(textSpan);
    
    // Set width and height if available, otherwise calculate from font size
    if (el.width && el.height) {
      div.style.width = (el.width * scale) + 'px';
      div.style.height = (el.height * scale) + 'px';
      // Calculate font size based on container height
      const scaledFontSize = Math.max(8, (el.height * 0.8) * scale);
      textSpan.style.fontSize = scaledFontSize + 'px';
    } else {
      // Initial size based on text length and font size
      const fontSize = el.size || 14;
      const textWidth = el.text.length * fontSize * 0.6;
      const textHeight = fontSize * 1.4;
      el.width = Math.max(30, textWidth);
      el.height = Math.max(20, textHeight);
      div.style.width = (el.width * scale) + 'px';
      div.style.height = (el.height * scale) + 'px';
      textSpan.style.fontSize = (fontSize * scale) + 'px';
    }
  } else if (el.type === 'image' || el.type === 'signature') {
    const img = document.createElement('img');
    img.src = el.src;
    img.style.width = (el.width * scale) + 'px';
    img.style.height = (el.height * scale) + 'px';
    img.draggable = false;
    div.appendChild(img);
    div.style.background = 'transparent';
  }
  
  // Delete button
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'pdf-element-delete';
  deleteBtn.textContent = '✕';
  deleteBtn.onclick = (e) => {
    e.stopPropagation();
    elements[currentPage].splice(idx, 1);
    renderPage();
  };
  div.appendChild(deleteBtn);
  
  // Resize handles (corners)
  const handles = ['nw', 'ne', 'sw', 'se'];
  handles.forEach(pos => {
    const handle = document.createElement('div');
    handle.className = `resize-handle resize-handle-${pos}`;
    handle.dataset.handle = pos;
    div.appendChild(handle);
  });
  
  // Make draggable
  makeDraggable(div, el, scale);
  
  // Make resizable
  makeResizable(div, el, scale);
  
  return div;
}

function makeDraggable(div, el, scale) {
  let isDragging = false;
  let startX, startY, origX, origY;
  
  div.addEventListener('mousedown', (e) => {
    // Ignore if clicking on delete button or resize handle
    if (e.target.classList.contains('pdf-element-delete') || 
        e.target.classList.contains('resize-handle')) return;
    
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    origX = el.x * scale;
    origY = el.y * scale;
    div.classList.add('selected');
    selectedElement = { div, el };
    e.preventDefault();
  });
  
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    div.style.left = (origX + dx) + 'px';
    div.style.top = (origY + dy) + 'px';
  });
  
  document.addEventListener('mouseup', (e) => {
    if (!isDragging) return;
    isDragging = false;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    el.x = Math.max(0, (origX + dx) / scale);
    el.y = Math.max(0, (origY + dy) / scale);
    div.classList.remove('selected');
  });
}

function makeResizable(div, el, scale) {
  const handles = div.querySelectorAll('.resize-handle');
  let isResizing = false;
  let currentHandle = null;
  let startX, startY, startWidth, startHeight, startXPos, startYPos;
  
  handles.forEach(handle => {
    handle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      isResizing = true;
      currentHandle = handle.dataset.handle;
      startX = e.clientX;
      startY = e.clientY;
      startWidth = el.width;
      startHeight = el.height;
      startXPos = el.x;
      startYPos = el.y;
      
      div.classList.add('selected');
      div.classList.add('resizing');
    });
  });
  
  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    
    let newWidth = startWidth;
    let newHeight = startHeight;
    let newX = startXPos;
    let newY = startYPos;
    
    // Handle each corner differently
    switch (currentHandle) {
      case 'se': // bottom-right
        newWidth = Math.max(30, startWidth + dx / scale);
        newHeight = Math.max(20, startHeight + dy / scale);
        break;
      case 'sw': // bottom-left
        newWidth = Math.max(30, startWidth - dx / scale);
        newHeight = Math.max(20, startHeight + dy / scale);
        newX = startXPos + (startWidth - newWidth);
        break;
      case 'ne': // top-right
        newWidth = Math.max(30, startWidth + dx / scale);
        newHeight = Math.max(20, startHeight - dy / scale);
        newY = startYPos + (startHeight - newHeight);
        break;
      case 'nw': // top-left
        newWidth = Math.max(30, startWidth - dx / scale);
        newHeight = Math.max(20, startHeight - dy / scale);
        newX = startXPos + (startWidth - newWidth);
        newY = startYPos + (startHeight - newHeight);
        break;
    }
    
    // Maintain aspect ratio (use the larger change)
    const widthChange = Math.abs(newWidth - startWidth);
    const heightChange = Math.abs(newHeight - startHeight);
    const aspectRatio = startWidth / startHeight;
    
    if (widthChange > heightChange) {
      newHeight = newWidth / aspectRatio;
    } else {
      newWidth = newHeight * aspectRatio;
    }
    
    // Recalculate position if needed
    if (currentHandle === 'nw' || currentHandle === 'sw') {
      newX = startXPos + (startWidth - newWidth);
    }
    if (currentHandle === 'nw' || currentHandle === 'ne') {
      newY = startYPos + (startHeight - newHeight);
    }
    
    el.width = newWidth;
    el.height = newHeight;
    el.x = newX;
    el.y = newY;
    
    // For text: auto-calculate font size based on container height
    if (el.type === 'text') {
      el.size = Math.max(8, Math.min(96, newHeight * 0.8));
      const textSpan = div.querySelector('.pdf-element-text-content');
      if (textSpan) {
        textSpan.style.fontSize = (el.size * scale) + 'px';
      }
    }
    
    // Update DOM - container size and position
    div.style.width = (newWidth * scale) + 'px';
    div.style.height = (newHeight * scale) + 'px';
    div.style.left = (newX * scale) + 'px';
    div.style.top = (newY * scale) + 'px';
    
    // For images: update img size
    if (el.type === 'image' || el.type === 'signature') {
      const img = div.querySelector('img');
      if (img) {
        img.style.width = (newWidth * scale) + 'px';
        img.style.height = (newHeight * scale) + 'px';
      }
    }
  });
  
  document.addEventListener('mouseup', () => {
    if (!isResizing) return;
    isResizing = false;
    div.classList.remove('resizing');
    div.classList.remove('selected');
    
    // For text, update the stored font size
    if (el.type === 'text') {
      showStatus('Texto redimensionado - Tamaño letra: ' + Math.round(el.size) + 'px', 'success');
    } else {
      showStatus('Tamaño actualizado', 'success');
    }
  });
}

function navigatePage(delta) {
  const newPage = currentPage + delta;
  if (newPage >= 1 && newPage <= totalPages) {
    currentPage = newPage;
    renderPage();
  }
}

function changeZoom(delta) {
  zoom = Math.max(0.25, Math.min(2.5, zoom + delta));
  $('zoomLevel').textContent = Math.round(zoom * 100) + '%';
  renderPage();
}

function showTextModal() {
  if (!pdfJsDoc) {
    showStatus('Primero carga un PDF', 'error');
    return;
  }
  $('textInput').value = '';
  $('textSize').value = 14;
  $('textColor').value = '#000000';
  $('textModal').classList.add('show');
  $('textInput').focus();
}

function confirmText() {
  const text = $('textInput').value.trim();
  const size = parseInt($('textSize').value) || 14;
  const color = $('textColor').value;
  
  if (!text) {
    showStatus('Escribe un texto', 'error');
    return;
  }
  
  // Calculate initial width and height based on text and font size
  const textWidth = Math.max(30, text.length * size * 0.6);
  const textHeight = Math.max(20, size * 1.4);
  
  elements[currentPage].push({
    type: 'text',
    text: text,
    x: pageWidth / 2 - textWidth / 2,
    y: pageHeight / 2 - textHeight / 2,
    width: textWidth,
    height: textHeight,
    size: size,
    color: color
  });
  
  $('textModal').classList.remove('show');
  renderPage();
  showStatus('Texto añadido - arrastra las esquinas para cambiar tamaño', 'success');
}

function addImage() {
  if (!pdfJsDoc) {
    showStatus('Primero carga un PDF', 'error');
    return;
  }
  
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        let imgWidth = img.width;
        let imgHeight = img.height;
        const maxSize = 150;
        
        if (imgWidth > maxSize || imgHeight > maxSize) {
          const ratio = Math.min(maxSize / imgWidth, maxSize / imgHeight);
          imgWidth = Math.round(imgWidth * ratio);
          imgHeight = Math.round(imgHeight * ratio);
        }
        
        elements[currentPage].push({
          type: 'image',
          src: ev.target.result,
          x: pageWidth / 2 - imgWidth / 2,
          y: pageHeight / 2 - imgHeight / 2,
          width: imgWidth,
          height: imgHeight
        });
        
        renderPage();
        showStatus('Imagen añadida - arrastra las esquinas para cambiar tamaño', 'success');
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

function showSignatureModal() {
  if (!pdfJsDoc) {
    showStatus('Primero carga un PDF', 'error');
    return;
  }
  $('signatureSearchInput').value = '';
  $('signatureResults').innerHTML = '<div class="signature-empty">Escribe uno o más nombres (uno por línea)</div>';
  $('signatureModal').classList.add('show');
  $('signatureSearchInput').focus();
}

async function searchSignatures() {
  const searchInput = $('signatureSearchInput').value.trim();
  
  if (!searchInput) {
    $('signatureResults').innerHTML = '<div class="signature-empty">Escribe un nombre para buscar</div>';
    return;
  }
  
  // Split by newlines to support multiple names
  const searchTerms = searchInput.split('\n')
    .map(term => term.trim().toLowerCase())
    .filter(term => term.length > 0);
  
  if (searchTerms.length === 0) {
    $('signatureResults').innerHTML = '<div class="signature-empty">Escribe un nombre para buscar</div>';
    return;
  }
  
  $('signatureResults').innerHTML = '<div class="signature-loading">Buscando ' + searchTerms.length + ' nombre(s)...</div>';
  
  try {
    let allSignatures = [];
    
    // Search for each term
    for (const term of searchTerms) {
      const query = `?select=*&name=ilike.*${encodeURIComponent(term)}*&order=name.asc`;
      const url = `${SUPABASE_URL}/rest/v1/signatures${query}`;
      
      const res = await fetch(url, {
        headers: { 'apikey': SUPABASE_KEY }
      });
      
      if (res.ok) {
        const signatures = await res.json();
        if (signatures && signatures.length > 0) {
          // Add to results, avoiding duplicates by id
          signatures.forEach(sig => {
            if (!allSignatures.find(s => s.id === sig.id)) {
              allSignatures.push(sig);
            }
          });
        }
      }
    }
    
    // Sort alphabetically
    allSignatures.sort((a, b) => a.name.localeCompare(b.name));
    
    if (allSignatures.length > 0) {
      let html = `<div class="signature-count">${allSignatures.length} firma(s) encontrada(s)</div>`;
      allSignatures.forEach(sig => {
        html += `<div class="signature-item" data-url="${sig.image_url}" data-name="${escapeHtml(sig.name)}">
          <span>${escapeHtml(sig.name)}</span>
          <span class="signature-add-icon">+</span>
        </div>`;
      });
      $('signatureResults').innerHTML = html;
      
      document.querySelectorAll('.signature-item').forEach(item => {
        item.addEventListener('click', () => selectSignature(item.dataset.url, item.dataset.name));
      });
    } else {
      $('signatureResults').innerHTML = '<div class="signature-empty">No se encontraron firmas para los nombres proporcionados</div>';
    }
    
  } catch (err) {
    console.error('Search error:', err);
    $('signatureResults').innerHTML = '<div class="signature-empty">Error: ' + err.message + '</div>';
  }
}

function selectSignature(url, name) {
  const img = new Image();
  img.onload = () => {
    let imgWidth = img.width;
    let imgHeight = img.height;
    const maxSize = 100;
    
    if (imgWidth > maxSize || imgHeight > maxSize) {
      const ratio = Math.min(maxSize / imgWidth, maxSize / imgHeight);
      imgWidth = Math.round(imgWidth * ratio);
      imgHeight = Math.round(imgHeight * ratio);
    }
    
    elements[currentPage].push({
      type: 'signature',
      src: url,
      x: pageWidth / 2 - imgWidth / 2,
      y: pageHeight / 2 - imgHeight / 2,
      width: imgWidth,
      height: imgHeight,
      name: name
    });
    
    $('signatureModal').classList.remove('show');
    renderPage();
    showStatus('Firma añadida - arrastra las esquinas para cambiar tamaño', 'success');
  };
  img.onerror = () => showStatus('No se pudo cargar la firma', 'error');
  img.src = url;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function savePdf() {
  if (!originalPdfBytes) {
    showStatus('No hay PDF para guardar', 'error');
    return;
  }
  
  let totalElements = 0;
  for (let i = 1; i <= totalPages; i++) {
    totalElements += (elements[i] || []).length;
  }
  
  if (totalElements === 0) {
    showStatus('Añade algún elemento antes de guardar', 'error');
    return;
  }
  
  const btn = $('btnSave');
  btn.disabled = true;
  btn.textContent = 'Guardando...';
  
  try {
    const pdfLib = window.PDFLib;
    const { PDFDocument, rgb, StandardFonts } = pdfLib;
    
    const newPdfDoc = await PDFDocument.load(originalPdfBytes, { ignoreEncryption: true });
    const font = await newPdfDoc.embedFont(StandardFonts.Helvetica);
    
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      const page = newPdfDoc.getPage(pageNum - 1);
      const { width, height } = page.getSize();
      const pageElements = elements[pageNum] || [];
      
      for (const el of pageElements) {
        const pdfX = el.x;
        
        if (el.type === 'text') {
          const fontSize = el.size || 14;
          const pdfY = height - el.y - fontSize;
          const color = hexToRgb(el.color || '#000000');
          
          page.drawText(el.text, {
            x: pdfX,
            y: pdfY,
            size: fontSize,
            font: font,
            color: rgb(color.r / 255, color.g / 255, color.b / 255)
          });
        } else if (el.type === 'image' || el.type === 'signature') {
          try {
            let imageBytes;
            let isPng = false;
            
            if (el.src.startsWith('data:')) {
              const base64 = el.src.split(',')[1];
              imageBytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
              isPng = el.src.includes('image/png');
            } else {
              const res = await fetch(el.src);
              const blob = await res.blob();
              const arrayBuffer = await blob.arrayBuffer();
              imageBytes = new Uint8Array(arrayBuffer);
              isPng = el.src.includes('png') || blob.type === 'image/png';
            }
            
            let image;
            if (isPng) {
              image = await newPdfDoc.embedPng(imageBytes);
            } else {
              image = await newPdfDoc.embedJpg(imageBytes);
            }
            
            const pdfY = height - el.y - el.height;
            
            page.drawImage(image, {
              x: pdfX,
              y: pdfY,
              width: el.width,
              height: el.height
            });
          } catch (imgErr) {
            console.error('Error embedding image:', imgErr);
          }
        }
      }
    }
    
    const pdfBytesResult = await newPdfDoc.save();
    const blob = new Blob([pdfBytesResult], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = 'documento-editado.pdf';
    link.click();
    
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    
    showStatus('PDF guardado correctamente', 'success');
    
    for (let i = 1; i <= totalPages; i++) {
      elements[i] = [];
    }
    renderPage();
    
  } catch (err) {
    console.error('Save error:', err);
    showStatus('Error al guardar: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg> Guardar PDF`;
  }
}

function clearEditor() {
  if (pdfJsDoc && !confirm('¿Seguro que quieres limpiar el editor?')) return;
  
  pdfJsDoc = null;
  pdfDoc = null;
  pdfBytes = null;
  originalPdfBytes = null;
  currentPage = 1;
  totalPages = 0;
  elements = {};
  zoom = 1;
  pageWidth = 0;
  pageHeight = 0;
  
  $('canvasArea').innerHTML = `
    <div class="upload-wrapper" id="uploadWrapper">
      <input type="file" class="file-input-overlay" id="fileInput" accept=".pdf">
      <div class="upload-area" id="uploadArea">
        <div class="upload-icon">📄</div>
        <div class="upload-text">Arrastra un PDF aquí o haz clic para seleccionar</div>
        <div class="upload-hint">Soporta archivos .pdf</div>
      </div>
    </div>
  `;
  
  $('btnSave').disabled = true;
  $('pageNav').style.display = 'none';
  $('zoomControls').style.display = 'none';
  
  // Re-setup event listeners
  const fileInput = $('fileInput');
  const uploadArea = $('uploadArea');
  const uploadWrapper = $('uploadWrapper');
  
  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      loadPdf(e.target.files[0]);
    }
  });
  
  uploadWrapper.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadArea.classList.add('drag-over');
  });
  
  uploadWrapper.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadArea.classList.remove('drag-over');
  });
  
  uploadWrapper.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadArea.classList.remove('drag-over');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      loadPdf(e.dataTransfer.files[0]);
    }
  });
  
  showStatus('Editor limpiado');
}

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 0, g: 0, b: 0 };
}
