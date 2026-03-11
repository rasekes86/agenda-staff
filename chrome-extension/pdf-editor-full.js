// ============================================
// PDF EDITOR FULL SCREEN - AGENDA STAFF v5.18.1
// ============================================

const SUPABASE_URL = 'https://iugutcsukxkxlgpkmzxt.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1Z3V0Y3N1a3hreGxncGttenh0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzc5OTExMjksImV4cCI6MjA1MzU2NzEyOX0.PpolAzqqXNBOhRlUVzplqkKeGQxzfed4gH377CidVJE';

// Main PDF state (shared across tools)
let pdfJsDoc = null;
let pdfDoc = null;
let pdfBytes = null;
let originalPdfBytes = null;
let currentFileName = '';
let currentPage = 1;
let totalPages = 0;
let elements = {};
let zoom = 1;
let selectedElement = null;
let pageWidth = 0;
let pageHeight = 0;

// State for tools that create NEW PDFs
let imgFiles = [];
let wordFiles = [];
let mergeFiles = [];
let currentTool = 'editor';

// State for multiple signatures
let addedSignaturesCount = 0;

// Session for authentication
let session = null;
let currentUser = null;

// Helper function like jQuery
const $ = id => document.getElementById(id);

// Show status message
function showStatus(msg, type = '') {
  const el = $('statusMsg');
  el.textContent = msg;
  el.className = 'status-msg show ' + type;
  setTimeout(() => el.classList.remove('show'), 3000);
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  console.log('PDF Editor initializing...');
  
  // Load session and user from chrome.storage for authentication
  try {
    const stored = await chrome.storage.local.get(['session', 'user']);
    session = stored.session;
    currentUser = stored.user;
    console.log('Session loaded:', session ? 'yes' : 'no');
    console.log('User loaded:', currentUser ? currentUser.name : 'no');
  } catch (err) {
    console.error('Error loading session:', err);
  }
  
  // Configure pdf.js worker
  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdf.worker.min.js';
  }
  
  setupEventListeners();
  setupToolTabs();
  setupImgToPdf();
  setupWordToPdf();
  setupMerge();
  setupSplit();
  
  showStatus('Carga un PDF para comenzar');
});

function setupEventListeners() {
  const fileInput = $('fileInput');
  const uploadArea = $('uploadArea');
  const uploadWrapper = $('uploadWrapper');
  
  // File input change
  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      loadPdf(e.target.files[0]);
    }
  });
  
  // Drag and drop
  uploadWrapper.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('drag-over');
  });
  
  uploadWrapper.addEventListener('dragleave', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
  });
  
  uploadWrapper.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      loadPdf(e.dataTransfer.files[0]);
    }
  });
  
  // Upload button in header
  $('btnUpload').addEventListener('click', () => fileInput.click());
  
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
  $('btnAddDate').addEventListener('click', addCurrentDate);
  
  // Text modal
  $('cancelText').addEventListener('click', () => {
    $('textModal').classList.remove('show');
    delete $('textModal').dataset.posX;
    delete $('textModal').dataset.posY;
  });
  $('confirmText').addEventListener('click', confirmTextWithPosition);
  
  // Signature modal
  $('closeSignatureModal').addEventListener('click', () => {
    $('signatureModal').classList.remove('show');
    if (addedSignaturesCount > 0) {
      showStatus(`${addedSignaturesCount} firma(s) añadida(s) al documento`, 'success');
    }
  });
  $('btnSearchSignature').addEventListener('click', searchSignatures);
  $('signatureSearchInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') searchSignatures();
  });
}

// Tool tabs switching
function setupToolTabs() {
  const tabs = document.querySelectorAll('.tool-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tool = tab.dataset.tool;
      
      // Update tabs
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      // Update content
      document.querySelectorAll('.tool-content').forEach(c => c.classList.remove('active'));
      document.getElementById('tool' + tool.charAt(0).toUpperCase() + tool.slice(1)).classList.add('active');
      
      currentTool = tool;
      
      // Show/hide header controls based on tool
      const isEditor = tool === 'editor';
      $('pageNav').style.display = isEditor && pdfJsDoc ? 'flex' : 'none';
      $('zoomControls').style.display = isEditor && pdfJsDoc ? 'flex' : 'none';
      $('btnSave').style.display = isEditor ? 'flex' : 'none';
      
      // Update split tool if that tab is selected
      if (tool === 'split') {
        updateSplitTool();
      }
    });
  });
}

