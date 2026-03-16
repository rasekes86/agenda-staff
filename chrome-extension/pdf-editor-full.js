// ============================================
// PDF EDITOR FULL SCREEN - AGENDA STAFF v5.23.4
// Fixed: Sidebar PDF tools layout (two rows), sticky document tabs
// ============================================

const SUPABASE_URL = 'https://iugutcsukxkxlgpkmzxt.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1Z3V0Y3N1a3hreGxncGttenh0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzc5OTExMjksImV4cCI6MjA1MzU2NzEyOX0.PpolAzqqXNBOhRlUVzplqkKeGQxzfed4gH377CidVJE';

// Multi-document state
let documents = [];
let activeDocIndex = -1;
let tabCounter = 0;

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

// Clipboard for copying elements between documents
let clipboardElements = null;

// Helper function
const $ = id => document.getElementById(id);

// Get active document
function getActiveDoc() {
  return activeDocIndex >= 0 && activeDocIndex < documents.length ? documents[activeDocIndex] : null;
}

// Create document state
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
    pageHeight: 0
  };
}

// Show status message
function showStatus(msg, type = '') {
  const el = $('statusMsg');
  if (el) {
    el.textContent = msg;
    el.className = 'status-msg show ' + type;
    setTimeout(() => el.classList.remove('show'), 3000);
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  console.log('PDF Editor initializing...');
  
  try {
    const stored = await chrome.storage.local.get(['session', 'user']);
    session = stored.session;
    currentUser = stored.user;
  } catch (err) {
    console.error('Error loading session:', err);
  }
  
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
  
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        const files = Array.from(e.target.files);
        handleMultipleFiles(files);
        e.target.value = '';
      }
    });
  }
  
  if (uploadWrapper && uploadArea) {
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
  
  const btnUpload = $('btnUpload');
  if (btnUpload) {
    btnUpload.addEventListener('click', () => {
      const multiInput = $('multiFileInput');
      if (multiInput) multiInput.click();
    });
  }
  
  const btnSave = $('btnSave');
  if (btnSave) btnSave.addEventListener('click', savePdf);
  
  const btnClear = $('btnClear');
  if (btnClear) btnClear.addEventListener('click', clearEditor);
  
  const btnPrevPage = $('btnPrevPage');
  if (btnPrevPage) btnPrevPage.addEventListener('click', () => navigatePage(-1));
  
  const btnNextPage = $('btnNextPage');
  if (btnNextPage) btnNextPage.addEventListener('click', () => navigatePage(1));
  
  const btnZoomIn = $('btnZoomIn');
  if (btnZoomIn) btnZoomIn.addEventListener('click', () => changeZoom(0.25));
  
  const btnZoomOut = $('btnZoomOut');
  if (btnZoomOut) btnZoomOut.addEventListener('click', () => changeZoom(-0.25));
  
  const btnAddText = $('btnAddText');
  if (btnAddText) btnAddText.addEventListener('click', showTextModal);
  
  const btnAddImage = $('btnAddImage');
  if (btnAddImage) btnAddImage.addEventListener('click', addImage);
  
  const btnAddSignature = $('btnAddSignature');
  if (btnAddSignature) btnAddSignature.addEventListener('click', showSignatureModal);
  
  const btnAddDate = $('btnAddDate');
  if (btnAddDate) btnAddDate.addEventListener('click', addCurrentDate);
  
  const cancelText = $('cancelText');
  if (cancelText) {
    cancelText.addEventListener('click', () => {
      $('textModal').classList.remove('show');
    });
  }
  
  const confirmText = $('confirmText');
  if (confirmText) confirmText.addEventListener('click', confirmTextWithPosition);
  
  const closeSignatureModal = $('closeSignatureModal');
  if (closeSignatureModal) {
    closeSignatureModal.addEventListener('click', () => {
      $('signatureModal').classList.remove('show');
    });
  }
  
  const btnSearchSignature = $('btnSearchSignature');
  if (btnSearchSignature) btnSearchSignature.addEventListener('click', searchSignatures);
  
  const signatureSearchInput = $('signatureSearchInput');
  if (signatureSearchInput) {
    signatureSearchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') searchSignatures();
    });
  }
  
  // Clipboard buttons
  const btnCopyElements = $('btnCopyElements');
  if (btnCopyElements) {
    btnCopyElements.addEventListener('click', copyCurrentPageElements);
  }
  
  const btnPasteElements = $('btnPasteElements');
  if (btnPasteElements) {
    btnPasteElements.addEventListener('click', pasteElementsToCurrentPage);
  }
  
  const btnClearClipboard = $('btnClearClipboard');
  if (btnClearClipboard) {
    btnClearClipboard.addEventListener('click', clearClipboard);
  }
}

// ============================================
// MULTI-DOCUMENT TABS
// ============================================

function setupMultiDocumentTabs() {
  const addTabBtn = $('btnAddPdfTab');
  const multiInput = $('multiFileInput');
  
  if (addTabBtn && multiInput) {
    addTabBtn.addEventListener('click', () => {
      multiInput.click();
    });
    
    multiInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        const files = Array.from(e.target.files);
        handleMultipleFiles(files);
      }
      e.target.value = '';
    });
  }
}

