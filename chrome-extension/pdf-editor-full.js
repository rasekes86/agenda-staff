// ============================================
// PDF EDITOR FULL SCREEN - AGENDA STAFF v5.22.1
// Multi-document support with tabs
// ============================================

const SUPABASE_URL = 'https://iugutcsukxkxlgpkmzxt.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1Z3V0Y3N1a3hreGxncGttenh0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzc5OTExMjksImV4cCI6MjA1MzU2NzEyOX0.PpolAzqqXNBOhRlUVzplqkKeGQxzfed4gH377CidVJE';

// Multi-document state
let documents = []; // Array of document objects
let activeDocIndex = -1; // Index of currently active document
let tabCounter = 0; // Counter for unique tab IDs

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

// Get active document (or null if none)
function getActiveDoc() {
  return activeDocIndex >= 0 && activeDocIndex < documents.length ? documents[activeDocIndex] : null;
}

// Create a new document state object
function createDocState(id) {
  return {
    id: id,
    pdfJsDoc: null,
    pdfDoc: null,
    pdfBytes: null,
    originalPdfBytes: null,
    fileName: '',
    currentPage: 1,
    totalPages: 0,
    elements: {},
    zoom: 1,
    pageWidth: 0,
    pageHeight: 0,
    hasChanges: false
  };
}

// Get/set properties on active document
const doc = {
  get pdfJsDoc() { return getActiveDoc()?.pdfJsDoc ?? null; },
  get pdfDoc() { return getActiveDoc()?.pdfDoc ?? null; },
  get pdfBytes() { return getActiveDoc()?.pdfBytes ?? null; },
  get originalPdfBytes() { return getActiveDoc()?.originalPdfBytes ?? null; },
  get fileName() { return getActiveDoc()?.fileName ?? ''; },
  get currentPage() { return getActiveDoc()?.currentPage ?? 1; },
  get totalPages() { return getActiveDoc()?.totalPages ?? 0; },
  get elements() { return getActiveDoc()?.elements ?? {}; },
  get zoom() { return getActiveDoc()?.zoom ?? 1; },
  get pageWidth() { return getActiveDoc()?.pageWidth ?? 0; },
  get pageHeight() { return getActiveDoc()?.pageHeight ?? 0; }
};

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
  setupMultiDocumentTabs();
  
  showStatus('Carga uno o más PDFs para comenzar');
});

function setupEventListeners() {
  const fileInput = $('fileInput');
  const uploadArea = $('uploadArea');
  const uploadWrapper = $('uploadWrapper');
  
  // File input change - handle multiple files
  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      handleMultipleFiles(files);
      e.target.value = ''; // Reset input
    }
  });
  
  // Drag and drop - handle multiple files
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
      const files = Array.from(e.dataTransfer.files).filter(f => f.name.toLowerCase().endsWith('.pdf'));
      handleMultipleFiles(files);
    }
  });
  
  // Upload button in header
  $('btnUpload').addEventListener('click', () => {
    const multiInput = $('multiFileInput');
    multiInput.click();
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

// ============================================
// MULTI-DOCUMENT TABS
// ============================================

function setupMultiDocumentTabs() {
  const addTabBtn = $('btnAddPdfTab');
  const multiInput = $('multiFileInput');
  
  addTabBtn.addEventListener('click', () => {
    multiInput.click();
  });
  
  multiInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      
      if (documents.length === 0) {
        // First file replaces the upload area
        loadPdf(files[0]);
        // Load remaining files as new tabs
        for (let i = 1; i < files.length; i++) {
          loadPdfAsNewTab(files[i]);
        }
      } else {
        // Load all files as new tabs
        files.forEach(file => loadPdfAsNewTab(file));
      }
    }
    e.target.value = ''; // Reset input
  });
}