// ============================================
// MAIN PDF LOADING
// ============================================

async function loadPdf(file) {
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
    currentFileName = file.name;
    
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
    
    // Update UI
    $('uploadWrapper').style.display = 'none';
    $('btnSave').disabled = false;
    $('pageNav').style.display = 'flex';
    $('zoomControls').style.display = 'flex';
    $('fileName').style.display = 'inline';
    $('fileName').textContent = file.name + ' (' + totalPages + ' pág.)';
    zoom = 1;
    $('zoomLevel').textContent = '100%';
    
    // Update split tool
    updateSplitTool();
    
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
    
    // Setup double-click listener on CONTAINER (not overlay)
    // This ensures double-click works even when clicking on empty areas
    container.addEventListener('dblclick', (e) => {
      // Only handle clicks on the container or overlay, not on elements
      if (e.target.classList.contains('pdf-element') || 
          e.target.closest('.pdf-element')) {
        return;
      }
      
      if (!pdfJsDoc) return;
      
      const rect = overlay.getBoundingClientRect();
      const x = (e.clientX - rect.left) / scale;
      const y = (e.clientY - rect.top) / scale;
      
      // Show text modal with position stored
      $('textInput').value = '';
      $('textSize').value = 14;
      $('textColor').value = '#000000';
      $('textModal').classList.add('show');
      $('textInput').focus();
      
      // Store position for later use
      $('textModal').dataset.posX = x;
      $('textModal').dataset.posY = y;
    });
    
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
    div.textContent = el.text;
    div.style.fontSize = ((el.size || 14) * scale) + 'px';
    div.style.color = el.color || '#000';
    div.style.minWidth = '20px';
    div.style.minHeight = '20px';
  } else if (el.type === 'image' || el.type === 'signature') {
    const img = document.createElement('img');
    img.src = el.src;
    img.style.width = (el.width * scale) + 'px';
    img.style.height = (el.height * scale) + 'px';
    img.draggable = false;
    div.appendChild(img);
    div.style.background = 'transparent';
    
    // Add name label for signatures
    if (el.type === 'signature' && el.name) {
      const nameLabel = document.createElement('div');
      nameLabel.className = 'signature-name-label';
      nameLabel.textContent = el.name;
      div.appendChild(nameLabel);
    }
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
  
  // Resize handles
  const handles = ['nw', 'ne', 'sw', 'se'];
  handles.forEach(pos => {
    const handle = document.createElement('div');
    handle.className = `resize-handle resize-handle-${pos}`;
    handle.dataset.handle = pos;
    div.appendChild(handle);
  });
  
  makeDraggable(div, el, scale);
  makeResizable(div, el, scale);
  
  return div;
}

// Confirm text with stored position
function confirmTextWithPosition() {
  const text = $('textInput').value.trim();
  const size = parseInt($('textSize').value) || 14;
  const color = $('textColor').value;
  
  if (!text) {
    showStatus('Escribe un texto', 'error');
    return;
  }
  
  const modal = $('textModal');
  const posX = modal.dataset.posX ? parseFloat(modal.dataset.posX) : pageWidth / 2 - 50;
  const posY = modal.dataset.posY ? parseFloat(modal.dataset.posY) : pageHeight / 2;
  
  elements[currentPage].push({
    type: 'text',
    text: text,
    x: posX,
    y: posY,
    size: size,
    color: color
  });
  
  // Clear stored position
  delete modal.dataset.posX;
  delete modal.dataset.posY;
  
  $('textModal').classList.remove('show');
  renderPage();
  showStatus('Texto añadido', 'success');
}

// Add current date as text element
function addCurrentDate() {
  if (!pdfJsDoc) {
    showStatus('Primero carga un PDF', 'error');
    return;
  }
  
  const today = new Date();
  const day = String(today.getDate()).padStart(2, '0');
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const year = today.getFullYear();
  const dateStr = `${day}/${month}/${year}`;
  
  elements[currentPage].push({
    type: 'text',
    text: dateStr,
    x: pageWidth / 2 - 40,
    y: pageHeight / 2,
    size: 14,
    color: '#000000'
  });
  
  renderPage();
  showStatus(`Fecha añadida: ${dateStr}`, 'success');
}