function handleMultipleFiles(files) {
  if (!files || files.length === 0) return;
  
  const pdfFiles = files.filter(f => f.name.toLowerCase().endsWith('.pdf'));
  
  if (pdfFiles.length === 0) {
    showStatus('No se encontraron archivos PDF', 'error');
    return;
  }
  
  showStatus(`Cargando ${pdfFiles.length} PDF${pdfFiles.length > 1 ? 's' : ''}...`);
  
  pdfFiles.forEach((file, index) => {
    setTimeout(() => {
      loadPdfAsNewTab(file, index === 0);
    }, index * 150);
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
      
      documents.push(newDoc);
      createTab(newDoc);
      
      if (switchToIt || documents.length === 1) {
        switchToTab(documents.length - 1);
      }
      
      showStatus(`${file.name} cargado (${totalPages} pág.)`, 'success');
      
    } catch (err) {
      console.error('Error loading PDF:', err);
      showStatus('Error al cargar: ' + file.name, 'error');
    }
  };
  
  reader.onerror = () => {
    showStatus('Error leyendo archivo: ' + file.name, 'error');
  };
  
  reader.readAsArrayBuffer(file);
}

function createTab(doc) {
  const tabsList = $('documentTabsList');
  if (!tabsList) return;
  
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
  
  document.querySelectorAll('.doc-tab').forEach((tab, i) => {
    tab.classList.toggle('active', i === index);
  });
  
  const uploadWrapper = $('uploadWrapper');
  if (uploadWrapper) uploadWrapper.style.display = 'none';
  
  const pageNav = $('pageNav');
  if (pageNav) pageNav.style.display = 'flex';
  
  const zoomControls = $('zoomControls');
  if (zoomControls) zoomControls.style.display = 'flex';
  
  const fileName = $('fileName');
  if (fileName) {
    fileName.style.display = 'inline';
    fileName.textContent = doc.fileName + ' (' + doc.totalPages + ' pág.)';
  }
  
  const btnSave = $('btnSave');
  if (btnSave) btnSave.disabled = false;
  
  const zoomLevel = $('zoomLevel');
  if (zoomLevel) zoomLevel.textContent = Math.round(doc.zoom * 100) + '%';
  
  updateSplitTool();
  renderPage();
}

function closeTab(docId) {
  const idx = documents.findIndex(d => d.id === docId);
  if (idx < 0) return;
  
  const doc = documents[idx];
  const hasElements = Object.values(doc.elements).some(arr => arr.length > 0);
  
  if (hasElements && !confirm(`¿Cerrar "${doc.fileName}" sin guardar los cambios?`)) {
    return;
  }
  
  documents.splice(idx, 1);
  
  const tab = document.querySelector(`.doc-tab[data-doc-id="${docId}"]`);
  if (tab) tab.remove();
  
  if (documents.length === 0) {
    activeDocIndex = -1;
    showUploadArea();
  } else if (activeDocIndex >= documents.length) {
    switchToTab(documents.length - 1);
  } else if (idx < activeDocIndex) {
    activeDocIndex--;
  } else {
    switchToTab(activeDocIndex);
  }
}

function showUploadArea() {
  const canvasArea = $('canvasArea');
  if (!canvasArea) return;
  
  canvasArea.innerHTML = `
    <div class="upload-wrapper" id="uploadWrapper">
      <input type="file" class="file-input-overlay" id="fileInput" accept=".pdf" multiple>
      <div class="upload-area" id="uploadArea">
        <div class="upload-icon">📄</div>
        <div class="upload-text">Arrastra PDFs aquí o haz clic para seleccionar</div>
        <div class="upload-hint">Puedes cargar varios PDFs a la vez</div>
      </div>
    </div>
  `;
  
  const btnSave = $('btnSave');
  if (btnSave) btnSave.disabled = true;
  
  const pageNav = $('pageNav');
  if (pageNav) pageNav.style.display = 'none';
  
  const zoomControls = $('zoomControls');
  if (zoomControls) zoomControls.style.display = 'none';
  
  const fileName = $('fileName');
  if (fileName) fileName.style.display = 'none';
  
  const fileInput = $('fileInput');
  const uploadArea = $('uploadArea');
  const uploadWrapper = $('uploadWrapper');
  
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        const files = Array.from(e.target.files);
        handleMultipleFiles(files);
        e.target.value = '';
      }
    });
  }
  
  if (uploadWrapper && uploadArea) {
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
}

function updateTabModified(docId, hasChanges) {
  const tab = document.querySelector(`.doc-tab[data-doc-id="${docId}"]`);
  if (!tab) return;
  
  const nameEl = tab.querySelector('.doc-tab-name');
  if (!nameEl) return;
  
  if (hasChanges && !nameEl.textContent.endsWith(' *')) {
    nameEl.textContent += ' *';
  } else if (!hasChanges && nameEl.textContent.endsWith(' *')) {
    nameEl.textContent = nameEl.textContent.slice(0, -2);
  }
}

// ============================================
// TOOL TABS
// ============================================

function setupToolTabs() {
  const tabs = document.querySelectorAll('.tool-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tool = tab.dataset.tool;
      
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      document.querySelectorAll('.tool-content').forEach(c => c.classList.remove('active'));
      const toolContent = document.getElementById('tool' + tool.charAt(0).toUpperCase() + tool.slice(1));
      if (toolContent) toolContent.classList.add('active');
      
      currentTool = tool;
      
      const isEditor = tool === 'editor';
      const activeDoc = getActiveDoc();
      
      const pageNav = $('pageNav');
      const zoomControls = $('zoomControls');
      const btnSave = $('btnSave');
      
      if (pageNav) pageNav.style.display = isEditor && activeDoc ? 'flex' : 'none';
      if (zoomControls) zoomControls.style.display = isEditor && activeDoc ? 'flex' : 'none';
      if (btnSave) btnSave.style.display = isEditor ? 'flex' : 'none';
      
      if (tool === 'split') updateSplitTool();
    });
  });
}

// ============================================
// PDF RENDERING
// ============================================