function loadPdfAsNewTab(file, switchToIt = true) {
  if (!file.name.toLowerCase().endsWith('.pdf')) {
    showStatus('Solo se permiten archivos PDF', 'error');
    return;
  }
  
  const reader = new FileReader();
  reader.onload = async (e) => {
    const arrayBuffer = e.target.result;
    const pdfBytes = new Uint8Array(arrayBuffer);
    
    try {
      const pdfjsLib = window.pdfjsLib;
      const pdfLib = window.PDFLib;
      
      if (!pdfjsLib || !pdfLib) {
        showStatus('Error: Las librerías PDF no están cargadas', 'error');
        return;
      }
      
      const loadingTask = pdfjsLib.getDocument({ data: pdfBytes.slice() });
      const pdfJsDoc = await loadingTask.promise;
      const totalPages = pdfJsDoc.numPages;
      
      const { PDFDocument } = pdfLib;
      const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
      
      const page = pdfDoc.getPage(0);
      const { width, height } = page.getSize();
      
      // Create new document state
      const docId = 'doc_' + (++tabCounter);
      const newDoc = createDocState(docId);
      newDoc.pdfJsDoc = pdfJsDoc;
      newDoc.pdfDoc = pdfDoc;
      newDoc.pdfBytes = pdfBytes;
      newDoc.originalPdfBytes = new Uint8Array(arrayBuffer);
      newDoc.fileName = file.name;
      newDoc.totalPages = totalPages;
      newDoc.pageWidth = width;
      newDoc.pageHeight = height;
      
      for (let i = 1; i <= totalPages; i++) {
        newDoc.elements[i] = [];
      }
      
      // Add to documents array
      documents.push(newDoc);
      
      // Create tab
      createTab(newDoc);
      
      // Hide upload wrapper if visible
      const uploadWrapper = $('uploadWrapper');
      if (uploadWrapper) {
        uploadWrapper.style.display = 'none';
      }
      
      // Switch to new tab if requested (first file)
      if (switchToIt || documents.length === 1) {
        switchToTab(documents.length - 1);
      }
      
      showStatus(`${file.name} cargado (${totalPages} pág.)`, 'success');
      
    } catch (err) {
      console.error('Error loading PDF:', err);
      showStatus('Error al cargar: ' + file.name + ' - ' + err.message, 'error');
    }
  };
  
  reader.onerror = (err) => {
    console.error('FileReader error:', err);
    showStatus('Error leyendo archivo: ' + file.name, 'error');
  };
  
  reader.readAsArrayBuffer(file);
}

function createTab(doc) {
  const tabsList = $('documentTabsList');
  
  const tab = document.createElement('div');
  tab.className = 'doc-tab';
  tab.dataset.docId = doc.id;
  tab.innerHTML = `
    <span class="doc-tab-icon">📄</span>
    <span class="doc-tab-name">${doc.fileName}</span>
    <span class="doc-tab-pages">${doc.totalPages} pág.</span>
    <button class="doc-tab-close" title="Cerrar">×</button>
  `;
  
  tab.addEventListener('click', (e) => {
    if (!e.target.classList.contains('doc-tab-close')) {
      const idx = documents.findIndex(d => d.id === doc.id);
      if (idx >= 0) switchToTab(idx);
    }
  });
  
  tab.querySelector('.doc-tab-close').addEventListener('click', (e) => {
    e.stopPropagation();
    closeTab(doc.id);
  });
  
  tabsList.appendChild(tab);
}

function switchToTab(index) {
  if (index < 0 || index >= documents.length) return;
  
  activeDocIndex = index;
  const doc = documents[index];
  
  // Update tab UI
  document.querySelectorAll('.doc-tab').forEach((tab, i) => {
    tab.classList.toggle('active', i === index);
  });
  
  // Hide upload area
  $('uploadWrapper').style.display = 'none';
  
  // Update header
  $('pageNav').style.display = 'flex';
  $('zoomControls').style.display = 'flex';
  $('fileName').style.display = 'inline';
  $('fileName').textContent = doc.fileName + ' (' + doc.totalPages + ' pág.)';
  $('btnSave').disabled = false;
  
  // Update zoom
  $('zoomLevel').textContent = Math.round(doc.zoom * 100) + '%';
  
  // Update split tool
  updateSplitTool();
  
  // Render page
  renderPage();
}