function makeDraggable(div, el, scale) {
  let isDragging = false;
  let startX, startY, origX, origY;
  
  div.addEventListener('mousedown', (e) => {
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
    e.stopPropagation();
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
  let startX, startY, startWidth, startHeight, startFontSize, startXPos, startYPos;
  
  handles.forEach(handle => {
    handle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      isResizing = true;
      currentHandle = handle.dataset.handle;
      startX = e.clientX;
      startY = e.clientY;
      
      if (el.type === 'text') {
        startFontSize = el.size || 14;
        const rect = div.getBoundingClientRect();
        startWidth = rect.width / scale;
        startHeight = rect.height / scale;
      } else {
        startWidth = el.width;
        startHeight = el.height;
      }
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
    
    if (el.type === 'text') {
      const delta = Math.max(Math.abs(dx), Math.abs(dy));
      const scaleFactor = 1 + (dx > 0 ? delta / 200 : -delta / 200);
      let newFontSize = Math.max(8, Math.min(72, startFontSize * scaleFactor));
      el.size = newFontSize;
      div.style.fontSize = (newFontSize * scale) + 'px';
    } else {
      let newWidth = startWidth;
      let newHeight = startHeight;
      let newX = startXPos;
      let newY = startYPos;
      
      switch (currentHandle) {
        case 'se':
          newWidth = Math.max(20, startWidth + dx / scale);
          newHeight = Math.max(20, startHeight + dy / scale);
          break;
        case 'sw':
          newWidth = Math.max(20, startWidth - dx / scale);
          newHeight = Math.max(20, startHeight + dy / scale);
          newX = startXPos + (startWidth - newWidth);
          break;
        case 'ne':
          newWidth = Math.max(20, startWidth + dx / scale);
          newHeight = Math.max(20, startHeight - dy / scale);
          newY = startYPos + (startHeight - newHeight);
          break;
        case 'nw':
          newWidth = Math.max(20, startWidth - dx / scale);
          newHeight = Math.max(20, startHeight - dy / scale);
          newX = startXPos + (startWidth - newWidth);
          newY = startYPos + (startHeight - newHeight);
          break;
      }
      
      const aspectRatio = startWidth / startHeight;
      if (Math.abs(dx) > Math.abs(dy)) {
        newHeight = newWidth / aspectRatio;
      } else {
        newWidth = newHeight * aspectRatio;
      }
      
      el.width = newWidth;
      el.height = newHeight;
      el.x = newX;
      el.y = newY;
      
      const img = div.querySelector('img');
      if (img) {
        img.style.width = (newWidth * scale) + 'px';
        img.style.height = (newHeight * scale) + 'px';
      }
      div.style.left = (newX * scale) + 'px';
      div.style.top = (newY * scale) + 'px';
    }
  });
  
  document.addEventListener('mouseup', () => {
    if (!isResizing) return;
    isResizing = false;
    div.classList.remove('resizing');
    div.classList.remove('selected');
    showStatus('Tamaño actualizado', 'success');
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
  delete $('textModal').dataset.posX;
  delete $('textModal').dataset.posY;
  $('textModal').classList.add('show');
  $('textInput').focus();
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
        showStatus('Imagen añadida', 'success');
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
  
  // Reset counter for new session
  addedSignaturesCount = 0;
  $('signatureCount').style.display = 'none';
}

// Search signatures with missing names highlighted
async function searchSignatures() {
  const searchInput = $('signatureSearchInput').value.trim();
  
  if (!searchInput) {
    $('signatureResults').innerHTML = '<div class="signature-empty">Escribe un nombre para buscar</div>';
    return;
  }
  
  // Split only by newlines (Enter), NOT by commas - commas can be part of the name
  const searchTerms = searchInput.split('\n')
    .map(term => term.trim())
    .filter(term => term.length > 0);
  
  if (searchTerms.length === 0) return;
  
  // Store original search terms for upload feature
  $('signatureResults').dataset.searchTerms = JSON.stringify(searchTerms);
  
  $('signatureResults').innerHTML = '<div class="signature-loading">Buscando...</div>';
  
  try {
    let allSignatures = [];
    const foundNames = [];
    
    // Build headers with authorization if session exists
    const headers = {
      'apikey': SUPABASE_KEY
    };
    if (session && session.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }
    
    console.log('Searching signatures:', searchTerms);
    console.log('Session:', session ? 'exists' : 'null');
    console.log('Headers:', headers['Authorization'] ? 'with auth' : 'no auth');
    
    // Search for each term
    for (const term of searchTerms) {
      const query = `?select=*&name=ilike.*${encodeURIComponent(term)}*&order=name.asc`;
      const url = `${SUPABASE_URL}/rest/v1/signatures${query}`;
      
      console.log('Query URL:', url);
      
      const res = await fetch(url, { headers });
      
      console.log('Response status:', res.status);
      
      if (res.ok) {
        const signatures = await res.json();
        console.log('Found signatures for', term, ':', signatures);
        if (signatures && signatures.length > 0) {
          signatures.forEach(sig => {
            if (!allSignatures.find(s => s.id === sig.id)) {
              allSignatures.push(sig);
              foundNames.push(sig.name.toLowerCase());
            }
          });
        }
      } else {
        const errText = await res.text();
        console.error('Search error response:', errText);
      }
    }
    
    // Sort alphabetically
    allSignatures.sort((a, b) => a.name.localeCompare(b.name));
    
    console.log('Total found:', allSignatures.length, 'Missing:', searchTerms.length - foundNames.length);
    
    // Render with missing names highlighted
    renderSignatureResultsWithMissing(allSignatures, searchTerms, foundNames);
    
  } catch (err) {
    console.error('Search error:', err);
    $('signatureResults').innerHTML = '<div class="signature-empty">Error: ' + err.message + '</div>';
  }
}

// Render signatures with missing names in red
function renderSignatureResultsWithMissing(signatures, searchedTerms, foundNames) {
  // Determine which searched terms were NOT found
  const normalizedFoundNames = foundNames.map(n => n.toLowerCase());
  const missingNames = searchedTerms.filter(term => {
    // Normalize term to lowercase for comparison
    const normalizedTerm = term.toLowerCase();
    // Check if term matches any found name (partial match)
    return !normalizedFoundNames.some(found => found.includes(normalizedTerm) || normalizedTerm.includes(found));
  });
  
  let html = '';
  
  // Show found signatures in green
  if (signatures.length > 0) {
    html += `<div class="signature-found-header">✓ Encontradas (${signatures.length})</div>`;
    signatures.forEach(sig => {
      html += `<div class="signature-item signature-found" data-id="${sig.id}" data-url="${sig.image_url}" data-name="${escapeHtml(sig.name)}">
        <span class="signature-name">${escapeHtml(sig.name)}</span>
        <div class="signature-actions">
          <button class="signature-delete-btn" data-id="${sig.id}" data-name="${escapeHtml(sig.name)}" title="Eliminar firma">🗑️</button>
          <span class="signature-add-icon" title="Añadir al PDF">+</span>
        </div>
      </div>`;
    });
  }
  
  // Show missing names in red with upload option
  if (missingNames.length > 0) {
    html += `<div class="signature-missing-header">⚠ No encontradas (${missingNames.length})</div>`;
    missingNames.forEach(name => {
      html += `<div class="signature-item signature-missing">
        <span class="signature-missing-name">${escapeHtml(name)}</span>
        <button class="signature-upload-btn" data-name="${escapeHtml(name)}">📤 Subir</button>
      </div>`;
    });
  }
  
  $('signatureResults').innerHTML = html;
  
  // Add click handlers for found signatures (click on name or + icon)
  document.querySelectorAll('.signature-item.signature-found').forEach(item => {
    item.addEventListener('click', (e) => {
      // Don't trigger if clicking delete button
      if (e.target.classList.contains('signature-delete-btn')) return;
      selectSignature(item.dataset.url, item.dataset.name);
    });
  });
  
  // Add click handlers for delete buttons
  document.querySelectorAll('.signature-delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm('¿Eliminar la firma de "' + btn.dataset.name + '"?')) {
        deleteSignature(btn.dataset.id, btn.dataset.name);
      }
    });
  });
  
  // Add click handlers for missing signatures upload button
  document.querySelectorAll('.signature-upload-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      uploadMissingSignature(btn.dataset.name);
    });
  });
}