async function renderPage() {
  const activeDoc = getActiveDoc();
  if (!activeDoc || !activeDoc.pdfJsDoc) return;
  
  const canvasArea = $('canvasArea');
  if (!canvasArea) return;
  
  canvasArea.innerHTML = '';
  
  try {
    const page = await activeDoc.pdfJsDoc.getPage(activeDoc.currentPage);
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
    
    container.addEventListener('dblclick', (e) => {
      if (e.target.classList.contains('pdf-element') || e.target.closest('.pdf-element')) return;
      if (!activeDoc.pdfJsDoc) return;
      
      const rect = overlay.getBoundingClientRect();
      const x = (e.clientX - rect.left) / scale;
      const y = (e.clientY - rect.top) / scale;
      
      const textInput = $('textInput');
      const textSize = $('textSize');
      const textColor = $('textColor');
      const textModal = $('textModal');
      
      if (textInput) textInput.value = '';
      if (textSize) textSize.value = 14;
      if (textColor) textColor.value = '#000000';
      if (textModal) {
        textModal.classList.add('show');
        textModal.dataset.posX = x;
        textModal.dataset.posY = y;
      }
      if (textInput) textInput.focus();
    });
    
    const currentPageNum = $('currentPageNum');
    const totalPagesNum = $('totalPagesNum');
    const btnPrevPage = $('btnPrevPage');
    const btnNextPage = $('btnNextPage');
    
    if (currentPageNum) currentPageNum.textContent = activeDoc.currentPage;
    if (totalPagesNum) totalPagesNum.textContent = activeDoc.totalPages;
    if (btnPrevPage) btnPrevPage.disabled = activeDoc.currentPage <= 1;
    if (btnNextPage) btnNextPage.disabled = activeDoc.currentPage >= activeDoc.totalPages;
    
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
    
    if (el.type === 'signature' && el.name) {
      const nameLabel = document.createElement('div');
      nameLabel.className = 'signature-name-label';
      nameLabel.textContent = el.name;
      div.appendChild(nameLabel);
    }
  }
  
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

function confirmTextWithPosition() {
  const activeDoc = getActiveDoc();
  if (!activeDoc) return;
  
  const textInput = $('textInput');
  const textSize = $('textSize');
  const textColor = $('textColor');
  const textModal = $('textModal');
  
  const text = textInput ? textInput.value.trim() : '';
  const size = textSize ? parseInt(textSize.value) || 14 : 14;
  const color = textColor ? textColor.value : '#000000';
  
  if (!text) {
    showStatus('Escribe un texto', 'error');
    return;
  }
  
  const posX = textModal && textModal.dataset.posX ? parseFloat(textModal.dataset.posX) : activeDoc.pageWidth / 2 - 50;
  const posY = textModal && textModal.dataset.posY ? parseFloat(textModal.dataset.posY) : activeDoc.pageHeight / 2;
  
  activeDoc.elements[activeDoc.currentPage].push({
    type: 'text',
    text: text,
    x: posX,
    y: posY,
    size: size,
    color: color
  });
  
  if (textModal) {
    textModal.classList.remove('show');
    delete textModal.dataset.posX;
    delete textModal.dataset.posY;
  }
  
  updateTabModified(activeDoc.id, true);
  renderPage();
  showStatus('Texto añadido', 'success');
}

function addCurrentDate() {
  const activeDoc = getActiveDoc();
  if (!activeDoc || !activeDoc.pdfJsDoc) {
    showStatus('Primero carga un PDF', 'error');
    return;
  }
  
  const today = new Date();
  const dateStr = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;
  
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
    if (e.target.classList.contains('pdf-element-delete') || e.target.classList.contains('resize-handle')) return;
    
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    origX = el.x * scale;
    origY = el.y * scale;
    div.classList.add('selected');
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
  const zoomLevel = $('zoomLevel');
  if (zoomLevel) zoomLevel.textContent = Math.round(activeDoc.zoom * 100) + '%';
  renderPage();
}

function showTextModal() {
  const activeDoc = getActiveDoc();
  if (!activeDoc || !activeDoc.pdfJsDoc) {
    showStatus('Primero carga un PDF', 'error');
    return;
  }
  
  const textInput = $('textInput');
  const textSize = $('textSize');
  const textColor = $('textColor');
  const textModal = $('textModal');
  
  if (textInput) textInput.value = '';
  if (textSize) textSize.value = 14;
  if (textColor) textColor.value = '#000000';
  if (textModal) {
    delete textModal.dataset.posX;
    delete textModal.dataset.posY;
    textModal.classList.add('show');
  }
  if (textInput) textInput.focus();
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
  
  const signatureSearchInput = $('signatureSearchInput');
  const signatureResults = $('signatureResults');
  const signatureModal = $('signatureModal');
  const signatureCount = $('signatureCount');
  
  if (signatureSearchInput) signatureSearchInput.value = '';
  if (signatureResults) signatureResults.innerHTML = '<div class="signature-empty">Escribe uno o más nombres (uno por línea)</div>';
  if (signatureModal) signatureModal.classList.add('show');
  if (signatureSearchInput) signatureSearchInput.focus();
  
  addedSignaturesCount = 0;
  if (signatureCount) signatureCount.style.display = 'none';
}

async function searchSignatures() {
  const signatureSearchInput = $('signatureSearchInput');
  const signatureResults = $('signatureResults');
  
  const searchInput = signatureSearchInput ? signatureSearchInput.value.trim() : '';
  
  if (!searchInput) {
    if (signatureResults) signatureResults.innerHTML = '<div class="signature-empty">Escribe un nombre para buscar</div>';
    return;
  }
  
  const searchTerms = searchInput.split('\n').map(term => term.trim()).filter(term => term.length > 0);
  if (searchTerms.length === 0) return;
  
  if (signatureResults) signatureResults.innerHTML = '<div class="signature-loading">Buscando...</div>';
  
  try {
    let allSignatures = [];
    const foundNames = [];
    
    const headers = { 'apikey': SUPABASE_KEY };
    if (session && session.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }
    
    for (const term of searchTerms) {
      const query = `?select=*&name=ilike.*${encodeURIComponent(term)}*&order=name.asc`;
      const res = await fetch(`${SUPABASE_URL}/rest/v1/signatures${query}`, { headers });
      
      if (res.ok) {
        const signatures = await res.json();
        if (signatures && signatures.length > 0) {
          signatures.forEach(sig => {
            if (!allSignatures.find(s => s.id === sig.id)) {
              allSignatures.push(sig);
              foundNames.push(sig.name.toLowerCase());
            }
          });
        }
      }
    }
    
    allSignatures.sort((a, b) => a.name.localeCompare(b.name));
    renderSignatureResultsWithMissing(allSignatures, searchTerms, foundNames);
    
  } catch (err) {
    console.error('Search error:', err);
    if (signatureResults) signatureResults.innerHTML = '<div class="signature-empty">Error: ' + err.message + '</div>';
  }
}

function renderSignatureResultsWithMissing(signatures, searchedTerms, foundNames) {
  const signatureResults = $('signatureResults');
  if (!signatureResults) return;
  
  const normalizedFoundNames = foundNames.map(n => n.toLowerCase());
  const missingNames = searchedTerms.filter(term => {
    const normalizedTerm = term.toLowerCase();
    return !normalizedFoundNames.some(found => found.includes(normalizedTerm) || normalizedTerm.includes(found));
  });
  
  let html = '';
  
  if (signatures.length > 0) {
    html += `<div class="signature-found-header">✓ Encontradas (${signatures.length})</div>`;
    signatures.forEach(sig => {
      html += `<div class="signature-item signature-found" data-id="${sig.id}" data-url="${sig.image_url}" data-name="${escapeHtml(sig.name)}">
        <span class="signature-name">${escapeHtml(sig.name)}</span>
        <div class="signature-actions">
          <button class="signature-delete-btn" data-id="${sig.id}" data-name="${escapeHtml(sig.name)}" title="Eliminar">🗑️</button>
          <span class="signature-add-icon" title="Añadir al PDF">+</span>
        </div>
      </div>`;
    });
  }
  
  if (missingNames.length > 0) {
    html += `<div class="signature-missing-header">⚠ No encontradas (${missingNames.length})</div>`;
    missingNames.forEach(name => {
      html += `<div class="signature-item signature-missing">
        <span class="signature-missing-name">${escapeHtml(name)}</span>
        <button class="signature-upload-btn" data-name="${escapeHtml(name)}">📤 Subir</button>
      </div>`;
    });
  }
  
  signatureResults.innerHTML = html;
  
  document.querySelectorAll('.signature-item.signature-found').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('signature-delete-btn')) return;
      selectSignature(item.dataset.url, item.dataset.name);
    });
  });
  
  document.querySelectorAll('.signature-delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm('¿Eliminar la firma de "' + btn.dataset.name + '"?')) {
        deleteSignature(btn.dataset.id, btn.dataset.name);
      }
    });
  });
  
  document.querySelectorAll('.signature-upload-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      uploadMissingSignature(btn.dataset.name);
    });
  });
}