function closeTab(docId) {
  const idx = documents.findIndex(d => d.id === docId);
  if (idx < 0) return;
  
  const doc = documents[idx];
  
  // Check for unsaved changes
  const hasElements = Object.values(doc.elements).some(arr => arr.length > 0);
  if (hasElements && !confirm(`¿Cerrar "${doc.fileName}" sin guardar los cambios?`)) {
    return;
  }
  
  // Remove from array
  documents.splice(idx, 1);
  
  // Remove tab
  const tab = document.querySelector(`.doc-tab[data-doc-id="${docId}"]`);
  if (tab) tab.remove();
  
  if (documents.length === 0) {
    // No documents left
    activeDocIndex = -1;
    showUploadArea();
  } else if (activeDocIndex >= documents.length) {
    // Active tab was removed, switch to last
    switchToTab(documents.length - 1);
  } else if (idx < activeDocIndex) {
    // Tab before active was removed, adjust index
    activeDocIndex--;
  } else {
    // Refresh current tab
    switchToTab(activeDocIndex);
  }
}

function showUploadArea() {
  $('canvasArea').innerHTML = `
    <div class="upload-wrapper" id="uploadWrapper">
      <input type="file" class="file-input-overlay" id="fileInput" accept=".pdf" multiple>
      <div class="upload-area" id="uploadArea">
        <div class="upload-icon">📄</div>
        <div class="upload-text">Arrastra PDFs aquí o haz clic para seleccionar</div>
        <div class="upload-hint">Puedes cargar varios PDFs a la vez</div>
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
      const files = Array.from(e.target.files);
      handleMultipleFiles(files);
      e.target.value = '';
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
      const files = Array.from(e.dataTransfer.files).filter(f => f.name.toLowerCase().endsWith('.pdf'));
      handleMultipleFiles(files);
    }
  });
}

function updateTabModified(docId, hasChanges) {
  const tab = document.querySelector(`.doc-tab[data-doc-id="${docId}"]`);
  if (!tab) return;
  
  const nameEl = tab.querySelector('.doc-tab-name');
  if (hasChanges && !nameEl.textContent.endsWith(' *')) {
    nameEl.textContent += ' *';
  } else if (!hasChanges && nameEl.textContent.endsWith(' *')) {
    nameEl.textContent = nameEl.textContent.slice(0, -2);
  }
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
      const activeDoc = getActiveDoc();
      $('pageNav').style.display = isEditor && activeDoc ? 'flex' : 'none';
      $('zoomControls').style.display = isEditor && activeDoc ? 'flex' : 'none';
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

// Handle multiple files at once
function handleMultipleFiles(files) {
  if (!files || files.length === 0) return;
  
  const pdfFiles = files.filter(f => f.name.toLowerCase().endsWith('.pdf'));
  
  if (pdfFiles.length === 0) {
    showStatus('No se encontraron archivos PDF', 'error');
    return;
  }
  
  showStatus(`Cargando ${pdfFiles.length} PDF${pdfFiles.length > 1 ? 's' : ''}...`);
  
  // Load all files as new tabs
  pdfFiles.forEach((file, index) => {
    setTimeout(() => {
      loadPdfAsNewTab(file, index === 0);
    }, index * 100); // Stagger loading slightly
  });
}

async function loadPdf(file) {
  // Now just redirects to the multi-file handler
  handleMultipleFiles([file]);
}

async function renderPage() {
  const activeDoc = getActiveDoc();
  if (!activeDoc || !activeDoc.pdfJsDoc) return;
  
  const canvasArea = $('canvasArea');
  canvasArea.innerHTML = '';
  
  try {
    const page = await activeDoc.pdfJsDoc.getPage(activeDoc.currentPage);
    const viewport = page.getViewport({ scale: 1 });
    
    const scale = activeDoc.zoom;
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
    
    const pageElements = activeDoc.elements[activeDoc.currentPage] || [];
    pageElements.forEach((el, idx) => {
      const elDiv = createElementDiv(el, idx, scale, activeDoc);
      overlay.appendChild(elDiv);
    });
    
    container.appendChild(overlay);
    canvasArea.appendChild(container);
    
    // Setup double-click listener on CONTAINER (not overlay)
    container.addEventListener('dblclick', (e) => {
      if (e.target.classList.contains('pdf-element') || 
          e.target.closest('.pdf-element')) {
        return;
      }
      
      if (!activeDoc.pdfJsDoc) return;
      
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
    
    $('currentPageNum').textContent = activeDoc.currentPage;
    $('totalPagesNum').textContent = activeDoc.totalPages;
    
    $('btnPrevPage').disabled = activeDoc.currentPage <= 1;
    $('btnNextPage').disabled = activeDoc.currentPage >= activeDoc.totalPages;
    
  } catch (err) {
    console.error('Error rendering page:', err);
  }
}

function createElementDiv(el, idx, scale, activeDoc) {
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
    activeDoc.elements[activeDoc.currentPage].splice(idx, 1);
    updateTabModified(activeDoc.id, true);
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
  
  makeDraggable(div, el, scale, activeDoc);
  makeResizable(div, el, scale, activeDoc);
  
  return div;
}

// Confirm text with stored position
function confirmTextWithPosition() {
  const activeDoc = getActiveDoc();
  if (!activeDoc) return;
  
  const text = $('textInput').value.trim();
  const size = parseInt($('textSize').value) || 14;
  const color = $('textColor').value;
  
  if (!text) {
    showStatus('Escribe un texto', 'error');
    return;
  }
  
  const modal = $('textModal');
  const posX = modal.dataset.posX ? parseFloat(modal.dataset.posX) : activeDoc.pageWidth / 2 - 50;
  const posY = modal.dataset.posY ? parseFloat(modal.dataset.posY) : activeDoc.pageHeight / 2;
  
  activeDoc.elements[activeDoc.currentPage].push({
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
  updateTabModified(activeDoc.id, true);
  renderPage();
  showStatus('Texto añadido', 'success');
}

// Add current date as text element
function addCurrentDate() {
  const activeDoc = getActiveDoc();
  if (!activeDoc || !activeDoc.pdfJsDoc) {
    showStatus('Primero carga un PDF', 'error');
    return;
  }
  
  const today = new Date();
  const day = String(today.getDate()).padStart(2, '0');
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const year = today.getFullYear();
  const dateStr = `${day}/${month}/${year}`;
  
  activeDoc.elements[activeDoc.currentPage].push({
    type: 'text',
    text: dateStr,
    x: activeDoc.pageWidth / 2 - 40,
    y: activeDoc.pageHeight / 2,
    size: 14,
    color: '#000000'
  });
  
  updateTabModified(activeDoc.id, true);
  renderPage();
  showStatus(`Fecha añadida: ${dateStr}`, 'success');
}

function makeDraggable(div, el, scale, activeDoc) {
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
    updateTabModified(activeDoc.id, true);
  });
}

function makeResizable(div, el, scale, activeDoc) {
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
    updateTabModified(activeDoc.id, true);
    showStatus('Tamaño actualizado', 'success');
  });
}

function navigatePage(delta) {
  const activeDoc = getActiveDoc();
  if (!activeDoc) return;
  
  const newPage = activeDoc.currentPage + delta;
  if (newPage >= 1 && newPage <= activeDoc.totalPages) {
    activeDoc.currentPage = newPage;
    renderPage();
  }
}

function changeZoom(delta) {
  const activeDoc = getActiveDoc();
  if (!activeDoc) return;
  
  activeDoc.zoom = Math.max(0.25, Math.min(2.5, activeDoc.zoom + delta));
  $('zoomLevel').textContent = Math.round(activeDoc.zoom * 100) + '%';
  renderPage();
}

function showTextModal() {
  const activeDoc = getActiveDoc();
  if (!activeDoc || !activeDoc.pdfJsDoc) {
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
  const activeDoc = getActiveDoc();
  if (!activeDoc || !activeDoc.pdfJsDoc) {
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
        
        activeDoc.elements[activeDoc.currentPage].push({
          type: 'image',
          src: ev.target.result,
          x: activeDoc.pageWidth / 2 - imgWidth / 2,
          y: activeDoc.pageHeight / 2 - imgHeight / 2,
          width: imgWidth,
          height: imgHeight
        });
        
        updateTabModified(activeDoc.id, true);
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
  const activeDoc = getActiveDoc();
  if (!activeDoc || !activeDoc.pdfJsDoc) {
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
  const activeDoc = getActiveDoc();
  if (!activeDoc) return;
  
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
    
    activeDoc.elements[activeDoc.currentPage].push({
      type: 'signature',
      src: url,
      x: activeDoc.pageWidth / 2 - imgWidth / 2 + offset,
      y: activeDoc.pageHeight / 2 - imgHeight / 2 + offset,
      width: imgWidth,
      height: imgHeight,
      name: name
    });
    
    addedSignaturesCount++;
    
    // DON'T close modal - keep it open to add more signatures
    updateTabModified(activeDoc.id, true);
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
  const activeDoc = getActiveDoc();
  if (!activeDoc || !activeDoc.originalPdfBytes) {
    showStatus('No hay PDF para guardar', 'error');
    return;
  }
  
  let totalElements = 0;
  for (let i = 1; i <= activeDoc.totalPages; i++) {
    totalElements += (activeDoc.elements[i] || []).length;
  }
  
  const btn = $('btnSave');
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-loader"></span>';
  
  try {
    const pdfLib = window.PDFLib;
    const { PDFDocument, rgb, StandardFonts } = pdfLib;
    
    const newPdfDoc = await PDFDocument.load(activeDoc.originalPdfBytes, { ignoreEncryption: true });
    const font = await newPdfDoc.embedFont(StandardFonts.Helvetica);
    
    for (let pageNum = 1; pageNum <= activeDoc.totalPages; pageNum++) {
      const page = newPdfDoc.getPage(pageNum - 1);
      const { width, height } = page.getSize();
      const pageElements = activeDoc.elements[pageNum] || [];
      
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
    link.download = activeDoc.fileName || 'documento-editado.pdf';
    link.click();
    
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    
    showStatus('PDF guardado correctamente', 'success');
    
    // Clear elements after save
    for (let i = 1; i <= activeDoc.totalPages; i++) {
      activeDoc.elements[i] = [];
    }
    updateTabModified(activeDoc.id, false);
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
  const activeDoc = getActiveDoc();
  
  if (documents.length === 0) return;
  
  if (activeDoc) {
    // Clear current document
    const hasElements = Object.values(activeDoc.elements).some(arr => arr.length > 0);
    if (hasElements && !confirm('¿Limpiar los cambios del documento actual?')) return;
    
    // Close current tab
    closeTab(activeDoc.id);
  }
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
  const activeDoc = getActiveDoc();
  const hasPdf = activeDoc && activeDoc.pdfJsDoc && activeDoc.totalPages > 0;
  
  $('splitNoPdf').style.display = hasPdf ? 'none' : 'block';
  $('splitPdfInfo').style.display = hasPdf ? 'flex' : 'none';
  $('splitOptions').style.display = hasPdf ? 'block' : 'none';
  $('btnSplitPdf').disabled = !hasPdf;
  
  if (hasPdf) {
    $('splitPdfName').textContent = activeDoc.fileName;
    $('splitPdfPages').textContent = activeDoc.totalPages + ' pág.';
    updateSplitPreview();
  }
}

function updateSplitPreview() {
  const activeDoc = getActiveDoc();
  const preview = $('splitPreview');
  if (!preview || !activeDoc || activeDoc.totalPages === 0) return;
  
  const mode = document.querySelector('input[name="splitMode"]:checked').value;
  let html = '<div class="preview-title">Resultado:</div>';
  
  if (mode === 'single') {
    html += `<span class="preview-badge">${activeDoc.totalPages} PDFs (1 pág. cada uno)</span>`;
  } else if (mode === 'blocks') {
    const blockSize = parseInt($('splitBlockSize').value) || 2;
    const count = Math.ceil(activeDoc.totalPages / blockSize);
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
  const activeDoc = getActiveDoc();
  if (!activeDoc || !activeDoc.pdfJsDoc || activeDoc.totalPages === 0) {
    showStatus('Primero carga un PDF', 'error');
    return;
  }
  
  const btn = $('btnSplitPdf');
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-loader"></span> Separando...';
  
  try {
    const pdfLib = window.PDFLib;
    const { PDFDocument } = pdfLib;
    
    const pdfDoc = await PDFDocument.load(activeDoc.originalPdfBytes);
    const mode = document.querySelector('input[name="splitMode"]:checked').value;
    
    const baseName = activeDoc.fileName.replace('.pdf', '').replace('.PDF', '');
    
    if (mode === 'single') {
      // Split into individual pages
      for (let i = 0; i < activeDoc.totalPages; i++) {
        const newPdf = await PDFDocument.create();
        const [copiedPage] = await newPdf.copyPages(pdfDoc, [i]);
        newPdf.addPage(copiedPage);
        
        const pdfBytes = await newPdf.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        
        const link = document.createElement('a');
        link.href = url;
        link.download = `${baseName}_p${i + 1}.pdf`;
        link.click();
        
        await new Promise(resolve => setTimeout(resolve, 300));
        URL.revokeObjectURL(url);
      }
      
      showStatus(`${activeDoc.totalPages} PDFs creados`, 'success');
      
    } else if (mode === 'blocks') {
      const blockSize = parseInt($('splitBlockSize').value) || 2;
      let blockNum = 1;
      
      for (let i = 0; i < activeDoc.totalPages; i += blockSize) {
        const newPdf = await PDFDocument.create();
        const endPage = Math.min(i + blockSize, activeDoc.totalPages);
        
        for (let j = i; j < endPage; j++) {
          const [copiedPage] = await newPdf.copyPages(pdfDoc, [j]);
          newPdf.addPage(copiedPage);
        }
        
        const pdfBytes = await newPdf.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        
        const link = document.createElement('a');
        link.href = url;
        link.download = `${baseName}_bloque${blockNum}.pdf`;
        link.click();
        
        await new Promise(resolve => setTimeout(resolve, 300));
        URL.revokeObjectURL(url);
        blockNum++;
      }
      
      showStatus(`${blockNum - 1} PDFs creados`, 'success');
      
    } else if (mode === 'ranges') {
      const rangesText = $('splitRangesInput').value.trim();
      const lines = rangesText.split('\n').filter(l => l.trim());
      let rangeNum = 1;
      
      for (const line of lines) {
        const match = line.match(/(\d+)-(\d+)/);
        if (match) {
          const start = parseInt(match[1]) - 1;
          const end = parseInt(match[2]);
          
          if (start >= 0 && end <= activeDoc.totalPages && start < end) {
            const newPdf = await PDFDocument.create();
            
            for (let i = start; i < end; i++) {
              const [copiedPage] = await newPdf.copyPages(pdfDoc, [i]);
              newPdf.addPage(copiedPage);
            }
            
            const pdfBytes = await newPdf.save();
            const blob = new Blob([pdfBytes], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            
            const link = document.createElement('a');
            link.href = url;
            link.download = `${baseName}_rango${rangeNum}.pdf`;
            link.click();
            
            await new Promise(resolve => setTimeout(resolve, 300));
            URL.revokeObjectURL(url);
            rangeNum++;
          }
        }
      }
      
      showStatus(`${rangeNum - 1} PDFs creados`, 'success');
    }
    
  } catch (err) {
    console.error('Split error:', err);
    showStatus('Error al separar: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Separar PDF';
  }
}

// ============================================
// IMAGE TO PDF
// ============================================

function setupImgToPdf() {
  const dropzone = $('imgDropzone');
  const fileInput = $('imgFileInput');
  
  dropzone.addEventListener('click', () => fileInput.click());
  
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('drag-over');
  });
  
  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('drag-over');
  });
  
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    handleImgFiles(e.dataTransfer.files);
  });
  
  fileInput.addEventListener('change', (e) => {
    handleImgFiles(e.target.files);
    fileInput.value = '';
  });
  
  // Orientation buttons
  document.querySelectorAll('[data-orientation]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-orientation]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
  
  $('btnConvertImg').addEventListener('click', convertImgToPdf);
}

function handleImgFiles(files) {
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    
    const reader = new FileReader();
    reader.onload = (e) => {
      imgFiles.push({
        name: file.name,
        src: e.target.result
      });
      renderImgPreview();
    };
    reader.readAsDataURL(file);
  }
}

function renderImgPreview() {
  const list = $('imgPreviewList');
  list.innerHTML = '';
  
  imgFiles.forEach((img, idx) => {
    const item = document.createElement('div');
    item.className = 'preview-item';
    item.innerHTML = `
      <img src="${img.src}" alt="">
      <span class="name">${img.name}</span>
      <button class="remove-btn" data-idx="${idx}">×</button>
    `;
    list.appendChild(item);
  });
  
  list.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      imgFiles.splice(parseInt(btn.dataset.idx), 1);
      renderImgPreview();
    });
  });
}

async function convertImgToPdf() {
  if (imgFiles.length === 0) {
    showStatus('Añade al menos una imagen', 'error');
    return;
  }
  
  const btn = $('btnConvertImg');
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-loader"></span> Creando...';
  
  try {
    const pdfLib = window.PDFLib;
    const { PDFDocument } = pdfLib;
    
    const pdfDoc = await PDFDocument.create();
    const orientation = document.querySelector('[data-orientation].active').dataset.orientation;
    const pageSize = $('pageSize').value;
    
    // Page sizes in points
    const sizes = {
      a4: { width: 595, height: 842 },
      letter: { width: 612, height: 792 },
      legal: { width: 612, height: 1008 }
    };
    
    for (const img of imgFiles) {
      const imageBytes = Uint8Array.from(atob(img.src.split(',')[1]), c => c.charCodeAt(0));
      const isPng = img.src.includes('image/png');
      
      let embeddedImg;
      if (isPng) {
        embeddedImg = await pdfDoc.embedPng(imageBytes);
      } else {
        embeddedImg = await pdfDoc.embedJpg(imageBytes);
      }
      
      let pageWidth, pageHeight;
      
      if (pageSize === 'fit') {
        pageWidth = embeddedImg.width;
        pageHeight = embeddedImg.height;
      } else {
        const size = sizes[pageSize];
        if (orientation === 'landscape') {
          pageWidth = size.height;
          pageHeight = size.width;
        } else {
          pageWidth = size.width;
          pageHeight = size.height;
        }
      }
      
      const page = pdfDoc.addPage([pageWidth, pageHeight]);
      
      // Scale image to fit page
      const scale = Math.min(
        pageWidth / embeddedImg.width,
        pageHeight / embeddedImg.height
      );
      
      const imgWidth = embeddedImg.width * scale;
      const imgHeight = embeddedImg.height * scale;
      
      const x = (pageWidth - imgWidth) / 2;
      const y = (pageHeight - imgHeight) / 2;
      
      page.drawImage(embeddedImg, {
        x, y,
        width: imgWidth,
        height: imgHeight
      });
    }
    
    const pdfBytes = await pdfDoc.save();
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = 'imagenes.pdf';
    link.click();
    
    URL.revokeObjectURL(url);
    
    imgFiles = [];
    renderImgPreview();
    showStatus('PDF creado', 'success');
    
  } catch (err) {
    console.error('Error converting:', err);
    showStatus('Error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Crear PDF';
  }
}

// ============================================
// WORD TO PDF
// ============================================

function setupWordToPdf() {
  const dropzone = $('wordDropzone');
  const fileInput = $('wordFileInput');
  
  dropzone.addEventListener('click', () => fileInput.click());
  
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('drag-over');
  });
  
  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('drag-over');
  });
  
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    handleWordFiles(e.dataTransfer.files);
  });
  
  fileInput.addEventListener('change', (e) => {
    handleWordFiles(e.target.files);
    fileInput.value = '';
  });
  
  $('btnConvertWord').addEventListener('click', convertWordToPdf);
}

function handleWordFiles(files) {
  for (const file of files) {
    if (!file.name.toLowerCase().endsWith('.docx')) continue;
    
    wordFiles.push({
      name: file.name,
      file: file
    });
    renderWordPreview();
  }
}

function renderWordPreview() {
  const list = $('wordPreviewList');
  list.innerHTML = '';
  
  wordFiles.forEach((doc, idx) => {
    const item = document.createElement('div');
    item.className = 'preview-item';
    item.innerHTML = `
      <span class="name">📝 ${doc.name}</span>
      <button class="remove-btn" data-idx="${idx}">×</button>
    `;
    list.appendChild(item);
  });
  
  list.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      wordFiles.splice(parseInt(btn.dataset.idx), 1);
      renderWordPreview();
    });
  });
}

async function convertWordToPdf() {
  if (wordFiles.length === 0) {
    showStatus('Añade al menos un documento Word', 'error');
    return;
  }
  
  const btn = $('btnConvertWord');
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-loader"></span> Convirtiendo...';
  
  try {
    const mammoth = window.mammoth;
    const pdfLib = window.PDFLib;
    const { PDFDocument, rgb, StandardFonts } = pdfLib;
    
    for (const doc of wordFiles) {
      const arrayBuffer = await doc.file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      const text = result.value;
      
      const pdfDoc = await PDFDocument.create();
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      
      // Split text into lines
      const lines = text.split('\n');
      const margin = 50;
      const fontSize = 11;
      const lineHeight = fontSize * 1.4;
      
      let currentPage = pdfDoc.addPage([595, 842]); // A4
      let y = 842 - margin;
      
      for (const line of lines) {
        if (y < margin + lineHeight) {
          currentPage = pdfDoc.addPage([595, 842]);
          y = 842 - margin;
        }
        
        currentPage.drawText(line, {
          x: margin,
          y: y,
          size: fontSize,
          font: font,
          color: rgb(0, 0, 0)
        });
        
        y -= lineHeight;
      }
      
      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = url;
      link.download = doc.name.replace('.docx', '.pdf');
      link.click();
      
      await new Promise(resolve => setTimeout(resolve, 300));
      URL.revokeObjectURL(url);
    }
    
    wordFiles = [];
    renderWordPreview();
    showStatus('PDFs creados', 'success');
    
  } catch (err) {
    console.error('Error converting Word:', err);
    showStatus('Error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Crear PDFs';
  }
}

// ============================================
// MERGE PDFs
// ============================================

function setupMerge() {
  const dropzone = $('mergeDropzone');
  const fileInput = $('mergeFileInput');
  
  dropzone.addEventListener('click', () => fileInput.click());
  
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('drag-over');
  });
  
  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('drag-over');
  });
  
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    handleMergeFiles(e.dataTransfer.files);
  });
  
  fileInput.addEventListener('change', (e) => {
    handleMergeFiles(e.target.files);
    fileInput.value = '';
  });
  
  $('btnMergePdfs').addEventListener('click', mergePdfs);
}

function handleMergeFiles(files) {
  for (const file of files) {
    if (!file.name.toLowerCase().endsWith('.pdf')) continue;
    
    mergeFiles.push({
      name: file.name,
      file: file
    });
    renderMergePreview();
  }
}

function renderMergePreview() {
  const list = $('mergePreviewList');
  list.innerHTML = '';
  
  mergeFiles.forEach((pdf, idx) => {
    const item = document.createElement('div');
    item.className = 'preview-item';
    item.draggable = true;
    item.dataset.idx = idx;
    item.innerHTML = `
      <span class="name">📄 ${pdf.name}</span>
      <button class="remove-btn" data-idx="${idx}">×</button>
    `;
    list.appendChild(item);
  });
  
  list.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      mergeFiles.splice(parseInt(btn.dataset.idx), 1);
      renderMergePreview();
    });
  });
  
  // Drag to reorder
  let draggedItem = null;
  list.querySelectorAll('.preview-item').forEach(item => {
    item.addEventListener('dragstart', () => {
      draggedItem = item;
    });
    item.addEventListener('dragover', (e) => {
      e.preventDefault();
    });
    item.addEventListener('drop', (e) => {
      e.preventDefault();
      if (draggedItem && draggedItem !== item) {
        const fromIdx = parseInt(draggedItem.dataset.idx);
        const toIdx = parseInt(item.dataset.idx);
        const moved = mergeFiles.splice(fromIdx, 1)[0];
        mergeFiles.splice(toIdx, 0, moved);
        renderMergePreview();
      }
    });
  });
}

async function mergePdfs() {
  if (mergeFiles.length < 2) {
    showStatus('Añade al menos 2 PDFs para juntar', 'error');
    return;
  }
  
  const btn = $('btnMergePdfs');
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-loader"></span> Juntando...';
  
  try {
    const pdfLib = window.PDFLib;
    const { PDFDocument } = pdfLib;
    
    const mergedPdf = await PDFDocument.create();
    
    for (const pdf of mergeFiles) {
      const arrayBuffer = await pdf.file.arrayBuffer();
      const srcPdf = await PDFDocument.load(arrayBuffer);
      const pages = await mergedPdf.copyPages(srcPdf, srcPdf.getPageIndices());
      pages.forEach(page => mergedPdf.addPage(page));
    }
    
    const pdfBytes = await mergedPdf.save();
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = 'juntado.pdf';
    link.click();
    
    URL.revokeObjectURL(url);
    
    mergeFiles = [];
    renderMergePreview();
    showStatus('PDFs juntados', 'success');
    
  } catch (err) {
    console.error('Error merging:', err);
    showStatus('Error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Juntar PDFs';
  }
}