// Delete a signature from database
async function deleteSignature(id, name) {
  try {
    const headers = {
      'apikey': SUPABASE_KEY
    };
    if (session && session.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }
    
    const response = await fetch(`${SUPABASE_URL}/rest/v1/signatures?id=eq.${id}`, {
      method: 'DELETE',
      headers
    });
    
    if (!response.ok) {
      const errText = await response.text();
      console.error('Delete error:', errText);
      throw new Error('Error al eliminar: ' + response.status);
    }
    
    showStatus('✓ Firma eliminada: ' + name, 'success');
    
    // Re-run search to update results
    searchSignatures();
    
  } catch (err) {
    console.error('Delete error:', err);
    showStatus('Error: ' + err.message, 'error');
  }
}

// Upload a missing signature and re-run search
async function uploadMissingSignature(name) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    showStatus('Subiendo firma de ' + name + '...', '');
    
    try {
      // Convert to base64
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      
      // Build headers with authorization if session exists
      const headers = {
        'apikey': SUPABASE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      };
      if (session && session.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }
      
      // Generate ID
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
      
      // Build body with user info if available
      const bodyData = {
        id,
        name: name.toUpperCase(),
        image_url: base64
      };
      if (currentUser) {
        bodyData.user_id = currentUser.id;
        bodyData.user_name = currentUser.name;
      }
      
      console.log('Uploading signature:', bodyData.name, 'User:', bodyData.user_name || 'unknown');
      
      // Upload to Supabase
      const response = await fetch(`${SUPABASE_URL}/rest/v1/signatures`, {
        method: 'POST',
        headers,
        body: JSON.stringify(bodyData)
      });
      
      if (!response.ok) {
        const errText = await response.text();
        console.error('Upload error:', errText);
        throw new Error('Error al subir firma: ' + response.status + ' - ' + errText);
      }
      
      showStatus('✓ Firma subida: ' + name, 'success');
      
      // Re-run search to update results
      searchSignatures();
      
    } catch (err) {
      console.error('Upload error:', err);
      showStatus('Error: ' + err.message, 'error');
    }
  };
  
  input.click();
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
    
    // Offset each signature slightly so they don't overlap
    const offset = addedSignaturesCount * 15;
    
    elements[currentPage].push({
      type: 'signature',
      src: url,
      x: pageWidth / 2 - imgWidth / 2 + offset,
      y: pageHeight / 2 - imgHeight / 2 + offset,
      width: imgWidth,
      height: imgHeight,
      name: name
    });
    
    addedSignaturesCount++;
    
    // DON'T close modal - keep it open to add more signatures
    renderPage();
    showStatus(`✓ Firma añadida: ${name}`, 'success');
    
    // Update the count in the modal
    const countEl = $('signatureCount');
    countEl.style.display = 'block';
    countEl.textContent = `${addedSignaturesCount} firma(s) añadida(s) - continúa añadiendo`;
    countEl.style.background = '#10b981';
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
  
  const btn = $('btnSave');
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-loader"></span>';
  
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
    link.download = currentFileName || 'documento-editado.pdf';
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
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg> Guardar`;
  }
}

function clearEditor() {
  if (pdfJsDoc && !confirm('¿Seguro que quieres limpiar el editor?')) return;
  
  pdfJsDoc = null;
  pdfDoc = null;
  pdfBytes = null;
  originalPdfBytes = null;
  currentFileName = '';
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
        <div class="upload-hint">Una vez cargado, podrás editarlo, separarlo o guardarlo</div>
      </div>
    </div>
  `;
  
  $('btnSave').disabled = true;
  $('pageNav').style.display = 'none';
  $('zoomControls').style.display = 'none';
  $('fileName').style.display = 'none';
  
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
    uploadArea.classList.add('drag-over');
  });
  
  uploadWrapper.addEventListener('dragleave', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
  });
  
  uploadWrapper.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      loadPdf(e.dataTransfer.files[0]);
    }
  });
  
  // Update split tool
  updateSplitTool();
  
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