async function deleteSignature(id, name) {
  console.log('Deleting signature:', id, name);
  
  try {
    const headers = {
      'apikey': SUPABASE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    };
    
    // Use anon key as fallback for Authorization
    if (session && session.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    } else {
      headers['Authorization'] = `Bearer ${SUPABASE_KEY}`;
    }
    
    const response = await fetch(`${SUPABASE_URL}/rest/v1/signatures?id=eq.${id}`, {
      method: 'DELETE',
      headers
    });
    
    console.log('Delete response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Delete error response:', errorText);
      throw new Error(`Error ${response.status}: ${errorText}`);
    }
    
    showStatus('✓ Firma eliminada: ' + name, 'success');
    searchSignatures();
  } catch (err) {
    console.error('Delete signature error:', err);
    showStatus('Error al eliminar: ' + err.message, 'error');
  }
}

// Process image to make signature dark and clear
function processSignatureImage(base64Data) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      
      // Draw original image
      ctx.drawImage(img, 0, 0);
      
      // Get image data
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      
      // Process each pixel - make signature dark/black
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];
        
        // Calculate grayscale
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        
        // Increase contrast and threshold to make signature black
        // Dark pixels become pure black, light pixels become transparent/white
        if (a < 50) {
          // Transparent pixel - keep transparent
          data[i] = 255;
          data[i + 1] = 255;
          data[i + 2] = 255;
          data[i + 3] = 0;
        } else if (gray < 180) {
          // Dark pixel (signature stroke) - make pure black
          data[i] = 0;
          data[i + 1] = 0;
          data[i + 2] = 0;
          data[i + 3] = 255;
        } else {
          // Light pixel - make transparent
          data[i] = 255;
          data[i + 1] = 255;
          data[i + 2] = 255;
          data[i + 3] = 0;
        }
      }
      
      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => resolve(base64Data); // Return original if processing fails
    img.src = base64Data;
  });
}