// ============================================
// SPLIT PDF - Works on loaded PDF
// ============================================

function setupSplit() {
  // Split mode radio buttons
  document.querySelectorAll('input[name="splitMode"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const mode = radio.value;
      $('splitBlocksConfig').style.display = mode === 'blocks' ? 'block' : 'none';
      $('splitRangesConfig').style.display = mode === 'ranges' ? 'block' : 'none';
      updateSplitPreview();
    });
  });
  
  $('splitBlockSize').addEventListener('input', updateSplitPreview);
  $('splitRangesInput').addEventListener('input', updateSplitPreview);
  
  $('btnSplitPdf').addEventListener('click', splitPdf);
}

function updateSplitTool() {
  const hasPdf = pdfJsDoc && totalPages > 0;
  
  $('splitNoPdf').style.display = hasPdf ? 'none' : 'block';
  $('splitPdfInfo').style.display = hasPdf ? 'flex' : 'none';
  $('splitOptions').style.display = hasPdf ? 'block' : 'none';
  $('btnSplitPdf').disabled = !hasPdf;
  
  if (hasPdf) {
    $('splitPdfName').textContent = currentFileName;
    $('splitPdfPages').textContent = totalPages + ' pág.';
    updateSplitPreview();
  }
}

function updateSplitPreview() {
  const preview = $('splitPreview');
  if (!preview || totalPages === 0) return;
  
  const mode = document.querySelector('input[name="splitMode"]:checked').value;
  let html = '<div class="preview-title">Resultado:</div>';
  
  if (mode === 'single') {
    html += `<span class="preview-badge">${totalPages} PDFs (1 pág. cada uno)</span>`;
  } else if (mode === 'blocks') {
    const blockSize = parseInt($('splitBlockSize').value) || 2;
    const count = Math.ceil(totalPages / blockSize);
    html += `<span class="preview-badge">${count} PDFs (${blockSize} pág. c/u)</span>`;
  } else if (mode === 'ranges') {
    const rangesText = $('splitRangesInput').value.trim();
    if (rangesText) {
      const lines = rangesText.split('\n').filter(l => l.trim());
      html += `<span class="preview-badge">${lines.length} PDFs</span>`;
    } else {
      html += '<span class="preview-warning">Introduce los rangos</span>';
    }
  }
  
  preview.innerHTML = html;
}

async function splitPdf() {
  if (!pdfJsDoc || totalPages === 0) {
    showStatus('Primero carga un PDF', 'error');
    return;
  }
  
  const btn = $('btnSplitPdf');
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-loader"></span> Separando...';
  
  try {
    const pdfLib = window.PDFLib;
    const { PDFDocument } = pdfLib;
    
    const pdfDoc = await PDFDocument.load(originalPdfBytes);
    const mode = document.querySelector('input[name="splitMode"]:checked').value;
    
    let ranges = [];
    
    if (mode === 'single') {
      for (let i = 0; i < totalPages; i++) {
        ranges.push({ start: i, end: i, label: `Página_${i + 1}` });
      }
    } else if (mode === 'blocks') {
      const blockSize = parseInt($('splitBlockSize').value) || 1;
      for (let i = 0; i < totalPages; i += blockSize) {
        const start = i;
        const end = Math.min(i + blockSize - 1, totalPages - 1);
        ranges.push({ start, end, label: `Páginas_${start + 1}-${end + 1}` });
      }
    } else if (mode === 'ranges') {
      const rangesText = $('splitRangesInput').value.trim();
      const lines = rangesText.split('\n').filter(l => l.trim());
      
      for (const line of lines) {
        const match = line.match(/(\d+)\s*-\s*(\d+)/);
        if (match) {
          const start = parseInt(match[1]) - 1;
          const end = parseInt(match[2]) - 1;
          
          if (start < 0 || end >= totalPages || start > end) {
            throw new Error(`Rango inválido: ${line}`);
          }
          
          ranges.push({ start, end, label: `Páginas_${start + 1}-${end + 1}` });
        }
      }
    }
    
    showStatus(`Creando ${ranges.length} PDFs...`);
    
    const baseName = currentFileName.replace('.pdf', '');
    
    for (const range of ranges) {
      const newPdf = await PDFDocument.create();
      const pageIndices = [];
      for (let p = range.start; p <= range.end; p++) {
        pageIndices.push(p);
      }
      const pages = await newPdf.copyPages(pdfDoc, pageIndices);
      pages.forEach(page => newPdf.addPage(page));
      
      const pdfBytes = await newPdf.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `${baseName}_${range.label}.pdf`;
      a.click();
      
      URL.revokeObjectURL(url);
      await new Promise(r => setTimeout(r, 100));
    }
    
    showStatus(`${ranges.length} PDFs creados`, 'success');
    
  } catch (err) {
    console.error('Error splitting PDF:', err);
    showStatus('Error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Separar PDF';
  }
}

// ============================================
// IMAGE TO PDF - Creates NEW PDF
// ============================================

function setupImgToPdf() {
  const dropzone = $('imgDropzone');
  const fileInput = $('imgFileInput');
  
  dropzone.addEventListener('click', () => fileInput.click());
  
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('drag-over');
  });
  
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
  
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    handleImgFiles(e.dataTransfer.files);
  });
  
  fileInput.addEventListener('change', (e) => handleImgFiles(e.target.files));
  
  document.querySelectorAll('#toolImgToPdf .option-btn[data-orientation]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#toolImgToPdf .option-btn[data-orientation]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
  
  $('btnConvertImg').addEventListener('click', convertImagesToPdf);
}