async function uploadMissingSignature(name) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    showStatus('Procesando firma de ' + name + '...', '');
    
    try {
      const originalBase64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      
      // Process image to make signature dark and clear
      const processedBase64 = await processSignatureImage(originalBase64);
      
      const headers = {
        'apikey': SUPABASE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      };
      
      // Use anon key as fallback for Authorization
      if (session && session.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      } else {
        headers['Authorization'] = `Bearer ${SUPABASE_KEY}`;
      }
      
      const upperName = name.toUpperCase();
      console.log('Uploading signature for:', upperName);
      
      // First check if signature with this name already exists
      const checkResponse = await fetch(`${SUPABASE_URL}/rest/v1/signatures?name=eq.${encodeURIComponent(upperName)}&select=id`, {
        method: 'GET',
        headers
      });
      
      console.log('Check existing response:', checkResponse.status);
      
      if (checkResponse.ok) {
        const existing = await checkResponse.json();
        console.log('Existing signatures:', existing);
        
        if (existing && existing.length > 0) {
          // Signature exists - delete it first (replace)
          const existingId = existing[0].id;
          console.log('Deleting existing signature:', existingId);
          
          const deleteResponse = await fetch(`${SUPABASE_URL}/rest/v1/signatures?id=eq.${existingId}`, {
            method: 'DELETE',
            headers
          });
          
          console.log('Delete response:', deleteResponse.status);
          
          if (!deleteResponse.ok) {
            const errorText = await deleteResponse.text();
            console.error('Delete error:', errorText);
            throw new Error('Error al eliminar firma existente: ' + errorText);
          }
          
          console.log('Existing signature deleted');
        }
      }
      
      // Now upload the new signature
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
      const bodyData = { id, name: upperName, image_url: processedBase64 };
      if (currentUser) {
        bodyData.user_id = currentUser.id;
        bodyData.user_name = currentUser.name;
      }
      
      console.log('Uploading new signature with id:', id);
      
      const response = await fetch(`${SUPABASE_URL}/rest/v1/signatures`, {
        method: 'POST',
        headers,
        body: JSON.stringify(bodyData)
      });
      
      console.log('Upload response:', response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Upload error:', errorText);
        throw new Error('Error al subir: ' + errorText);
      }
      
      showStatus('✓ Firma guardada: ' + name, 'success');
      searchSignatures();
    } catch (err) {
      console.error('Upload signature error:', err);
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
    updateTabModified(activeDoc.id, true);
    renderPage();
    showStatus(`✓ Firma añadida: ${name}`, 'success');
    
    const countEl = $('signatureCount');
    if (countEl) {
      countEl.style.display = 'block';
      countEl.textContent = `${addedSignaturesCount} firma(s) añadida(s)`;
      countEl.style.background = '#10b981';
    }
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
  
  const btn = $('btnSave');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="btn-loader"></span>';
  }
  
  try {
    const pdfLib = window.PDFLib;
    const { PDFDocument, rgb, StandardFonts } = pdfLib;
    
    const newPdfDoc = await PDFDocument.load(activeDoc.originalPdfBytes, { ignoreEncryption: true });
    const font = await newPdfDoc.embedFont(StandardFonts.Helvetica);
    
    // Collect all signatures from all pages to determine filename
    let allSignatures = [];
    for (let pageNum = 1; pageNum <= activeDoc.totalPages; pageNum++) {
      const pageElements = activeDoc.elements[pageNum] || [];
      pageElements.forEach(el => {
        if (el.type === 'signature' && el.name) {
          allSignatures.push(el.name);
        }
      });
    }
    
    // Generate filename: original + signature name (if only one signature)
    let downloadFileName = activeDoc.fileName || 'documento-editado.pdf';
    if (allSignatures.length === 1) {
      const baseName = downloadFileName.replace(/\.pdf$/i, '');
      const sigName = allSignatures[0].replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ\s]/g, '').trim();
      downloadFileName = `${baseName}_${sigName}.pdf`;
    }
    
    for (let pageNum = 1; pageNum <= activeDoc.totalPages; pageNum++) {
      const page = newPdfDoc.getPage(pageNum - 1);
      const { width, height } = page.getSize();
      const pageElements = activeDoc.elements[pageNum] || [];
      
      for (const el of pageElements) {
        if (el.type === 'text') {
          const fontSize = el.size || 14;
          const pdfY = height - el.y - fontSize;
          const color = hexToRgb(el.color || '#000000');
          
          page.drawText(el.text, {
            x: el.x,
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
            
            const image = isPng ? await newPdfDoc.embedPng(imageBytes) : await newPdfDoc.embedJpg(imageBytes);
            
            page.drawImage(image, {
              x: el.x,
              y: height - el.y - el.height,
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
    link.download = downloadFileName;
    link.click();
    
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    
    for (let i = 1; i <= activeDoc.totalPages; i++) {
      activeDoc.elements[i] = [];
    }
    updateTabModified(activeDoc.id, false);
    renderPage();
    
    showStatus('PDF guardado correctamente', 'success');
    
  } catch (err) {
    console.error('Save error:', err);
    showStatus('Error al guardar: ' + err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '💾 Guardar';
    }
  }
}

function clearEditor() {
  const activeDoc = getActiveDoc();
  if (!activeDoc) return;
  
  const hasElements = Object.values(activeDoc.elements).some(arr => arr.length > 0);
  if (hasElements && !confirm('¿Limpiar los cambios del documento actual?')) return;
  
  closeTab(activeDoc.id);
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
// SPLIT PDF
// ============================================

function setupSplit() {
  document.querySelectorAll('input[name="splitMode"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const mode = radio.value;
      const splitBlocksConfig = $('splitBlocksConfig');
      const splitRangesConfig = $('splitRangesConfig');
      if (splitBlocksConfig) splitBlocksConfig.style.display = mode === 'blocks' ? 'block' : 'none';
      if (splitRangesConfig) splitRangesConfig.style.display = mode === 'ranges' ? 'block' : 'none';
      updateSplitPreview();
    });
  });
  
  const splitBlockSize = $('splitBlockSize');
  if (splitBlockSize) splitBlockSize.addEventListener('input', updateSplitPreview);
  
  const splitRangesInput = $('splitRangesInput');
  if (splitRangesInput) splitRangesInput.addEventListener('input', updateSplitPreview);
  
  const btnSplitPdf = $('btnSplitPdf');
  if (btnSplitPdf) btnSplitPdf.addEventListener('click', splitPdf);
}

function updateSplitTool() {
  const activeDoc = getActiveDoc();
  const hasPdf = activeDoc && activeDoc.pdfJsDoc && activeDoc.totalPages > 0;
  
  const splitNoPdf = $('splitNoPdf');
  const splitPdfInfo = $('splitPdfInfo');
  const splitOptions = $('splitOptions');
  const btnSplitPdf = $('btnSplitPdf');
  
  if (splitNoPdf) splitNoPdf.style.display = hasPdf ? 'none' : 'block';
  if (splitPdfInfo) splitPdfInfo.style.display = hasPdf ? 'flex' : 'none';
  if (splitOptions) splitOptions.style.display = hasPdf ? 'block' : 'none';
  if (btnSplitPdf) btnSplitPdf.disabled = !hasPdf;
  
  if (hasPdf) {
    const splitPdfName = $('splitPdfName');
    const splitPdfPages = $('splitPdfPages');
    if (splitPdfName) splitPdfName.textContent = activeDoc.fileName;
    if (splitPdfPages) splitPdfPages.textContent = activeDoc.totalPages + ' pág.';
    updateSplitPreview();
  }
}

function updateSplitPreview() {
  const activeDoc = getActiveDoc();
  const preview = $('splitPreview');
  if (!preview || !activeDoc || activeDoc.totalPages === 0) return;
  
  const mode = document.querySelector('input[name="splitMode"]:checked')?.value || 'single';
  let html = '<div class="preview-title">Resultado:</div>';
  
  if (mode === 'single') {
    html += `<span class="preview-badge">${activeDoc.totalPages} PDFs (1 pág. cada uno)</span>`;
  } else if (mode === 'blocks') {
    const blockSize = parseInt($('splitBlockSize')?.value) || 2;
    const count = Math.ceil(activeDoc.totalPages / blockSize);
    html += `<span class="preview-badge">${count} PDFs (${blockSize} pág. c/u)</span>`;
  } else if (mode === 'ranges') {
    const rangesText = $('splitRangesInput')?.value.trim() || '';
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
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="btn-loader"></span> Separando...';
  }
  
  try {
    const pdfLib = window.PDFLib;
    const { PDFDocument } = pdfLib;
    
    const pdfDoc = await PDFDocument.load(activeDoc.originalPdfBytes);
    const mode = document.querySelector('input[name="splitMode"]:checked')?.value || 'single';
    const baseName = activeDoc.fileName.replace('.pdf', '').replace('.PDF', '');
    
    if (mode === 'single') {
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
      const blockSize = parseInt($('splitBlockSize')?.value) || 2;
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
      const rangesText = $('splitRangesInput')?.value.trim() || '';
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
    showStatus('Error al separar: ' + err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = 'Separar PDF';
    }
  }
}

// ============================================
// IMAGE TO PDF
// ============================================

function setupImgToPdf() {
  const dropzone = $('imgDropzone');
  const fileInput = $('imgFileInput');
  
  if (dropzone && fileInput) {
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
    
    fileInput.addEventListener('change', (e) => {
      handleImgFiles(e.target.files);
      fileInput.value = '';
    });
  }
  
  document.querySelectorAll('[data-orientation]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-orientation]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
  
  const btnConvertImg = $('btnConvertImg');
  if (btnConvertImg) btnConvertImg.addEventListener('click', convertImgToPdf);
}

function handleImgFiles(files) {
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    const reader = new FileReader();
    reader.onload = (e) => {
      imgFiles.push({ name: file.name, src: e.target.result });
      renderImgPreview();
    };
    reader.readAsDataURL(file);
  }
}

function renderImgPreview() {
  const list = $('imgPreviewList');
  if (!list) return;
  list.innerHTML = '';
  
  imgFiles.forEach((img, idx) => {
    const item = document.createElement('div');
    item.className = 'preview-item';
    item.innerHTML = `<img src="${img.src}" alt=""><span class="name">${img.name}</span><button class="remove-btn" data-idx="${idx}">×</button>`;
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
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="btn-loader"></span> Creando...';
  }
  
  try {
    const pdfLib = window.PDFLib;
    const { PDFDocument } = pdfLib;
    
    const pdfDoc = await PDFDocument.create();
    const orientation = document.querySelector('[data-orientation].active')?.dataset.orientation || 'portrait';
    const pageSize = $('pageSize')?.value || 'a4';
    
    const sizes = { a4: { width: 595, height: 842 }, letter: { width: 612, height: 792 }, legal: { width: 612, height: 1008 } };
    
    for (const img of imgFiles) {
      const imageBytes = Uint8Array.from(atob(img.src.split(',')[1]), c => c.charCodeAt(0));
      const isPng = img.src.includes('image/png');
      const embeddedImg = isPng ? await pdfDoc.embedPng(imageBytes) : await pdfDoc.embedJpg(imageBytes);
      
      let pageWidth, pageHeight;
      if (pageSize === 'fit') {
        pageWidth = embeddedImg.width;
        pageHeight = embeddedImg.height;
      } else {
        const size = sizes[pageSize];
        pageWidth = orientation === 'landscape' ? size.height : size.width;
        pageHeight = orientation === 'landscape' ? size.width : size.height;
      }
      
      const page = pdfDoc.addPage([pageWidth, pageHeight]);
      const scale = Math.min(pageWidth / embeddedImg.width, pageHeight / embeddedImg.height);
      const imgWidth = embeddedImg.width * scale;
      const imgHeight = embeddedImg.height * scale;
      
      page.drawImage(embeddedImg, { x: (pageWidth - imgWidth) / 2, y: (pageHeight - imgHeight) / 2, width: imgWidth, height: imgHeight });
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
    showStatus('Error: ' + err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = 'Crear PDF';
    }
  }
}

// ============================================
// WORD TO PDF
// ============================================

function setupWordToPdf() {
  const dropzone = $('wordDropzone');
  const fileInput = $('wordFileInput');
  
  if (dropzone && fileInput) {
    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('drag-over'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
    dropzone.addEventListener('drop', (e) => { e.preventDefault(); dropzone.classList.remove('drag-over'); handleWordFiles(e.dataTransfer.files); });
    fileInput.addEventListener('change', (e) => { handleWordFiles(e.target.files); fileInput.value = ''; });
  }
  
  const btnConvertWord = $('btnConvertWord');
  if (btnConvertWord) btnConvertWord.addEventListener('click', convertWordToPdf);
}

function handleWordFiles(files) {
  for (const file of files) {
    if (!file.name.toLowerCase().endsWith('.docx')) continue;
    wordFiles.push({ name: file.name, file: file });
    renderWordPreview();
  }
}

function renderWordPreview() {
  const list = $('wordPreviewList');
  if (!list) return;
  list.innerHTML = '';
  
  wordFiles.forEach((doc, idx) => {
    const item = document.createElement('div');
    item.className = 'preview-item';
    item.innerHTML = `<span class="name">📝 ${doc.name}</span><button class="remove-btn" data-idx="${idx}">×</button>`;
    list.appendChild(item);
  });
  
  list.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', () => { wordFiles.splice(parseInt(btn.dataset.idx), 1); renderWordPreview(); });
  });
}

async function convertWordToPdf() {
  if (wordFiles.length === 0) {
    showStatus('Añade al menos un documento Word', 'error');
    return;
  }
  
  const btn = $('btnConvertWord');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="btn-loader"></span> Convirtiendo...'; }
  
  try {
    const mammoth = window.mammoth;
    const pdfLib = window.PDFLib;
    const { PDFDocument, rgb, StandardFonts } = pdfLib;
    
    for (const doc of wordFiles) {
      showStatus('Procesando: ' + doc.name, '');
      
      const arrayBuffer = await doc.file.arrayBuffer();
      
      // Use convertToHtml to preserve formatting
      const result = await mammoth.convertToHtml({ arrayBuffer }, {
        styleMap: [
          "p[style-name='Heading 1'] => h1:fresh",
          "p[style-name='Heading 2'] => h2:fresh",
          "p[style-name='Heading 3'] => h3:fresh"
        ]
      });
      
      const html = result.value;
      const messages = result.messages;
      
      // Parse HTML and extract styled content
      const parser = new DOMParser();
      const htmlDoc = parser.parseFromString(html, 'text/html');
      
      const pdfDoc = await PDFDocument.create();
      
      // Embed fonts
      const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
      
      const pageWidth = 595;
      const pageHeight = 842;
      const margin = 50;
      const contentWidth = pageWidth - (margin * 2);
      
      let currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
      let y = pageHeight - margin;
      
      // Process HTML elements
      const processNode = async (node, currentStyle = {}) => {
        if (node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent;
          if (!text.trim()) return;
          
          const fontSize = currentStyle.fontSize || 11;
          const lineHeight = fontSize * 1.4;
          const font = currentStyle.bold ? fontBold : (currentStyle.italic ? fontItalic : fontRegular);
          const color = currentStyle.color || rgb(0, 0, 0);
          
          // Word wrap
          const words = text.split(/\s+/);
          let line = '';
          
          for (const word of words) {
            const testLine = line ? line + ' ' + word : word;
            const width = font.widthOfTextAtSize(testLine, fontSize);
            
            if (width > contentWidth && line) {
              // Check for new page
              if (y < margin + lineHeight) {
                currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
                y = pageHeight - margin;
              }
              
              currentPage.drawText(line, {
                x: margin,
                y: y,
                size: fontSize,
                font: font,
                color: color
              });
              y -= lineHeight;
              line = word;
            } else {
              line = testLine;
            }
          }
          
          if (line.trim()) {
            if (y < margin + lineHeight) {
              currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
              y = pageHeight - margin;
            }
            
            currentPage.drawText(line, {
              x: margin,
              y: y,
              size: fontSize,
              font: font,
              color: color
            });
            y -= lineHeight;
          }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          const tagName = node.tagName.toLowerCase();
          const newStyle = { ...currentStyle };
          
          switch (tagName) {
            case 'h1':
              newStyle.fontSize = 24;
              newStyle.bold = true;
              y -= 10; // Extra space before heading
              break;
            case 'h2':
              newStyle.fontSize = 18;
              newStyle.bold = true;
              y -= 8;
              break;
            case 'h3':
              newStyle.fontSize = 14;
              newStyle.bold = true;
              y -= 6;
              break;
            case 'b':
            case 'strong':
              newStyle.bold = true;
              break;
            case 'i':
            case 'em':
              newStyle.italic = true;
              break;
            case 'u':
              newStyle.underline = true;
              break;
            case 'p':
              y -= 6; // Paragraph spacing
              break;
            case 'br':
              y -= (currentStyle.fontSize || 11) * 1.4;
              return;
            case 'ul':
            case 'ol':
              newStyle.listIndent = (currentStyle.listIndent || 0) + 20;
              break;
            case 'li':
              newStyle.listItem = true;
              newStyle.listIndent = currentStyle.listIndent || 20;
              break;
          }
          
          for (const child of node.childNodes) {
            await processNode(child, newStyle);
          }
          
          // Add spacing after certain elements
          if (['h1', 'h2', 'h3', 'p', 'ul', 'ol'].includes(tagName)) {
            y -= 4;
          }
        }
      };
      
      // Process all content
      for (const child of htmlDoc.body.childNodes) {
        await processNode(child);
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
    showStatus('PDFs creados con formato preservado', 'success');
  } catch (err) {
    console.error('Word conversion error:', err);
    showStatus('Error: ' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = 'Crear PDFs'; }
  }
}

// ============================================
// MERGE PDFs
// ============================================

function setupMerge() {
  const dropzone = $('mergeDropzone');
  const fileInput = $('mergeFileInput');
  
  if (dropzone && fileInput) {
    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('drag-over'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
    dropzone.addEventListener('drop', (e) => { e.preventDefault(); dropzone.classList.remove('drag-over'); handleMergeFiles(e.dataTransfer.files); });
    fileInput.addEventListener('change', (e) => { handleMergeFiles(e.target.files); fileInput.value = ''; });
  }
  
  const btnMergePdfs = $('btnMergePdfs');
  if (btnMergePdfs) btnMergePdfs.addEventListener('click', mergePdfs);
}

function handleMergeFiles(files) {
  for (const file of files) {
    if (!file.name.toLowerCase().endsWith('.pdf')) continue;
    mergeFiles.push({ name: file.name, file: file });
    renderMergePreview();
  }
}

function renderMergePreview() {
  const list = $('mergePreviewList');
  if (!list) return;
  list.innerHTML = '';
  
  mergeFiles.forEach((pdf, idx) => {
    const item = document.createElement('div');
    item.className = 'preview-item';
    item.draggable = true;
    item.dataset.idx = idx;
    item.innerHTML = `<span class="name">📄 ${pdf.name}</span><button class="remove-btn" data-idx="${idx}">×</button>`;
    list.appendChild(item);
  });
  
  list.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', () => { mergeFiles.splice(parseInt(btn.dataset.idx), 1); renderMergePreview(); });
  });
}

async function mergePdfs() {
  if (mergeFiles.length < 2) {
    showStatus('Añade al menos 2 PDFs para juntar', 'error');
    return;
  }
  
  const btn = $('btnMergePdfs');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="btn-loader"></span> Juntando...'; }
  
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
    showStatus('Error: ' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = 'Juntar PDFs'; }
  }
}

// ============================================
// CLIPBOARD - Copy/Paste Elements Between Docs
// ============================================

function copyCurrentPageElements() {
  const activeDoc = getActiveDoc();
  if (!activeDoc) {
    showStatus('Primero carga un PDF', 'error');
    return;
  }
  
  const pageElements = activeDoc.elements[activeDoc.currentPage] || [];
  
  if (pageElements.length === 0) {
    showStatus('No hay elementos en esta página para copiar', 'error');
    return;
  }
  
  // Deep copy elements
  clipboardElements = JSON.parse(JSON.stringify(pageElements));
  
  updateClipboardUI();
  showStatus(`${pageElements.length} elemento(s) copiado(s) al portapapeles`, 'success');
}

function pasteElementsToCurrentPage() {
  const activeDoc = getActiveDoc();
  if (!activeDoc) {
    showStatus('Primero carga un PDF', 'error');
    return;
  }
  
  if (!clipboardElements || clipboardElements.length === 0) {
    showStatus('No hay elementos en el portapapeles', 'error');
    return;
  }
  
  // Paste elements with offset to avoid overlap
  const offset = 20;
  const pastedElements = JSON.parse(JSON.stringify(clipboardElements));
  
  pastedElements.forEach((el, index) => {
    // Add offset to position
    el.x = Math.min(el.x + (offset * (index % 5)), activeDoc.pageWidth - 100);
    el.y = Math.min(el.y + (offset * Math.floor(index / 5)), activeDoc.pageHeight - 50);
    
    // Add to current page
    if (!activeDoc.elements[activeDoc.currentPage]) {
      activeDoc.elements[activeDoc.currentPage] = [];
    }
    activeDoc.elements[activeDoc.currentPage].push(el);
  });
  
  updateTabModified(activeDoc.id, true);
  renderPage();
  showStatus(`${pastedElements.length} elemento(s) pegado(s)`, 'success');
}

function clearClipboard() {
  clipboardElements = null;
  updateClipboardUI();
  showStatus('Portapapeles limpiado', 'success');
}

function updateClipboardUI() {
  const clipboardInfo = $('clipboardInfo');
  const clipboardCount = $('clipboardCount');
  const btnPasteElements = $('btnPasteElements');
  const btnClearClipboard = $('btnClearClipboard');
  
  if (clipboardElements && clipboardElements.length > 0) {
    if (clipboardInfo) clipboardInfo.style.display = 'block';
    if (clipboardCount) clipboardCount.textContent = `${clipboardElements.length} elementos copiados`;
    if (btnPasteElements) btnPasteElements.disabled = false;
    if (btnClearClipboard) btnClearClipboard.style.display = 'flex';
  } else {
    if (clipboardInfo) clipboardInfo.style.display = 'none';
    if (btnPasteElements) btnPasteElements.disabled = true;
    if (btnClearClipboard) btnClearClipboard.style.display = 'none';
  }
}