function handleImgFiles(files) {
  const validFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
  imgFiles = [...imgFiles, ...validFiles];
  renderImgPreview();
}

function renderImgPreview() {
  const list = $('imgPreviewList');
  list.innerHTML = '';
  
  imgFiles.forEach((file, idx) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const item = document.createElement('div');
      item.className = 'preview-item';
      item.innerHTML = `
        <img src="${e.target.result}" alt="">
        <span class="name">${file.name}</span>
        <button class="remove-btn" data-idx="${idx}">✕</button>
      `;
      list.appendChild(item);
      
      item.querySelector('.remove-btn').addEventListener('click', () => {
        imgFiles.splice(idx, 1);
        renderImgPreview();
      });
    };
    reader.readAsDataURL(file);
  });
}

async function convertImagesToPdf() {
  if (imgFiles.length === 0) {
    showStatus('Selecciona imágenes primero', 'error');
    return;
  }
  
  const btn = $('btnConvertImg');
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-loader"></span> Creando...';
  
  try {
    const { jsPDF } = window.jspdf;
    const orientation = document.querySelector('#toolImgToPdf .option-btn[data-orientation].active').dataset.orientation;
    const pageSize = $('pageSize').value;
    
    let pdfWidth, pdfHeight;
    switch (pageSize) {
      case 'letter': pdfWidth = 215.9; pdfHeight = 279.4; break;
      case 'legal': pdfWidth = 215.9; pdfHeight = 355.6; break;
      case 'a4': default: pdfWidth = 210; pdfHeight = 297; break;
    }
    
    const pdf = new jsPDF({
      orientation: orientation,
      unit: 'mm',
      format: pageSize === 'fit' ? [210, 297] : pageSize
    });
    
    for (let i = 0; i < imgFiles.length; i++) {
      const file = imgFiles[i];
      const dataUrl = await readFileAsDataURL(file);
      const img = await loadImage(dataUrl);
      
      let imgWidth, imgHeight, x, y;
      
      if (pageSize === 'fit') {
        imgWidth = img.width * 0.264583;
        imgHeight = img.height * 0.264583;
        pdf.internal.pageSize.setWidth(imgWidth);
        pdf.internal.pageSize.setHeight(imgHeight);
        x = 0;
        y = 0;
      } else {
        const ratio = Math.min((pdfWidth - 10) / img.width, (pdfHeight - 10) / img.height) * 0.264583;
        imgWidth = img.width * ratio;
        imgHeight = img.height * ratio;
        x = (pdfWidth - imgWidth) / 2;
        y = (pdfHeight - imgHeight) / 2;
      }
      
      if (i > 0) pdf.addPage();
      pdf.addImage(dataUrl, 'JPEG', x, y, imgWidth, imgHeight);
    }
    
    pdf.save('imagenes.pdf');
    showStatus(`${imgFiles.length} imagen(es) convertida(s)`, 'success');
    
    imgFiles = [];
    $('imgPreviewList').innerHTML = '';
    $('imgFileInput').value = '';
    
  } catch (err) {
    showStatus('Error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Crear PDF';
  }
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// ============================================
// WORD TO PDF - Creates NEW PDF
// ============================================

function setupWordToPdf() {
  const dropzone = $('wordDropzone');
  const fileInput = $('wordFileInput');
  
  dropzone.addEventListener('click', () => fileInput.click());
  
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('drag-over');
  });
  
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
  
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    handleWordFiles(e.dataTransfer.files);
  });
  
  fileInput.addEventListener('change', (e) => handleWordFiles(e.target.files));
  
  $('btnConvertWord').addEventListener('click', convertWordToPdf);
}

function handleWordFiles(files) {
  const validFiles = Array.from(files).filter(f => f.name.endsWith('.docx'));
  wordFiles = [...wordFiles, ...validFiles];
  renderWordPreview();
}

function renderWordPreview() {
  const list = $('wordPreviewList');
  list.innerHTML = '';
  
  wordFiles.forEach((file, idx) => {
    const item = document.createElement('div');
    item.className = 'preview-item';
    item.innerHTML = `
      <span class="name">📝 ${file.name}</span>
      <button class="remove-btn" data-idx="${idx}">✕</button>
    `;
    list.appendChild(item);
    
    item.querySelector('.remove-btn').addEventListener('click', () => {
      wordFiles.splice(idx, 1);
      renderWordPreview();
    });
  });
}

async function convertWordToPdf() {
  if (wordFiles.length === 0) {
    showStatus('Selecciona documentos Word primero', 'error');
    return;
  }
  
  const btn = $('btnConvertWord');
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-loader"></span> Convirtiendo...';
  
  try {
    const mammoth = window.mammoth;
    const { jsPDF } = window.jspdf;
    
    if (!mammoth) throw new Error('Mammoth library not loaded');
    
    for (const file of wordFiles) {
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      const text = result.value;
      
      const pdf = new jsPDF();
      const lines = pdf.splitTextToSize(text, 180);
      let y = 20;
      
      for (const line of lines) {
        if (y > 280) {
          pdf.addPage();
          y = 20;
        }
        pdf.text(line, 15, y);
        y += 7;
      }
      
      pdf.save(file.name.replace('.docx', '.pdf'));
    }
    
    showStatus(`${wordFiles.length} documento(s) convertido(s)`, 'success');
    
    wordFiles = [];
    $('wordPreviewList').innerHTML = '';
    $('wordFileInput').value = '';
    
  } catch (err) {
    showStatus('Error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Crear PDFs';
  }
}

// ============================================
// MERGE PDFs - Creates NEW PDF
// ============================================

function setupMerge() {
  const dropzone = $('mergeDropzone');
  const fileInput = $('mergeFileInput');
  
  dropzone.addEventListener('click', () => fileInput.click());
  
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('drag-over');
  });
  
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
  
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    handleMergeFiles(e.dataTransfer.files);
  });
  
  fileInput.addEventListener('change', (e) => handleMergeFiles(e.target.files));
  
  $('btnMergePdfs').addEventListener('click', mergePdfs);
}

function handleMergeFiles(files) {
  const validFiles = Array.from(files).filter(f => f.name.endsWith('.pdf'));
  mergeFiles = [...mergeFiles, ...validFiles];
  renderMergePreview();
}

function renderMergePreview() {
  const list = $('mergePreviewList');
  list.innerHTML = '';
  
  mergeFiles.forEach((file, idx) => {
    const item = document.createElement('div');
    item.className = 'preview-item';
    item.innerHTML = `
      <span class="name">📄 ${file.name}</span>
      <button class="remove-btn" data-idx="${idx}">✕</button>
    `;
    list.appendChild(item);
    
    item.querySelector('.remove-btn').addEventListener('click', () => {
      mergeFiles.splice(idx, 1);
      renderMergePreview();
    });
  });
}

async function mergePdfs() {
  if (mergeFiles.length < 2) {
    showStatus('Selecciona al menos 2 PDFs', 'error');
    return;
  }
  
  const btn = $('btnMergePdfs');
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-loader"></span> Juntando...';
  
  try {
    const pdfLib = window.PDFLib;
    const { PDFDocument } = pdfLib;
    
    const mergedPdf = await PDFDocument.create();
    
    for (const file of mergeFiles) {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await PDFDocument.load(new Uint8Array(arrayBuffer));
      const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
      pages.forEach(page => mergedPdf.addPage(page));
    }
    
    const pdfBytes = await mergedPdf.save();
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = 'documento-combinado.pdf';
    a.click();
    
    URL.revokeObjectURL(url);
    showStatus(`${mergeFiles.length} PDFs combinados`, 'success');
    
    mergeFiles = [];
    $('mergePreviewList').innerHTML = '';
    $('mergeFileInput').value = '';
    
  } catch (err) {
    showStatus('Error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Juntar PDFs';
  }
}
