// ============================================
// PDF EDITOR FULL SCREEN - AGENDA STAFF v8.1.0
// Fixed: Auth, Natural signatures, PDF protection (encryption + permissions)
// ============================================

// ============================================
// CONSTANTS
// ============================================
const DEFAULT_FONT_SIZE = 14;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 72;
const MIN_ELEMENT_SIZE = 20;
const RESIZE_SENSITIVITY = 200;
const STATUS_MSG_DURATION_MS = 3000;
const MULTI_FILE_LOAD_DELAY_MS = 150;
const MAX_SIGNATURE_SIZE = 400;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 2.5;
const MAX_UNDO_STATES = 30;
const PASTE_OFFSET = 30;

// Signature processing settings
const SIG_WHITE_THRESHOLD = 230;   // Pixels above this (per channel) are treated as "white"
const SIG_FEATHER_RADIUS = 1;      // Edge feather radius in pixels
const SIG_INK_VARIANCE = 0.06;     // Max opacity random variance (simulates real ink)

// SUPABASE_URL and SUPABASE_KEY are loaded from supabase-config.js (loaded before this script)
// Do NOT redefine them here.

// Multi-document state
let documents = [];
let activeDocIndex = -1;
let tabCounter = 0;

// ============================================
// #20 COLLAPSIBLE SIDEBAR STATE
// ============================================
let sidebarCollapsed = localStorage.getItem('pe_sidebarCollapsed') === 'true';

// ============================================
// #21 DRAWING TOOL STATE
// ============================================
let isDrawMode = false;
let drawPaths = [];
let drawCurrentPath = [];
let drawStrokeColor = '#000000';
let drawStrokeWidth = 2;
let drawCanvasOverlay = null;

// ============================================
// #22 SHAPE TOOL STATE
// ============================================
let shapeMode = null; // 'rect', 'line', 'arrow' or null
let shapeStartX = 0;
let shapeStartY = 0;
let shapeIsDrawing = false;

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

// ============================================
// UNDO / REDO SYSTEM
// ============================================
let undoStacks = {};   // { [docId]: [ { action, page, element, index, prevProps }, ... ] }
let redoStacks = {};   // { [docId]: [ { action, page, element, index, prevProps }, ... ] }
const MAX_UNDO = 50;

function pushUndo(docId, action) {
  if (!undoStacks[docId]) undoStacks[docId] = [];
  if (!redoStacks[docId]) redoStacks[docId] = [];
  undoStacks[docId].push(action);
  if (undoStacks[docId].length > MAX_UNDO) undoStacks[docId].shift();
  // Clear redo on new action
  redoStacks[docId] = [];
  updateUndoRedoUI();
}

function undo() {
  const activeDoc = getActiveDoc();
  if (!activeDoc) return;
  const stack = undoStacks[activeDoc.id];
  if (!stack || stack.length === 0) { showStatus('Nada que deshacer', 'error'); return; }
  const action = stack.pop();
  const redoAction = executeUndoAction(action, activeDoc);
  if (!redoStacks[activeDoc.id]) redoStacks[activeDoc.id] = [];
  redoStacks[activeDoc.id].push(redoAction);
  updateTabModified(activeDoc.id, true);
  renderPage();
  updateUndoRedoUI();
  autoSave();
  showStatus('Deshacer', 'success');
}

function redo() {
  const activeDoc = getActiveDoc();
  if (!activeDoc) return;
  const stack = redoStacks[activeDoc.id];
  if (!stack || stack.length === 0) { showStatus('Nada que rehacer', 'error'); return; }
  const action = stack.pop();
  const undoAction = executeUndoAction(action, activeDoc);
  if (!undoStacks[activeDoc.id]) undoStacks[activeDoc.id] = [];
  undoStacks[activeDoc.id].push(undoAction);
  updateTabModified(activeDoc.id, true);
  renderPage();
  updateUndoRedoUI();
  autoSave();
  showStatus('Rehacer', 'success');
}

function executeUndoAction(action, activeDoc) {
  // Returns the inverse action for redo
  const pageElements = activeDoc.elements[action.page] || [];
  switch (action.type) {
    case 'add': {
      // Undo add = remove the element
      const el = pageElements[action.index];
      const removed = pageElements.splice(action.index, 1);
      return { type: 'add', page: action.page, index: action.index, element: removed[0] };
    }
    case 'delete': {
      // Undo delete = re-insert the element
      pageElements.splice(action.index, 0, action.element);
      return { type: 'delete', page: action.page, index: action.index, element: action.element };
    }
    case 'move': {
      // Undo move = restore previous position
      const el = pageElements[action.index];
      if (el) {
        const prev = { x: el.x, y: el.y };
        el.x = action.prevProps.x;
        el.y = action.prevProps.y;
        return { type: 'move', page: action.page, index: action.index, prevProps: prev };
      }
      return action;
    }
    case 'resize': {
      // Undo resize = restore previous dimensions
      const el = pageElements[action.index];
      if (el) {
        const prev = { ...action.currentProps };
        if (el.type === 'text') {
          el.size = action.prevProps.size;
        } else {
          el.x = action.prevProps.x;
          el.y = action.prevProps.y;
          el.width = action.prevProps.width;
          el.height = action.prevProps.height;
        }
        return { type: 'resize', page: action.page, index: action.index, prevProps: action.prevProps, currentProps: prev };
      }
      return action;
    }
    case 'clear': {
      // Undo clear = restore all elements
      activeDoc.elements[action.page] = JSON.parse(JSON.stringify(action.elements));
      return { type: 'clear', page: action.page, elements: [] };
    }
    case 'edit': {
      // Undo edit = restore previous text/size/color
      const el = pageElements[action.index];
      if (el) {
        const prev = { text: el.text, size: el.size, color: el.color };
        el.text = action.prevProps.text;
        el.size = action.prevProps.size;
        el.color = action.prevProps.color;
        return { type: 'edit', page: action.page, index: action.index, prevProps: action.prevProps, currentProps: prev };
      }
      return action;
    }
    case 'multiMove': {
      // Undo multi-move = restore all previous positions
      const movedElements = action.elements;
      movedElements.forEach(item => {
        const el = pageElements[item.index];
        if (el) { el.x -= item.dx; el.y -= item.dy; }
      });
      return { type: 'multiMove', page: action.page, elements: movedElements.map(m => ({ index: m.index, dx: -m.dx, dy: -m.dy })) };
    }
    default:
      return action;
  }
}

function updateUndoRedoUI() {
  const activeDoc = getActiveDoc();
  const undoBtn = $('btnUndo');
  const redoBtn = $('btnRedo');
  if (activeDoc) {
    const undoCount = (undoStacks[activeDoc.id] || []).length;
    const redoCount = (redoStacks[activeDoc.id] || []).length;
    if (undoBtn) undoBtn.disabled = undoCount === 0;
    if (redoBtn) redoBtn.disabled = redoCount === 0;
    if (undoBtn) undoBtn.title = `Deshacer (${undoCount})`;
    if (redoBtn) redoBtn.title = `Rehacer (${redoCount})`;
  } else {
    if (undoBtn) undoBtn.disabled = true;
    if (redoBtn) redoBtn.disabled = true;
  }
}

// ============================================
// MULTI-SELECT SYSTEM
// ============================================
let selectedIndices = new Set();  // Set of element indices currently selected
let isBoxSelecting = false;
let boxSelectStart = { x: 0, y: 0 };
let boxSelectRect = null;  // DOM element for the selection rectangle
let isDraggingMulti = false;
let multiDragStart = { x: 0, y: 0 };
let multiDragOrigPositions = [];  // [{index, x, y}, ...]

function clearSelection() {
  selectedIndices.clear();
  document.querySelectorAll('.pdf-element.multi-selected').forEach(el => el.classList.remove('multi-selected'));
  if (boxSelectRect) { boxSelectRect.remove(); boxSelectRect = null; }
}

function selectElementIdx(idx) {
  if (idx < 0) return;
  selectedIndices.add(idx);
  const div = document.querySelector(`.pdf-element[data-idx="${idx}"]`);
  if (div) div.classList.add('multi-selected');
  updateMultiSelectUI();
}

function deselectElementIdx(idx) {
  if (idx < 0) return;
  selectedIndices.delete(idx);
  const div = document.querySelector(`.pdf-element[data-idx="${idx}"]`);
  if (div) div.classList.remove('multi-selected');
  updateMultiSelectUI();
}

function toggleMultiSelect(idx) {
  const activeDoc = getActiveDoc();
  if (!activeDoc) return;
  const pageElements = activeDoc.elements[activeDoc.currentPage] || [];
  if (idx < 0 || idx >= pageElements.length) return;

  if (selectedIndices.has(idx)) {
    selectedIndices.delete(idx);
  } else {
    selectedIndices.add(idx);
  }
  // Update DOM
  document.querySelectorAll('.pdf-element').forEach(div => {
    const divIdx = parseInt(div.dataset.idx);
    if (selectedIndices.has(divIdx)) {
      div.classList.add('multi-selected');
    } else {
      div.classList.remove('multi-selected');
    }
  });
  updateMultiSelectUI();
}

function updateMultiSelectUI() {
  const count = selectedIndices.size;
  const info = $('multiSelectInfo');
  const deleteBtn = $('btnDeleteSelected');
  const copyBtn = $('btnCopySelected');
  if (info) info.textContent = count > 0 ? `${count} elemento(s) seleccionado(s)` : '';
  if (info) info.style.display = count > 0 ? 'block' : 'none';
  if (deleteBtn) deleteBtn.style.display = count > 0 ? 'flex' : 'none';
  if (copyBtn) copyBtn.style.display = count > 0 ? 'flex' : 'none';
}

function deleteSelectedElements() {
  const activeDoc = getActiveDoc();
  if (!activeDoc) return;
  const pageElements = activeDoc.elements[activeDoc.currentPage] || [];
  if (selectedIndices.size === 0) return;

  if (!confirm(`¿Eliminar ${selectedIndices.size} elemento(s) seleccionado(s)?`)) return;

  // Sort indices descending so splicing doesn't shift indices
  const sortedIndices = Array.from(selectedIndices).sort((a, b) => b - a);
  sortedIndices.forEach(idx => {
    const el = pageElements[idx];
    if (el) pushUndo(activeDoc.id, { type: 'delete', page: activeDoc.currentPage, index: idx, element: JSON.parse(JSON.stringify(el)) });
    pageElements.splice(idx, 1);
  });
  clearSelection();
  updateTabModified(activeDoc.id, true);
  renderPage();
  autoSave();
}

// ============================================
// BOX SELECTION SYSTEM
// ============================================
let boxSelectJustFinished = false;  // Flag to prevent click from clearing box selection

function startBoxSelection(e, overlay, scale, activeDoc) {
  if (e.target.closest('.pdf-element') || e.target.closest('.resize-handle')) return;
  if (e.shiftKey) return;
  
  isBoxSelecting = true;
  boxSelectJustFinished = false;
  clearSelection();
  
  const rect = overlay.getBoundingClientRect();
  boxSelectStart.x = e.clientX;
  boxSelectStart.y = e.clientY;
  
  boxSelectRect = document.createElement('div');
  boxSelectRect.className = 'box-selection-rect';
  boxSelectRect.style.left = '0px';
  boxSelectRect.style.top = '0px';
  boxSelectRect.style.width = '0px';
  boxSelectRect.style.height = '0px';
  overlay.appendChild(boxSelectRect);
  
  e.preventDefault(); // Prevent text selection during drag
  
  const onMove = (ev) => {
    if (!isBoxSelecting || !boxSelectRect) return;
    ev.preventDefault();
    const x1 = Math.min(boxSelectStart.x, ev.clientX);
    const y1 = Math.min(boxSelectStart.y, ev.clientY);
    const x2 = Math.max(boxSelectStart.x, ev.clientX);
    const y2 = Math.max(boxSelectStart.y, ev.clientY);
    const left = Math.max(0, x1 - rect.left);
    const top = Math.max(0, y1 - rect.top);
    const width = Math.min(x2 - rect.left, rect.width) - left;
    const height = Math.min(y2 - rect.top, rect.height) - top;
    boxSelectRect.style.left = left + 'px';
    boxSelectRect.style.top = top + 'px';
    boxSelectRect.style.width = Math.max(0, width) + 'px';
    boxSelectRect.style.height = Math.max(0, height) + 'px';
  };
  
  const onUp = (ev) => {
    if (!isBoxSelecting) return;
    isBoxSelecting = false;
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    
    if (boxSelectRect) {
      const selRect = boxSelectRect.getBoundingClientRect();
      const boxLeft = selRect.left;
      const boxTop = selRect.top;
      const boxRight = selRect.right;
      const boxBottom = selRect.bottom;
      
      if (Math.abs(ev.clientX - boxSelectStart.x) < 5 && Math.abs(ev.clientY - boxSelectStart.y) < 5) {
        boxSelectRect.remove();
        boxSelectRect = null;
        return;
      }
      
      const pageElements = activeDoc.elements[activeDoc.currentPage] || [];
      let selectedCount = 0;
      document.querySelectorAll('.pdf-element').forEach(div => {
        const divIdx = parseInt(div.dataset.idx);
        const elRect = div.getBoundingClientRect();
        const overlaps = !(elRect.right < boxLeft || elRect.left > boxRight || elRect.bottom < boxTop || elRect.top > boxBottom);
        if (overlaps && divIdx < pageElements.length) {
          selectElementIdx(divIdx);
          selectedCount++;
        }
      });
      
      // If elements were selected, prevent the next click from clearing them
      if (selectedCount > 0) {
        boxSelectJustFinished = true;
        setTimeout(() => { boxSelectJustFinished = false; }, 300);
      }
      
      boxSelectRect.remove();
      boxSelectRect = null;
    }
  };
  
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// ============================================
// MULTI-DRAG SYSTEM (move all selected elements together)
// ============================================
function startMultiDrag(e, scale, activeDoc) {
  if (selectedIndices.size === 0) return;
  
  isDraggingMulti = true;
  multiDragStart.x = e.clientX;
  multiDragStart.y = e.clientY;
  
  const pageElements = activeDoc.elements[activeDoc.currentPage] || [];
  multiDragOrigPositions = [];
  selectedIndices.forEach(idx => {
    const el = pageElements[idx];
    if (el) multiDragOrigPositions.push({ index: idx, x: el.x, y: el.y });
  });
  
  const onMove = (ev) => {
    if (!isDraggingMulti) return;
    const dx = (ev.clientX - multiDragStart.x) / scale;
    const dy = (ev.clientY - multiDragStart.y) / scale;
    multiDragOrigPositions.forEach(orig => {
      const div = document.querySelector(`.pdf-element[data-idx="${orig.index}"]`);
      if (div) {
        div.style.left = ((orig.x + dx) * scale) + 'px';
        div.style.top = ((orig.y + dy) * scale) + 'px';
      }
    });
  };
  
  const onUp = (ev) => {
    if (!isDraggingMulti) return;
    isDraggingMulti = false;
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    
    const dx = (ev.clientX - multiDragStart.x) / scale;
    const dy = (ev.clientY - multiDragStart.y) / scale;
    
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      const undoMoves = multiDragOrigPositions.map(orig => ({ index: orig.index, dx: dx, dy: dy }));
      pushUndo(activeDoc.id, { type: 'multiMove', page: activeDoc.currentPage, elements: undoMoves });
      
      const pageElements = activeDoc.elements[activeDoc.currentPage] || [];
      multiDragOrigPositions.forEach(orig => {
        const el = pageElements[orig.index];
        if (el) { el.x = orig.x + dx; el.y = orig.y + dy; }
      });
      updateTabModified(activeDoc.id, true);
      scheduleAutoSave();
    }
  };
  
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// ============================================
// AUTO-SAVE SYSTEM
// ============================================
let autoSaveTimer = null;
let isAutoSaving = false;
const AUTO_SAVE_DELAY = 3000; // 3 seconds after last change

function scheduleAutoSave() {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(autoSave, AUTO_SAVE_DELAY);
}

async function autoSave() {
  const activeDoc = getActiveDoc();
  if (!activeDoc || isAutoSaving) return;

  // Check if any document has elements
  let hasElements = false;
  const saveData = {};
  documents.forEach(doc => {
    const docElements = {};
    let docHasElements = false;
    for (const page in doc.elements) {
      if (doc.elements[page].length > 0) {
        docElements[page] = doc.elements[page];
        docHasElements = true;
        hasElements = true;
      }
    }
    if (docHasElements) {
      saveData[doc.id] = {
        elements: docElements,
        currentPage: doc.currentPage,
        fileName: doc.fileName
      };
    }
  });

  if (!hasElements) return;

  isAutoSaving = true;
  try {
    await chrome.storage.local.set({ pdfEditorAutoSave: saveData, pdfEditorAutoSaveTime: Date.now() });
    const indicator = $('autoSaveIndicator');
    if (indicator) {
      indicator.textContent = '✓ Guardado';
      indicator.classList.add('auto-saved');
      setTimeout(() => { indicator.textContent = ''; indicator.classList.remove('auto-saved'); }, 2000);
    }
  } catch (err) {
    console.error('Auto-save error:', err);
  }
  isAutoSaving = false;
}

async function restoreAutoSave() {
  try {
    const stored = await chrome.storage.local.get(['pdfEditorAutoSave', 'pdfEditorAutoSaveTime']);
    if (!stored.pdfEditorAutoSave) return;
    const saveTime = stored.pdfEditorAutoSaveTime ? new Date(stored.pdfEditorAutoSaveTime) : null;
    const timeStr = saveTime ? ` (${saveTime.toLocaleTimeString()})` : '';

    // Check if any saved data matches currently open documents
    let restored = false;
    for (const docId in stored.pdfEditorAutoSave) {
      const doc = documents.find(d => d.id === docId);
      if (doc) {
        const saved = stored.pdfEditorAutoSave[docId];
        for (const page in saved.elements) {
          doc.elements[parseInt(page)] = saved.elements[page];
        }
        doc.currentPage = saved.currentPage || doc.currentPage;
        restored = true;
      }
    }

    if (restored) {
      showStatus(`Estado anterior restaurado${timeStr}`, 'success');
      updateTabModified(getActiveDoc().id, true);
      renderPage();
    }

    // Clean old auto-save data
    await chrome.storage.local.remove(['pdfEditorAutoSave', 'pdfEditorAutoSaveTime']);
  } catch (err) {
    console.error('Auto-restore error:', err);
  }
}

// Helper function
const $ = id => document.getElementById(id);

// Helper: push element and record undo
function pushElement(doc, page, element) {
  if (!doc.elements[page]) doc.elements[page] = [];
  const idx = doc.elements[page].push(element) - 1;
  pushUndo(doc.id, { type: 'add', page: page, index: idx, element: JSON.parse(JSON.stringify(element)) });
  return idx;
}

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
    setTimeout(() => el.classList.remove('show'), STATUS_MSG_DURATION_MS);
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
  
  // Delegated dblclick handler on canvasArea (M9: avoids re-attaching on every render)
  const canvasArea = $('canvasArea');
  if (canvasArea) {
    canvasArea.addEventListener('dblclick', (e) => {
      const activeDoc = getActiveDoc();
      if (!activeDoc || !activeDoc.pdfJsDoc) return;
      if (e.target.classList.contains('pdf-element') || e.target.closest('.pdf-element')) return;
      
      const overlay = canvasArea.querySelector('.elements-overlay');
      if (!overlay) return;
      
      const scale = activeDoc.zoom;
      const rect = overlay.getBoundingClientRect();
      const x = (e.clientX - rect.left) / scale;
      const y = (e.clientY - rect.top) / scale;
      
      const textInput = $('textInput');
      const textSize = $('textSize');
      const textColor = $('textColor');
      const textModal = $('textModal');
      
      if (textInput) textInput.value = '';
      if (textSize) textSize.value = DEFAULT_FONT_SIZE;
      if (textColor) textColor.value = '#000000';
      // #25 Reset rich text for dblclick new text
      setRichTextState(false, false, false);
      if (textModal) {
        textModal.classList.add('show');
        textModal.dataset.posX = x;
        textModal.dataset.posY = y;
      }
      if (textInput) textInput.focus();
    });
  }
  
  // Try to restore auto-saved state after a short delay (wait for PDFs to load)
  setTimeout(restoreAutoSave, 1500);
  
  // #20 Apply initial sidebar state
  applySidebarState();
  
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
  
  // #20 Sidebar toggle
  const btnSidebarToggle = $('btnSidebarToggle');
  if (btnSidebarToggle) btnSidebarToggle.addEventListener('click', toggleSidebar);
  
  // #21 Drawing tool buttons
  const btnDraw = $('btnDraw');
  if (btnDraw) btnDraw.addEventListener('click', enterDrawMode);
  const btnDrawClear = $('btnDrawClear');
  if (btnDrawClear) btnDrawClear.addEventListener('click', clearDrawing);
  const btnDrawConfirm = $('btnDrawConfirm');
  if (btnDrawConfirm) btnDrawConfirm.addEventListener('click', confirmDrawing);
  
  // #22 Shape tool buttons
  const btnShapeRect = $('btnShapeRect');
  if (btnShapeRect) btnShapeRect.addEventListener('click', () => enterShapeMode('rect'));
  const btnShapeLine = $('btnShapeLine');
  if (btnShapeLine) btnShapeLine.addEventListener('click', () => enterShapeMode('line'));
  const btnShapeArrow = $('btnShapeArrow');
  if (btnShapeArrow) btnShapeArrow.addEventListener('click', () => enterShapeMode('arrow'));
  
  // #25 Rich text toggle buttons
  const btnBold = $('btnBold');
  if (btnBold) btnBold.addEventListener('click', () => btnBold.classList.toggle('active'));
  const btnItalic = $('btnItalic');
  if (btnItalic) btnItalic.addEventListener('click', () => btnItalic.classList.toggle('active'));
  const btnUnderline = $('btnUnderline');
  if (btnUnderline) btnUnderline.addEventListener('click', () => btnUnderline.classList.toggle('active'));
  
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

  // Undo/Redo buttons
  const btnUndo = $('btnUndo');
  if (btnUndo) btnUndo.addEventListener('click', undo);
  const btnRedo = $('btnRedo');
  if (btnRedo) btnRedo.addEventListener('click', redo);

  // Multi-select action buttons
  const btnDeleteSelected = $('btnDeleteSelected');
  if (btnDeleteSelected) btnDeleteSelected.addEventListener('click', deleteSelectedElements);
  const btnCopySelected = $('btnCopySelected');
  if (btnCopySelected) btnCopySelected.addEventListener('click', copySelectedElements);

  // Copy selector modal
  const btnCopySelector = $('btnCopySelector');
  if (btnCopySelector) btnCopySelector.addEventListener('click', showCopySelector);
  const confirmCopySelectorBtn = $('confirmCopySelectorBtn');
  if (confirmCopySelectorBtn) confirmCopySelectorBtn.addEventListener('click', confirmCopySelector);
  const closeCopySelectorBtn = $('closeCopySelectorBtn');
  if (closeCopySelectorBtn) closeCopySelectorBtn.addEventListener('click', closeCopySelector);

  // Date count modal
  const btnConfirmDateCount = $('btnConfirmDateCount');
  if (btnConfirmDateCount) btnConfirmDateCount.addEventListener('click', confirmAddDates);
  const btnCancelDateCount = $('btnCancelDateCount');
  if (btnCancelDateCount) btnCancelDateCount.addEventListener('click', () => {
    const dateCountModal = $('dateCountModal');
    if (dateCountModal) dateCountModal.classList.remove('show');
  });
  // Enter key in date count input
  const dateCountInput = $('dateCountInput');
  if (dateCountInput) {
    dateCountInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') confirmAddDates();
    });
  }

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // #21 Enter in draw mode = confirm drawing
    if (e.key === 'Enter' && isDrawMode && !e.target.closest('input, textarea, select')) {
      e.preventDefault();
      confirmDrawing();
      return;
    }
    // Escape in draw/shape mode = exit
    if (e.key === 'Escape' && isDrawMode) {
      exitDrawMode();
      return;
    }
    if (e.key === 'Escape' && shapeMode) {
      exitShapeMode();
      return;
    }
    
    // Ctrl+Z = Undo
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault(); undo();
    }
    // Ctrl+Y or Ctrl+Shift+Z = Redo
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault(); redo();
    }
    // Delete key = delete selected or auto-detect single element
    if (e.key === 'Delete' && !e.target.closest('input, textarea, select')) {
      if (selectedIndices.size > 0) {
        deleteSelectedElements();
      }
    }
    // Escape = clear multi-selection
    if (e.key === 'Escape') {
      clearSelection();
    }
  });

  // Click on overlay clears multi-selection (but not right after a box selection)
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('elements-overlay') && !boxSelectJustFinished) {
      clearSelection();
    }
  });

  // Close text modal: also reset editing state
  const cancelTextBtn = $('cancelText');
  if (cancelTextBtn) {
    cancelTextBtn.addEventListener('click', () => {
      $('textModal').classList.remove('show');
      const editingIdx = $('editingElementIdx');
      if (editingIdx) editingIdx.value = '';
    });
  }
  // Re-assign confirmText to handle both add and edit
  const confirmTextBtn2 = $('confirmText');
  if (confirmTextBtn2) confirmTextBtn2.addEventListener('click', confirmTextWithPosition);
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
    }, index * MULTI_FILE_LOAD_DELAY_MS);
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
    <span class="doc-tab-name">${escapeHtml(doc.fileName)}</span>
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
  
  // Use data attribute instead of fragile string manipulation
  if (hasChanges) {
    tab.dataset.modified = 'true';
  } else {
    delete tab.dataset.modified;
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
      if (tool === 'pages') renderPageThumbnails();
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
  clearSelection();
  updateMultiSelectUI();
  updateUndoRedoUI();
  
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
    
    // dblclick handler is now delegated on canvasArea (M9) — no inline listener here
    
    // Mousedown on overlay starts box selection (or shape drawing)
    overlay.addEventListener('mousedown', (e) => {
      // #22 Shape mode: handle shape drawing on overlay
      if (shapeMode) {
        onShapeMouseDown(e);
        return;
      }
      // Don't start box selection in draw mode
      if (isDrawMode) return;
      
      if (e.target === overlay || e.target.classList.contains('elements-overlay')) {
        // If clicking on empty area while elements are selected, clear selection
        if (selectedIndices.size > 0 && !boxSelectJustFinished) {
          clearSelection();
          return;
        }
        startBoxSelection(e, overlay, scale, activeDoc);
      }
    });
    
    // #22 Shape mouse move/up on overlay
    overlay.addEventListener('mousemove', (e) => {
      if (shapeMode) onShapeMouseMove(e);
    });
    overlay.addEventListener('mouseup', (e) => {
      if (shapeMode) onShapeMouseUp(e);
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
    // Create text span (not using textContent to allow child elements)
    const textSpan = document.createElement('span');
    textSpan.textContent = el.text;
    div.appendChild(textSpan);
    div.style.fontSize = ((el.size || 14) * scale) + 'px';
    div.style.color = el.color || '#000';
    div.style.minWidth = MIN_ELEMENT_SIZE + 'px';
    div.style.minHeight = MIN_ELEMENT_SIZE + 'px';
    
    // #25 Rich text styles
    if (el.bold) div.style.fontWeight = 'bold';
    if (el.italic) div.style.fontStyle = 'italic';
    if (el.underline) div.style.textDecoration = 'underline';
    
    // Show name label for DNI/NIE texts (like signatures)
    if (el.name) {
      const nameLabel = document.createElement('div');
      nameLabel.className = 'text-name-label';
      nameLabel.textContent = el.name;
      div.appendChild(nameLabel);
      div.title = `DNI de: ${el.name}`;
    }
  } else if (el.type === 'image' || el.type === 'signature' || el.type === 'drawing') {
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
    if (el.type === 'drawing') {
      div.title = 'Dibujo';
    }
  } else if (el.type === 'shape') {
    // #22 Render shape as SVG
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', Math.max(1, el.width * scale));
    svg.setAttribute('height', Math.max(1, el.height * scale));
    svg.style.overflow = 'visible';
    
    const strokeColor = el.strokeColor || '#000000';
    const strokeWidth = el.strokeWidth || 2;
    const fillColor = el.fillColor || 'transparent';
    
    if (el.shape === 'rect') {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', '0');
      rect.setAttribute('y', '0');
      rect.setAttribute('width', Math.max(1, el.width * scale));
      rect.setAttribute('height', Math.max(1, el.height * scale));
      rect.setAttribute('fill', fillColor);
      rect.setAttribute('stroke', strokeColor);
      rect.setAttribute('stroke-width', strokeWidth);
      svg.appendChild(rect);
    } else if (el.shape === 'line') {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      const sx = (el.startX - el.x) * scale;
      const sy = (el.startY - el.y) * scale;
      const ex = (el.endX - el.x) * scale;
      const ey = (el.endY - el.y) * scale;
      line.setAttribute('x1', sx);
      line.setAttribute('y1', sy);
      line.setAttribute('x2', ex);
      line.setAttribute('y2', ey);
      line.setAttribute('stroke', strokeColor);
      line.setAttribute('stroke-width', strokeWidth);
      svg.appendChild(line);
    } else if (el.shape === 'arrow') {
      const sx = (el.startX - el.x) * scale;
      const sy = (el.startY - el.y) * scale;
      const ex = (el.endX - el.x) * scale;
      const ey = (el.endY - el.y) * scale;
      
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', sx);
      line.setAttribute('y1', sy);
      line.setAttribute('x2', ex);
      line.setAttribute('y2', ey);
      line.setAttribute('stroke', strokeColor);
      line.setAttribute('stroke-width', strokeWidth);
      svg.appendChild(line);
      
      // Arrowhead
      const dx = ex - sx;
      const dy = ey - sy;
      const len = Math.sqrt(dx * dx + dy * dy);
      const arrowSize = Math.min(12, len * 0.15);
      const angle = Math.atan2(dy, dx);
      const ax1 = ex - arrowSize * Math.cos(angle - Math.PI / 6);
      const ay1 = ey - arrowSize * Math.sin(angle - Math.PI / 6);
      const ax2 = ex - arrowSize * Math.cos(angle + Math.PI / 6);
      const ay2 = ey - arrowSize * Math.sin(angle + Math.PI / 6);
      
      const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      polygon.setAttribute('points', `${ex},${ey} ${ax1},${ay1} ${ax2},${ay2}`);
      polygon.setAttribute('fill', strokeColor);
      svg.appendChild(polygon);
    }
    
    div.appendChild(svg);
    div.style.width = Math.max(1, el.width * scale) + 'px';
    div.style.height = Math.max(1, el.height * scale) + 'px';
  }
  
  // Multi-select: Shift+click to toggle selection
  div.addEventListener('click', (e) => {
    if (e.shiftKey) {
      e.stopPropagation();
      toggleMultiSelect(idx);
      return;
    }
  });

  // Double click on text element: open edit modal
  if (el.type === 'text') {
    div.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      openEditTextModal(idx, activeDoc, scale);
    });
  }

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'pdf-element-delete';
  deleteBtn.textContent = '✕';
  deleteBtn.onclick = (e) => {
    e.stopPropagation();
    pushUndo(activeDoc.id, { type: 'delete', page: activeDoc.currentPage, index: idx, element: JSON.parse(JSON.stringify(el)) });
    activeDoc.elements[activeDoc.currentPage].splice(idx, 1);
    updateTabModified(activeDoc.id, true);
    renderPage();
    scheduleAutoSave();
  };
  div.appendChild(deleteBtn);
  
  const handles = ['nw', 'ne', 'sw', 'se'];
  handles.forEach(pos => {
    const handle = document.createElement('div');
    handle.className = `resize-handle resize-handle-${pos}`;
    handle.dataset.handle = pos;
    div.appendChild(handle);
  });
  
  makeDraggable(div, el, scale, activeDoc, idx);
  makeResizable(div, el, scale, activeDoc);
  
  return div;
}

// ============================================
// TEXT MODAL HELPERS
// ============================================

function openNewTextModal(x, y) {
  const textInput = $('textInput');
  const textSize = $('textSize');
  const textColor = $('textColor');
  const textModal = $('textModal');
  const textModalTitle = $('textModalTitle');
  const confirmBtn = $('confirmText');
  const editingIdx = $('editingElementIdx');
  
  if (textInput) textInput.value = '';
  if (textSize) textSize.value = 14;
  if (textColor) textColor.value = '#000000';
  if (textModalTitle) textModalTitle.textContent = '📝 Añadir texto';
  if (confirmBtn) confirmBtn.textContent = 'Añadir';
  if (editingIdx) editingIdx.value = '';
  // #25 Reset rich text state for new text
  setRichTextState(false, false, false);
  if (textModal) {
    textModal.classList.add('show');
    if (x !== undefined && y !== undefined) {
      textModal.dataset.posX = x;
      textModal.dataset.posY = y;
    } else {
      delete textModal.dataset.posX;
      delete textModal.dataset.posY;
    }
  }
  if (textInput) textInput.focus();
}

function openEditTextModal(idx, activeDoc, scale) {
  const pageElements = activeDoc.elements[activeDoc.currentPage] || [];
  if (idx < 0 || idx >= pageElements.length) return;
  const el = pageElements[idx];
  if (!el || el.type !== 'text') return;
  
  const textInput = $('textInput');
  const textSize = $('textSize');
  const textColor = $('textColor');
  const textModal = $('textModal');
  const textModalTitle = $('textModalTitle');
  const confirmBtn = $('confirmText');
  const editingIdx = $('editingElementIdx');
  
  if (textInput) textInput.value = el.text || '';
  if (textSize) textSize.value = el.size || 14;
  if (textColor) textColor.value = el.color || '#000000';
  if (textModalTitle) textModalTitle.textContent = '✏️ Editar texto';
  if (confirmBtn) confirmBtn.textContent = 'Guardar';
  if (editingIdx) editingIdx.value = idx;
  // #25 Set rich text state from element
  setRichTextState(!!el.bold, !!el.italic, !!el.underline);
  if (textModal) {
    delete textModal.dataset.posX;
    delete textModal.dataset.posY;
    textModal.classList.add('show');
  }
  if (textInput) { textInput.focus(); textInput.select(); }
}

function confirmTextWithPosition() {
  const activeDoc = getActiveDoc();
  if (!activeDoc) return;
  
  const textInput = $('textInput');
  const textSize = $('textSize');
  const textColor = $('textColor');
  const textModal = $('textModal');
  const editingIdxEl = $('editingElementIdx');
  
  const text = textInput ? textInput.value.trim() : '';
  const size = textSize ? parseInt(textSize.value) || DEFAULT_FONT_SIZE : DEFAULT_FONT_SIZE;
  const color = textColor ? textColor.value : '#000000';
  const editingIdx = editingIdxEl ? editingIdxEl.value : '';
  
  // #25 Read rich text state
  const richState = getRichTextState();
  
  if (!text) {
    showStatus('Escribe un texto', 'error');
    return;
  }
  
  // --- EDIT MODE: update existing text element ---
  if (editingIdx !== '' && editingIdx !== null && editingIdx !== undefined) {
    const idx = parseInt(editingIdx);
    const pageElements = activeDoc.elements[activeDoc.currentPage] || [];
    if (idx >= 0 && idx < pageElements.length && pageElements[idx].type === 'text') {
      const el = pageElements[idx];
      pushUndo(activeDoc.id, { type: 'edit', page: activeDoc.currentPage, index: idx, prevProps: { text: el.text, size: el.size, color: el.color } });
      el.text = text;
      el.size = size;
      el.color = color;
      el.bold = richState.bold;
      el.italic = richState.italic;
      el.underline = richState.underline;
      if (textModal) textModal.classList.remove('show');
      editingIdxEl.value = '';
      updateTabModified(activeDoc.id, true);
      renderPage();
      showStatus('Texto actualizado', 'success');
      return;
    }
  }
  
  // --- ADD MODE: create new text element(s) ---
  const posX = textModal && textModal.dataset.posX ? parseFloat(textModal.dataset.posX) : activeDoc.pageWidth / 2 - 50;
  const posY = textModal && textModal.dataset.posY ? parseFloat(textModal.dataset.posY) : activeDoc.pageHeight / 2;
  
  // Use shared DNI/NIE processing (from shared-utils.js)
  const { elements, totalCreated } = processTextWithDni(text, posX, posY, size, color);
  elements.forEach(el => {
    // #25 Apply rich text properties to created elements
    el.bold = richState.bold;
    el.italic = richState.italic;
    el.underline = richState.underline;
    activeDoc.elements[activeDoc.currentPage].push(el);
  });
  
  const lines = text.split(/\n|\r\n|\r/).map(l => l.trim()).filter(l => l);
  if (totalCreated > 1 && lines.length > 1) {
    showStatus(`${totalCreated} textos creados (${lines.length} líneas)`, 'success');
  } else if (totalCreated === 2) {
    showStatus('Texto separado: Nombre + DNI/NIE', 'success');
  }
  
  if (textModal) {
    textModal.classList.remove('show');
    delete textModal.dataset.posX;
    delete textModal.dataset.posY;
  }
  if (editingIdxEl) editingIdxEl.value = '';
  
  updateTabModified(activeDoc.id, true);
  renderPage();
}

function addCurrentDate() {
  const activeDoc = getActiveDoc();
  if (!activeDoc || !activeDoc.pdfJsDoc) {
    showStatus('Primero carga un PDF', 'error');
    return;
  }
  
  // Show quantity modal
  const dateCountModal = $('dateCountModal');
  if (dateCountModal) {
    const dateCountInput = $('dateCountInput');
    if (dateCountInput) dateCountInput.value = 1;
    dateCountModal.classList.add('show');
    if (dateCountInput) dateCountInput.focus();
  }
}

function confirmAddDates() {
  const activeDoc = getActiveDoc();
  if (!activeDoc || !activeDoc.pdfJsDoc) return;
  
  const dateCountInput = $('dateCountInput');
  const dateCountModal = $('dateCountModal');
  const count = dateCountInput ? parseInt(dateCountInput.value) || 1 : 1;
  
  if (count < 1 || count > 50) {
    showStatus('Introduce un número entre 1 y 50', 'error');
    return;
  }
  
  if (dateCountModal) dateCountModal.classList.remove('show');
  
  const today = new Date();
  const dateStr = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;
  
  const pageElements = activeDoc.elements[activeDoc.currentPage] || [];
  const baseX = activeDoc.pageWidth / 2 - 40;
  const baseY = activeDoc.pageHeight / 2;
  const spacing = 25; // vertical space between dates
  
  for (let i = 0; i < count; i++) {
    pushElement(activeDoc, activeDoc.currentPage, {
      type: 'text',
      text: dateStr,
      x: baseX,
      y: baseY + (i * spacing),
      size: 14,
      color: '#000000'
    });
  }
  
  updateTabModified(activeDoc.id, true);
  renderPage();
  showStatus(`${count} fecha(s) añadida(s): ${dateStr}`, 'success');
  scheduleAutoSave();
}

function makeDraggable(div, el, scale, activeDoc, idx) {
  let startX, startY, origX, origY;
  let hasMoved = false;
  
  // Handlers will be attached/removed on mousedown/mouseup to prevent memory leaks
  function onMouseMove(e) {
    hasMoved = true;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    div.style.left = (origX + dx) + 'px';
    div.style.top = (origY + dy) + 'px';
  }
  
  function onMouseUp(e) {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const newX = Math.max(0, (origX + dx) / scale);
    const newY = Math.max(0, (origY + dy) / scale);
    div.classList.remove('selected');
    
    // Record undo only if actually moved
    if (hasMoved) {
      const origElX = parseFloat(div.dataset.undoOrigX);
      const origElY = parseFloat(div.dataset.undoOrigY);
      const elIdx = parseInt(div.dataset.undoIdx);
      pushUndo(activeDoc.id, { type: 'move', page: activeDoc.currentPage, index: elIdx, prevProps: { x: origElX, y: origElY } });
      el.x = newX;
      el.y = newY;
      updateTabModified(activeDoc.id, true);
      scheduleAutoSave();
    }
  }
  
  div.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('pdf-element-delete') || e.target.classList.contains('resize-handle')) return;
    
    // If this element is already multi-selected, start multi-drag
    if (selectedIndices.has(idx)) {
      e.preventDefault();
      e.stopPropagation();
      startMultiDrag(e, scale, activeDoc);
      return;
    }
    
    if (e.shiftKey) return; // Let multi-select handle it
    
    hasMoved = false;
    startX = e.clientX;
    startY = e.clientY;
    origX = el.x * scale;
    origY = el.y * scale;
    // Record undo state for move
    div.dataset.undoOrigX = el.x;
    div.dataset.undoOrigY = el.y;
    div.dataset.undoIdx = div.dataset.idx;
    div.classList.add('selected');
    // Clear multi-selection when clicking without shift
    if (selectedIndices.size > 0 && !e.shiftKey) clearSelection();
    e.preventDefault();
    e.stopPropagation();
    
    // Attach document listeners only while dragging
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
}

function makeResizable(div, el, scale, activeDoc) {
  const handles = div.querySelectorAll('.resize-handle');
  let currentHandle = null;
  let startX, startY, startWidth, startHeight, startFontSize, startXPos, startYPos;
  let elIdx = parseInt(div.dataset.idx);
  
  // Handlers attached/removed on mousedown/mouseup to prevent memory leaks
  function onMouseMove(e) {
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    
    if (el.type === 'text') {
      const delta = Math.max(Math.abs(dx), Math.abs(dy));
      const scaleFactor = 1 + (dx > 0 ? delta / RESIZE_SENSITIVITY : -delta / RESIZE_SENSITIVITY);
      let newFontSize = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, startFontSize * scaleFactor));
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
  }
  
  function onMouseUp() {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    div.classList.remove('resizing');
    div.classList.remove('selected');
    
    // Record undo for resize
    if (el.type === 'text') {
      pushUndo(activeDoc.id, { type: 'resize', page: activeDoc.currentPage, index: elIdx, prevProps: { size: startFontSize }, currentProps: { size: el.size } });
    } else {
      pushUndo(activeDoc.id, { type: 'resize', page: activeDoc.currentPage, index: elIdx, prevProps: { x: startXPos, y: startYPos, width: startWidth, height: startHeight }, currentProps: { x: el.x, y: el.y, width: el.width, height: el.height } });
    }
    updateTabModified(activeDoc.id, true);
    showStatus('Tamaño actualizado', 'success');
    scheduleAutoSave();
  }
  
  handles.forEach(handle => {
    handle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      currentHandle = handle.dataset.handle;
      startX = e.clientX;
      startY = e.clientY;
      elIdx = parseInt(div.dataset.idx);
      
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
      
      // Attach document listeners only while resizing
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
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
  
  activeDoc.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, activeDoc.zoom + delta));
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
  if (textSize) textSize.value = DEFAULT_FONT_SIZE;
  if (textColor) textColor.value = '#000000';
  // #25 Reset rich text state for new text
  setRichTextState(false, false, false);
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
        
        pushElement(activeDoc, activeDoc.currentPage, {
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
  
  // #19 Render recent signatures
  renderRecentSignatures();
}

// removeDniNie and normalizeText moved to shared-utils.js

async function searchSignatures() {
  const signatureSearchInput = $('signatureSearchInput');
  const signatureResults = $('signatureResults');
  
  const searchInput = signatureSearchInput ? signatureSearchInput.value.trim() : '';
  
  if (!searchInput) {
    if (signatureResults) signatureResults.innerHTML = '<div class="signature-empty">Escribe un nombre para buscar</div>';
    return;
  }
  
  // Remove DNI/NIE from each search term automatically
  const searchTerms = searchInput.split('\n').map(term => removeDniNie(term.trim())).filter(term => term.length > 0);
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
      // Search with original term AND normalized (no accents) term for better matching
      const normalizedTerm = normalizeText(term);
      const searchValues = [term];
      if (normalizedTerm !== term) searchValues.push(normalizedTerm);
      
      for (const searchTerm of searchValues) {
        const query = `?select=*&name=ilike.*${encodeURIComponent(searchTerm)}*&order=name.asc`;
        const res = await fetch(`${SUPABASE_URL}/rest/v1/signatures${query}`, { headers });
        
        if (res.ok) {
          const signatures = await res.json();
          if (signatures && signatures.length > 0) {
            signatures.forEach(sig => {
              if (!allSignatures.find(s => s.id === sig.id)) {
                allSignatures.push(sig);
                foundNames.push(normalizeText(sig.name).toLowerCase());
              }
            });
          }
        }
      }
    }
    
    allSignatures.sort((a, b) => a.name.localeCompare(b.name));
    renderSignatureResultsWithMissing(allSignatures, searchTerms, foundNames);
    
  } catch (err) {
    console.error('Search error:', err);
    if (signatureResults) signatureResults.innerHTML = '<div class="signature-empty">Error: ' + escapeHtml(err.message) + '</div>';
  }
}

function renderSignatureResultsWithMissing(signatures, searchedTerms, foundNames) {
  const signatureResults = $('signatureResults');
  if (!signatureResults) return;
  
  const normalizedFoundNames = foundNames.map(n => n.toLowerCase());
  const missingNames = searchedTerms.filter(term => {
    const normalizedTerm = normalizeText(term).toLowerCase();
    return !normalizedFoundNames.some(found => found.includes(normalizedTerm) || normalizedTerm.includes(found));
  });
  
  let html = '';
  
  if (signatures.length > 0) {
    html += `<div class="signature-found-header">
      <span>✓ Encontradas (${signatures.length})</span>
      <button class="signature-add-all-btn" id="btnAddAllSignatures" title="Añadir todas las firmas al PDF">✓ Añadir todas</button>
    </div>`;
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
  
  // Add All Signatures button
  const btnAddAll = $('btnAddAllSignatures');
  if (btnAddAll && signatures.length > 0) {
    btnAddAll.addEventListener('click', (e) => {
      e.stopPropagation();
      signatures.forEach((sig, i) => {
        setTimeout(() => {
          selectSignature(sig.image_url, sig.name);
        }, i * 100); // Stagger adds to see each one
      });
    });
  }
}

async function deleteSignature(id, name) {
  console.log('Deleting signature:', id, name);
  
  try {
    const headers = {
      'apikey': SUPABASE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    };
    
    // Only use session token for Authorization - never anon key as Bearer (bypasses RLS)
    if (session && session.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
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
      
      // Only use session token for Authorization - never anon key as Bearer (bypasses RLS)
      if (session && session.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
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
  img.crossOrigin = 'anonymous';
  img.onload = async () => {
    let imgWidth = img.width;
    let imgHeight = img.height;
    const maxSize = 100;
    
    if (imgWidth > maxSize || imgHeight > maxSize) {
      const ratio = Math.min(maxSize / imgWidth, maxSize / imgHeight);
      imgWidth = Math.round(imgWidth * ratio);
      imgHeight = Math.round(imgHeight * ratio);
    }
    
    const offset = addedSignaturesCount * 15;
    
    // Process the signature image for natural appearance
    // (remove white bg, feather edges, ink variance)
    let processedSrc = url;
    try {
      processedSrc = await processSignatureImage(url);
    } catch (err) {
      console.warn('Could not pre-process signature, using original:', err);
    }
    
    pushElement(activeDoc, activeDoc.currentPage, {
      type: 'signature',
      src: processedSrc,
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
    
    // #19 Add to recent signatures
    addRecentSignature(name, url);
    
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

// escapeHtml moved to shared-utils.js

// ============================================
// SIGNATURE IMAGE PROCESSING
// Removes white backgrounds, feather edges, apply natural ink variance
// so signatures look like real pen strokes instead of pasted images.
// ============================================

/**
 * Process a signature image to make it look natural on a PDF.
 * Steps:
 * 1. Remove white/near-white background (make transparent)
 * 2. Feather edges for smooth blending
 * 3. Apply slight random opacity variance (simulates real ink)
 * Returns a PNG data URL.
 */
async function processSignatureImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      
      // Step 1: Remove white/near-white background
      // A pixel is "white" if all RGB channels are above the threshold
      removeWhiteBackground(data, canvas.width, canvas.height);
      
      // Step 2: Feather edges — smooth the alpha channel boundary
      // so signatures blend naturally with the document background
      featherEdges(data, canvas.width, canvas.height);
      
      // Step 3: Apply ink variance — slight random opacity variation
      // This makes the signature look like it was drawn with real ink
      applyInkVariance(data, canvas.width, canvas.height);
      
      ctx.putImageData(imageData, 0, 0);
      
      // Export as PNG (lossless, preserves transparency)
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => {
      // If processing fails, return original src
      console.warn('Signature processing failed, using original');
      resolve(src);
    };
    img.src = src;
  });
}

/**
 * Remove white/near-white background from image data.
 * Converts fully white pixels to transparent, and near-white pixels
 * to partially transparent based on how close they are to white.
 */
function removeWhiteBackground(data, width, height) {
  const threshold = SIG_WHITE_THRESHOLD;
  const thresholdRange = 255 - threshold; // e.g., 25 for threshold 230
  
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    
    if (a === 0) continue; // Already transparent
    
    // Check how "white" this pixel is
    const minChannel = Math.min(r, g, b);
    const maxChannel = Math.max(r, g, b);
    
    // If all channels are above threshold, it's white/near-white background
    if (minChannel >= threshold) {
      // Fully white → fully transparent
      // Near-white → partially transparent based on proximity to white
      const whiteness = (minChannel - threshold) / thresholdRange;
      data[i + 3] = Math.round(a * (1 - whiteness));
    }
    // If the pixel is light but has some color variation,
    // reduce opacity proportionally (handles light-colored scan artifacts)
    else if (maxChannel >= threshold && (maxChannel - minChannel) < 30) {
      const lightness = (maxChannel - threshold) / thresholdRange;
      const colorness = (maxChannel - minChannel) / 30;
      // Reduce opacity based on lightness but preserve some for colored pixels
      const reduction = lightness * (1 - colorness);
      data[i + 3] = Math.round(a * (1 - reduction * 0.8));
    }
  }
}

/**
 * Feather the edges of a signature for smooth blending.
 * Uses a simple alpha-smoothing pass on boundary pixels.
 */
function featherEdges(data, width, height) {
  const radius = SIG_FEATHER_RADIUS;
  if (radius <= 0) return;
  
  // Create a copy of the alpha channel for reading
  const alphaCopy = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    alphaCopy[i] = data[i * 4 + 3];
  }
  
  // Smooth alpha at boundaries (where alpha changes significantly)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const currentAlpha = alphaCopy[idx];
      
      if (currentAlpha === 0 || currentAlpha === 255) continue; // Skip fully transparent/opaque
      
      // Check if this is an edge pixel (neighbor has very different alpha)
      let isEdge = false;
      for (let dy = -radius; dy <= radius && !isEdge; dy++) {
        for (let dx = -radius; dx <= radius && !isEdge; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const neighborAlpha = alphaCopy[ny * width + nx];
          if (Math.abs(neighborAlpha - currentAlpha) > 40) {
            isEdge = true;
          }
        }
      }
      
      if (isEdge) {
        // Average alpha with neighbors for smoother edge
        let sum = 0;
        let count = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            sum += alphaCopy[ny * width + nx];
            count++;
          }
        }
        // Blend: 60% original + 40% smoothed for subtle effect
        const smoothed = Math.round(sum / count);
        data[idx * 4 + 3] = Math.round(currentAlpha * 0.6 + smoothed * 0.4);
      }
    }
  }
}

/**
 * Apply subtle random opacity variance to simulate real ink.
 * Real pen strokes have slight variations in ink density.
 */
function applyInkVariance(data, width, height) {
  const maxVariance = SIG_INK_VARIANCE;
  
  // Use a simple deterministic pseudo-random based on position
  // This ensures the same signature always gets the same treatment
  let seed = 12345;
  function pseudoRandom() {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  }
  
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a === 0) continue; // Skip transparent
    
    // Apply random variance: slightly vary the opacity
    // Range: [1 - maxVariance, 1 + maxVariance], clamped to [0, 1]
    const variance = 1 + (pseudoRandom() * 2 - 1) * maxVariance;
    const newAlpha = Math.min(255, Math.max(0, Math.round(a * variance)));
    data[i + 3] = newAlpha;
  }
}

/**
 * Batch process all signature elements before saving.
 * Returns a map of element index → processed data URL.
 */
async function processAllSignatures(elements, pageNum) {
  const processed = new Map();
  const pageElements = elements[pageNum] || [];
  
  for (let i = 0; i < pageElements.length; i++) {
    const el = pageElements[i];
    if (el.type === 'signature' && el.src) {
      try {
        const processedSrc = await processSignatureImage(el.src);
        processed.set(el, processedSrc);
      } catch (err) {
        console.warn('Failed to process signature:', err);
      }
    }
  }
  
  return processed;
}

// ============================================
// PDF FLATTEN — Integrate signatures into page content
// Re-loads the PDF with pdf-lib and re-saves it, which:
// 1. Normalizes the PDF structure (removes incremental updates)
// 2. Strips annotation metadata that could identify signatures
// 3. Removes AcroForm fields associated with inserted objects
// 4. Merges and re-serializes all content streams
// Result: text remains editable/selectable, but signatures are
// integrated into the page content and not easily removable.
// ============================================

/**
 * Flatten PDF signatures into page content.
 * Uses pdf-lib to re-load and re-save the PDF, which:
 * - Normalizes the PDF structure (removes incremental updates)
 * - Strips annotation metadata that could identify signatures
 * - Removes AcroForm fields associated with inserted objects
 * - Re-serializes all content streams and XObjects
 * Result: text remains editable/selectable, signatures are
 * integrated into the page content and not easily removable.
 *
 * Then performs a second pass: for each page with signature images,
 * renders that page with pdf.js and overlays the rasterized signature
 * areas, effectively "burning" signatures into the page content
 * while keeping the original text layer intact.
 *
 * @param {Uint8Array} pdfBytes - Source PDF bytes
 * @returns {Promise<Uint8Array>} - Flattened PDF bytes
 */
async function flattenPdf(pdfBytes) {
  const pdfLib = window.PDFLib;
  const { PDFDocument } = pdfLib;

  // Pass 1: Re-load and re-save with pdf-lib to normalize structure
  let normalizedBytes;
  try {
    const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    normalizedBytes = await doc.save();
    console.log('PDF normalized (pass 1) — structure cleaned, metadata stripped');
  } catch (e) {
    console.warn('PDF normalize pass 1 failed:', e);
    normalizedBytes = pdfBytes;
  }

  // Pass 2: Deep flatten — strip any remaining signature-identifying metadata
  // by doing another load/save cycle which forces pdf-lib to rewrite
  // all objects from scratch, removing any dangling references
  try {
    const doc2 = await PDFDocument.load(normalizedBytes, { ignoreEncryption: true });
    const deepBytes = await doc2.save();
    console.log('PDF deep-flattened (pass 2) — all objects rewritten from scratch');
    return deepBytes;
  } catch (e) {
    console.warn('PDF deep-flatten pass 2 failed:', e);
    return normalizedBytes;
  }
}

// ============================================
// PDF RASTERIZATION — Makes PDF completely non-editable
// Renders each page as a high-res image, then rebuilds PDF from images.
// No objects can be selected, moved, or edited — signatures are invisible.
// ============================================

/**
 * Rasterize a PDF: render every page as a high-resolution image,
 * then create a new PDF containing only those images.
 * Result: completely flat, non-editable PDF.
 * @param {Uint8Array} pdfBytes - The source PDF bytes
 * @returns {Uint8Array} - Rasterized PDF bytes
 */
async function rasterizePdf(pdfBytes) {
  // Use pdf.js to render pages to images
  if (!window.pdfjsLib) {
    throw new Error('pdf.js no está disponible para rasterizar');
  }
  
  const pdfLib = window.PDFLib;
  const { PDFDocument } = pdfLib;
  
  // Load the PDF with pdf.js
  const loadingTask = window.pdfjsLib.getDocument({ data: pdfBytes.slice(0) });
  const pdfJsDoc = await loadingTask.promise;
  const numPages = pdfJsDoc.numPages;
  
  // Render each page at high resolution (2x = 144 DPI, 3x = 216 DPI)
  const renderScale = 3; // High quality — 216 DPI effective
  const pageImages = [];
  
  for (let i = 1; i <= numPages; i++) {
    const page = await pdfJsDoc.getPage(i);
    const viewport = page.getViewport({ scale: renderScale });
    
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    
    // White background (so transparent areas become white, not black)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    await page.render({
      canvasContext: ctx,
      viewport: viewport
    }).promise;
    
    // Convert to PNG bytes
    const pngDataUrl = canvas.toDataURL('image/png');
    const base64 = pngDataUrl.split(',')[1];
    const pngBytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    
    // Get original page dimensions (in PDF points)
    const origViewport = page.getViewport({ scale: 1 });
    
    pageImages.push({
      pngBytes,
      width: origViewport.width,   // Original width in PDF points
      height: origViewport.height  // Original height in PDF points
    });
  }
  
  // Create a new PDF with each page as a full-page image
  const newPdfDoc = await PDFDocument.create();
  
  for (const pageInfo of pageImages) {
    const page = newPdfDoc.addPage([pageInfo.width, pageInfo.height]);
    const image = await newPdfDoc.embedPng(pageInfo.pngBytes);
    
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: pageInfo.width,
      height: pageInfo.height
    });
  }
  
  const rasterizedBytes = await newPdfDoc.save();
  return rasterizedBytes;
}

// ============================================
// SAVE MODE DIALOG
// ============================================

/**
 * Show a dialog for the user to choose save mode:
 * - "editable": Normal PDF (text selectable, signatures as objects)
 * - "protected": Flattened PDF (text selectable, signatures integrated into content)
 * - "rasterized": Rasterized PDF (completely non-editable, everything as image)
 * Returns a Promise that resolves with 'editable', 'protected', or 'rasterized'.
 */
function showSaveModeDialog() {
  return new Promise((resolve) => {
    // Check if there are any signatures in the document
    const activeDoc = getActiveDoc();
    let hasSignatures = false;
    if (activeDoc) {
      for (let p = 1; p <= activeDoc.totalPages; p++) {
        const els = activeDoc.elements[p] || [];
        if (els.some(el => el.type === 'signature')) {
          hasSignatures = true;
          break;
        }
      }
    }
    
    // If no signatures, just save normally (no need for final mode)
    if (!hasSignatures) {
      resolve('editable');
      return;
    }
    
    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,sans-serif;';
    
    const modal = document.createElement('div');
    modal.style.cssText = 'background:white;border-radius:12px;padding:24px;max-width:440px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.3);';
    
    modal.innerHTML = `
      <div style="font-size:18px;font-weight:700;margin-bottom:8px;color:#1e293b;">💾 Guardar PDF con Firmas</div>
      <div style="font-size:13px;color:#64748b;margin-bottom:16px;">Este documento contiene firmas. Elige cómo integrarlas:</div>
      
      <div id="saveModeProtected" style="border:2px solid #16a34a;border-radius:8px;padding:12px;margin-bottom:8px;cursor:pointer;transition:all 0.2s;background:#f0fdf4;">
        <div style="font-size:14px;font-weight:600;color:#15803d;">✍️ Firmas Integradas — Recomendado</div>
        <div style="font-size:11px;color:#64748b;margin-top:4px;">El texto sigue siendo seleccionable y editable. Las firmas se integran en el contenido de la página: no se pueden detectar ni eliminar como objetos separados.</div>
      </div>
      
      <div id="saveModeEditable" style="border:2px solid #3b82f6;border-radius:8px;padding:12px;margin-bottom:8px;cursor:pointer;transition:all 0.2s;background:#eff6ff;">
        <div style="font-size:14px;font-weight:600;color:#1e40af;">📝 Editable</div>
        <div style="font-size:11px;color:#64748b;margin-top:4px;">PDF normal. Se puede seguir editando. Las firmas son objetos insertados que se pueden seleccionar y mover.</div>
      </div>
      
      <div id="saveModeRasterized" style="border:2px solid #d97706;border-radius:8px;padding:12px;margin-bottom:16px;cursor:pointer;transition:all 0.2s;background:#fffbeb;">
        <div style="font-size:14px;font-weight:600;color:#b45309;">🖼️ Imagen (Máxima protección)</div>
        <div style="font-size:11px;color:#64748b;margin-top:4px;">Cada página se convierte en una imagen. Nada editable ni seleccionable. Protección total pero calidad de texto inferior.</div>
      </div>
      
      <div style="font-size:10px;color:#94a3b8;text-align:center;">⭐ Recomendado: Firmas Integradas — texto editable con firmas invisibles</div>
    `;
    
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    
    // Handle clicks
    modal.querySelector('#saveModeEditable').addEventListener('click', () => {
      document.body.removeChild(overlay);
      resolve('editable');
    });
    
    modal.querySelector('#saveModeProtected').addEventListener('click', () => {
      document.body.removeChild(overlay);
      resolve('protected');
    });
    
    modal.querySelector('#saveModeRasterized').addEventListener('click', () => {
      document.body.removeChild(overlay);
      resolve('rasterized');
    });
    
    // Handle overlay click (cancel)
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        document.body.removeChild(overlay);
        resolve('editable'); // Default to editable on cancel
      }
    });
    
    // Handle Escape key
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', escHandler);
        if (document.body.contains(overlay)) {
          document.body.removeChild(overlay);
          resolve('editable');
        }
      }
    };
    document.addEventListener('keydown', escHandler);
  });
}

async function savePdf() {
  const activeDoc = getActiveDoc();
  if (!activeDoc || !activeDoc.originalPdfBytes) {
    showStatus('No hay PDF para guardar', 'error');
    return;
  }
  
  // Ask user for save mode (only if document has signatures)
  const saveMode = await showSaveModeDialog();
  
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
    // #25 Pre-embed font variants for rich text
    const fontBold = await newPdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontItalic = await newPdfDoc.embedFont(StandardFonts.HelveticaOblique);
    const fontBoldItalic = await newPdfDoc.embedFont(StandardFonts.HelveticaBoldOblique);
    
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
          
          // #25 Select font variant based on bold/italic
          let selectedFont = font;
          if (el.bold && el.italic) {
            selectedFont = fontBoldItalic;
          } else if (el.bold) {
            selectedFont = fontBold;
          } else if (el.italic) {
            selectedFont = fontItalic;
          }
          
          page.drawText(el.text, {
            x: el.x,
            y: pdfY,
            size: fontSize,
            font: selectedFont,
            color: rgb(color.r / 255, color.g / 255, color.b / 255)
          });
          
          // #25 Draw underline if needed
          if (el.underline) {
            const textWidth = selectedFont.widthOfTextAtSize(el.text, fontSize);
            page.drawLine({
              start: { x: el.x, y: pdfY - 2 },
              end: { x: el.x + textWidth, y: pdfY - 2 },
              thickness: 1,
              color: rgb(color.r / 255, color.g / 255, color.b / 255)
            });
          }
        } else if (el.type === 'image' || el.type === 'signature' || el.type === 'drawing') {
          try {
            let imageSrc = el.src;
            let isPng = false;
            
            // Process signatures: remove white bg, feather edges, ink variance
            if (el.type === 'signature') {
              try {
                const processedSrc = await processSignatureImage(el.src);
                imageSrc = processedSrc;
                isPng = true; // Processed signatures are always PNG (preserves transparency)
              } catch (procErr) {
                console.warn('Signature processing failed, using original:', procErr);
                imageSrc = el.src;
              }
            }
            
            let imageBytes;
            
            if (imageSrc.startsWith('data:')) {
              const base64 = imageSrc.split(',')[1];
              imageBytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
              if (!isPng) isPng = imageSrc.includes('image/png');
            } else {
              const res = await fetch(imageSrc);
              const blob = await res.blob();
              const arrayBuffer = await blob.arrayBuffer();
              imageBytes = new Uint8Array(arrayBuffer);
              if (!isPng) isPng = imageSrc.includes('png') || blob.type === 'image/png';
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
        } else if (el.type === 'shape') {
          // #22 Draw shapes on PDF
          const strokeColor = hexToRgb(el.strokeColor || '#000000');
          const strokeWidth = el.strokeWidth || 2;
          
          if (el.shape === 'rect') {
            page.drawRectangle({
              x: el.x,
              y: height - el.y - el.height,
              width: el.width,
              height: el.height,
              borderColor: rgb(strokeColor.r / 255, strokeColor.g / 255, strokeColor.b / 255),
              borderWidth: strokeWidth,
              color: undefined // transparent fill
            });
          } else if (el.shape === 'line' || el.shape === 'arrow') {
            const pdfStartY = height - el.startY;
            const pdfEndY = height - el.endY;
            page.drawLine({
              start: { x: el.startX, y: pdfStartY },
              end: { x: el.endX, y: pdfEndY },
              thickness: strokeWidth,
              color: rgb(strokeColor.r / 255, strokeColor.g / 255, strokeColor.b / 255)
            });
            
            // Draw arrowhead for arrow shapes
            if (el.shape === 'arrow') {
              const dx = el.endX - el.startX;
              const dy = pdfEndY - pdfStartY;
              const len = Math.sqrt(dx * dx + dy * dy);
              const arrowSize = Math.min(10, len * 0.15);
              const angle = Math.atan2(dy, dx);
              
              // Arrowhead as a small filled triangle
              const tipX = el.endX;
              const tipY = pdfEndY;
              const leftX = tipX - arrowSize * Math.cos(angle - Math.PI / 6);
              const leftY = tipY - arrowSize * Math.sin(angle - Math.PI / 6);
              const rightX = tipX - arrowSize * Math.cos(angle + Math.PI / 6);
              const rightY = tipY - arrowSize * Math.sin(angle + Math.PI / 6);
              
              // Draw arrowhead as two small lines forming a V
              page.drawLine({
                start: { x: tipX, y: tipY },
                end: { x: leftX, y: leftY },
                thickness: strokeWidth,
                color: rgb(strokeColor.r / 255, strokeColor.g / 255, strokeColor.b / 255)
              });
              page.drawLine({
                start: { x: tipX, y: tipY },
                end: { x: rightX, y: rightY },
                thickness: strokeWidth,
                color: rgb(strokeColor.r / 255, strokeColor.g / 255, strokeColor.b / 255)
              });
            }
          }
        }
      }
    }
    
    let pdfBytesResult = await newPdfDoc.save();
    
    // Apply post-processing based on save mode
    if (saveMode === 'protected') {
      // Flatten: integrate signatures into page content, keep text editable
      // Re-loads and re-saves with pdf-lib (safe, no binary corruption)
      try {
        showStatus('Integrando firmas en el documento...', 'info');
        pdfBytesResult = await flattenPdf(pdfBytesResult);
        console.log('PDF flattened successfully — signatures integrated into page content');
      } catch (flattenErr) {
        console.warn('PDF flatten failed (using non-flattened):', flattenErr);
      }
    } else if (saveMode === 'rasterized') {
      // Rasterize entire PDF — completely flat image, no objects at all
      try {
        showStatus('Rasterizando PDF (imagen)...', 'info');
        pdfBytesResult = await rasterizePdf(pdfBytesResult);
        console.log('PDF rasterized successfully — fully non-editable');
      } catch (rasterErr) {
        console.warn('PDF rasterization failed (using original):', rasterErr);
      }
    }
    // 'editable' mode: save as-is, signatures remain as XObjects
    
    const blob = new Blob([pdfBytesResult], {type: 'application/pdf'});
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = downloadFileName;
    link.click();
    
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    
    // Mark document as saved but DO NOT clear elements automatically.
    // This prevents data loss if the download was blocked or failed.
    // The user can explicitly clear via "Limpiar" button if desired.
    updateTabModified(activeDoc.id, false);
    renderPage();
    
    const modeMsg = saveMode === 'protected' ? 'PDF guardado (Firmas integradas — texto editable)' :
                    saveMode === 'rasterized' ? 'PDF guardado (Imagen — no editable)' :
                    'PDF guardado correctamente (Editable)';
    showStatus(modeMsg, 'success');
    
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

// hexToRgb moved to shared-utils.js

// ============================================
// #20 COLLAPSIBLE SIDEBAR
// ============================================
function toggleSidebar() {
  sidebarCollapsed = !sidebarCollapsed;
  localStorage.setItem('pe_sidebarCollapsed', sidebarCollapsed);
  applySidebarState();
}

function applySidebarState() {
  const sidebar = $('editorSidebar');
  const canvasArea = $('canvasArea');
  if (sidebar) {
    if (sidebarCollapsed) {
      sidebar.classList.add('sidebar-collapsed');
    } else {
      sidebar.classList.remove('sidebar-collapsed');
    }
  }
  if (canvasArea) {
    if (sidebarCollapsed) {
      canvasArea.classList.add('sidebar-expanded');
    } else {
      canvasArea.classList.remove('sidebar-expanded');
    }
  }
}

// ============================================
// #19 RECENT SIGNATURES CACHE
// ============================================
function getRecentSignatures() {
  try {
    return JSON.parse(localStorage.getItem('pe_recentSignatures') || '[]');
  } catch (e) {
    return [];
  }
}

function addRecentSignature(name, imageUrl) {
  if (!name || !imageUrl) return;
  let recents = getRecentSignatures();
  // Remove duplicate by name
  recents = recents.filter(s => s.name !== name);
  // Add to front
  recents.unshift({ name: name, imageUrl: imageUrl });
  // Keep max 5
  if (recents.length > 5) recents = recents.slice(0, 5);
  localStorage.setItem('pe_recentSignatures', JSON.stringify(recents));
  renderRecentSignatures();
}

function renderRecentSignatures() {
  const recents = getRecentSignatures();
  const container = $('recentSigs');
  const list = $('recentSigsList');
  if (!container || !list) return;
  
  if (recents.length === 0) {
    container.style.display = 'none';
    return;
  }
  
  container.style.display = 'block';
  list.innerHTML = '';
  
  recents.forEach(sig => {
    const btn = document.createElement('button');
    btn.className = 'recent-sig-btn';
    btn.title = sig.name;
    
    const img = document.createElement('img');
    img.src = sig.imageUrl;
    img.alt = sig.name;
    btn.appendChild(img);
    
    const span = document.createElement('span');
    span.textContent = sig.name;
    btn.appendChild(span);
    
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      selectSignature(sig.imageUrl, sig.name);
    });
    
    list.appendChild(btn);
  });
}

// ============================================
// #21 FREEHAND DRAWING / PEN TOOL
// ============================================
function enterDrawMode() {
  const activeDoc = getActiveDoc();
  if (!activeDoc || !activeDoc.pdfJsDoc) {
    showStatus('Primero carga un PDF', 'error');
    return;
  }
  
  // Exit shape mode if active
  if (shapeMode) exitShapeMode();
  
  isDrawMode = true;
  drawPaths = [];
  drawCurrentPath = [];
  
  // Show toolbar
  const toolbar = $('drawToolbar');
  if (toolbar) toolbar.style.display = 'flex';
  
  // Create canvas overlay on the PDF
  const canvasArea = $('canvasArea');
  const container = canvasArea ? canvasArea.querySelector('.canvas-container') : null;
  if (container) {
    const overlay = document.createElement('canvas');
    overlay.className = 'draw-canvas-overlay';
    overlay.id = 'drawCanvasOverlay';
    overlay.width = container.offsetWidth;
    overlay.height = container.offsetHeight;
    overlay.style.width = container.offsetWidth + 'px';
    overlay.style.height = container.offsetHeight + 'px';
    container.appendChild(overlay);
    drawCanvasOverlay = overlay;
    
    overlay.addEventListener('mousedown', onDrawStart);
    overlay.addEventListener('mousemove', onDrawMove);
    overlay.addEventListener('mouseup', onDrawEnd);
    overlay.addEventListener('mouseleave', onDrawEnd);
  }
  
  showStatus('Modo dibujo activado - dibuja sobre el PDF', 'success');
}

function exitDrawMode() {
  isDrawMode = false;
  drawPaths = [];
  drawCurrentPath = [];
  
  const toolbar = $('drawToolbar');
  if (toolbar) toolbar.style.display = 'none';
  
  if (drawCanvasOverlay) {
    drawCanvasOverlay.removeEventListener('mousedown', onDrawStart);
    drawCanvasOverlay.removeEventListener('mousemove', onDrawMove);
    drawCanvasOverlay.removeEventListener('mouseup', onDrawEnd);
    drawCanvasOverlay.removeEventListener('mouseleave', onDrawEnd);
    drawCanvasOverlay.remove();
    drawCanvasOverlay = null;
  }
}

function onDrawStart(e) {
  if (!isDrawMode) return;
  const rect = drawCanvasOverlay.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  
  drawStrokeColor = $('drawStrokeColor') ? $('drawStrokeColor').value : '#000000';
  drawStrokeWidth = $('drawStrokeWidth') ? parseInt($('drawStrokeWidth').value) : 2;
  
  drawCurrentPath = [{ x, y, color: drawStrokeColor, width: drawStrokeWidth }];
  e.preventDefault();
}

function onDrawMove(e) {
  if (!isDrawMode || drawCurrentPath.length === 0) return;
  const rect = drawCanvasOverlay.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  
  drawCurrentPath.push({ x, y, color: drawStrokeColor, width: drawStrokeWidth });
  
  // Draw the latest segment
  const ctx = drawCanvasOverlay.getContext('2d');
  const prev = drawCurrentPath[drawCurrentPath.length - 2];
  ctx.beginPath();
  ctx.strokeStyle = drawStrokeColor;
  ctx.lineWidth = drawStrokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.moveTo(prev.x, prev.y);
  ctx.lineTo(x, y);
  ctx.stroke();
}

function onDrawEnd(e) {
  if (!isDrawMode || drawCurrentPath.length === 0) return;
  
  if (drawCurrentPath.length > 1) {
    drawPaths.push([...drawCurrentPath]);
  }
  drawCurrentPath = [];
}

function clearDrawing() {
  drawPaths = [];
  drawCurrentPath = [];
  if (drawCanvasOverlay) {
    const ctx = drawCanvasOverlay.getContext('2d');
    ctx.clearRect(0, 0, drawCanvasOverlay.width, drawCanvasOverlay.height);
  }
}

function confirmDrawing() {
  if (drawPaths.length === 0) {
    showStatus('No hay dibujo para confirmar', 'error');
    return;
  }
  
  const activeDoc = getActiveDoc();
  if (!activeDoc) return;
  
  // Capture the drawing as a PNG data URL
  const dataUrl = drawCanvasOverlay.toDataURL('image/png');
  
  // Calculate bounding box of the drawing
  const scale = activeDoc.zoom;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  drawPaths.forEach(path => {
    path.forEach(pt => {
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y > maxY) maxY = pt.y;
    });
  });
  
  // Convert to PDF coordinates (unscaled)
  const pdfX = minX / scale;
  const pdfY = minY / scale;
  const pdfW = (maxX - minX) / scale || 10;
  const pdfH = (maxY - minY) / scale || 10;
  
  // Store paths for potential re-editing
  const storedPaths = drawPaths.map(path => path.map(pt => ({
    x: pt.x / scale,
    y: pt.y / scale,
    color: pt.color,
    width: pt.width / scale
  })));
  
  // Add as a drawing element (rendered as image, like signature)
  pushElement(activeDoc, activeDoc.currentPage, {
    type: 'drawing',
    src: dataUrl,
    x: pdfX,
    y: pdfY,
    width: pdfW,
    height: pdfH,
    paths: storedPaths
  });
  
  updateTabModified(activeDoc.id, true);
  
  // Exit draw mode and re-render
  exitDrawMode();
  renderPage();
  showStatus('Dibujo añadido', 'success');
  scheduleAutoSave();
}

// ============================================
// #22 SHAPE TOOLS
// ============================================
function enterShapeMode(type) {
  const activeDoc = getActiveDoc();
  if (!activeDoc || !activeDoc.pdfJsDoc) {
    showStatus('Primero carga un PDF', 'error');
    return;
  }
  
  // Exit draw mode if active
  if (isDrawMode) exitDrawMode();
  
  // Toggle shape mode
  if (shapeMode === type) {
    exitShapeMode();
    return;
  }
  
  shapeMode = type;
  shapeIsDrawing = false;
  showStatus(`Modo ${type === 'rect' ? 'rectángulo' : type === 'line' ? 'línea' : 'flecha'} activado - arrastra sobre el PDF`, 'success');
}

function exitShapeMode() {
  shapeMode = null;
  shapeIsDrawing = false;
  const svg = $('shapePreviewSvg');
  if (svg) { svg.style.display = 'none'; svg.innerHTML = ''; }
}

function getCanvasContainer() {
  const canvasArea = $('canvasArea');
  return canvasArea ? canvasArea.querySelector('.canvas-container') : null;
}

function onShapeMouseDown(e) {
  if (!shapeMode) return;
  const container = getCanvasContainer();
  if (!container) return;
  
  // Only handle clicks on the overlay or container, not on elements
  if (e.target.closest('.pdf-element') || e.target.closest('.resize-handle')) return;
  
  const rect = container.getBoundingClientRect();
  shapeStartX = e.clientX - rect.left;
  shapeStartY = e.clientY - rect.top;
  shapeIsDrawing = true;
  
  const svg = $('shapePreviewSvg');
  if (svg) {
    svg.style.display = 'block';
    svg.style.width = container.offsetWidth + 'px';
    svg.style.height = container.offsetHeight + 'px';
    svg.style.left = container.offsetLeft + 'px';
    svg.style.top = container.offsetTop + 'px';
    svg.innerHTML = '';
  }
  
  e.preventDefault();
}

function onShapeMouseMove(e) {
  if (!shapeMode || !shapeIsDrawing) return;
  const container = getCanvasContainer();
  if (!container) return;
  
  const rect = container.getBoundingClientRect();
  const curX = e.clientX - rect.left;
  const curY = e.clientY - rect.top;
  
  const svg = $('shapePreviewSvg');
  if (!svg) return;
  
  const x1 = Math.min(shapeStartX, curX);
  const y1 = Math.min(shapeStartY, curY);
  const w = Math.abs(curX - shapeStartX);
  const h = Math.abs(curY - shapeStartY);
  
  svg.innerHTML = '';
  
  if (shapeMode === 'rect') {
    svg.innerHTML = `<rect x="${x1}" y="${y1}" width="${w}" height="${h}" fill="none" stroke="#000000" stroke-width="2"/>`;
  } else if (shapeMode === 'line') {
    svg.innerHTML = `<line x1="${shapeStartX}" y1="${shapeStartY}" x2="${curX}" y2="${curY}" stroke="#000000" stroke-width="2"/>`;
  } else if (shapeMode === 'arrow') {
    const dx = curX - shapeStartX;
    const dy = curY - shapeStartY;
    const len = Math.sqrt(dx * dx + dy * dy);
    const arrowSize = Math.min(15, len * 0.15);
    const angle = Math.atan2(dy, dx);
    const ax1 = curX - arrowSize * Math.cos(angle - Math.PI / 6);
    const ay1 = curY - arrowSize * Math.sin(angle - Math.PI / 6);
    const ax2 = curX - arrowSize * Math.cos(angle + Math.PI / 6);
    const ay2 = curY - arrowSize * Math.sin(angle + Math.PI / 6);
    svg.innerHTML = `<line x1="${shapeStartX}" y1="${shapeStartY}" x2="${curX}" y2="${curY}" stroke="#000000" stroke-width="2"/>
      <polygon points="${curX},${curY} ${ax1},${ay1} ${ax2},${ay2}" fill="#000000"/>`;
  }
}

function onShapeMouseUp(e) {
  if (!shapeMode || !shapeIsDrawing) return;
  shapeIsDrawing = false;
  
  const activeDoc = getActiveDoc();
  if (!activeDoc) return;
  
  const container = getCanvasContainer();
  if (!container) return;
  
  const rect = container.getBoundingClientRect();
  const curX = e.clientX - rect.left;
  const curY = e.clientY - rect.top;
  const scale = activeDoc.zoom;
  
  const w = Math.abs(curX - shapeStartX);
  const h = Math.abs(curY - shapeStartY);
  
  // Minimum size to create a shape
  if (w < 5 && h < 5) {
    const svg = $('shapePreviewSvg');
    if (svg) { svg.style.display = 'none'; svg.innerHTML = ''; }
    return;
  }
  
  const x = Math.min(shapeStartX, shapeStartX + (curX - shapeStartX)) / scale;
  const y = Math.min(shapeStartY, shapeStartY + (curY - shapeStartY)) / scale;
  const pdfW = w / scale;
  const pdfH = h / scale;
  
  // For line/arrow, store start and end points relative to the bounding box
  const startXpdf = shapeStartX / scale;
  const startYpdf = shapeStartY / scale;
  const endXpdf = curX / scale;
  const endYpdf = curY / scale;
  
  pushElement(activeDoc, activeDoc.currentPage, {
    type: 'shape',
    shape: shapeMode,
    x: Math.min(startXpdf, endXpdf),
    y: Math.min(startYpdf, endYpdf),
    width: pdfW,
    height: pdfH,
    startX: startXpdf,
    startY: startYpdf,
    endX: endXpdf,
    endY: endYpdf,
    strokeColor: '#000000',
    strokeWidth: 2,
    fillColor: 'transparent'
  });
  
  // Clear preview
  const svg = $('shapePreviewSvg');
  if (svg) { svg.style.display = 'none'; svg.innerHTML = ''; }
  
  updateTabModified(activeDoc.id, true);
  renderPage();
  showStatus(`${shapeMode === 'rect' ? 'Rectángulo' : shapeMode === 'line' ? 'Línea' : 'Flecha'} añadido`, 'success');
  scheduleAutoSave();
  
  // Stay in shape mode for repeated shapes
}

// ============================================
// #25 RICH TEXT HELPERS
// ============================================
function getRichTextState() {
  return {
    bold: $('btnBold') ? $('btnBold').classList.contains('active') : false,
    italic: $('btnItalic') ? $('btnItalic').classList.contains('active') : false,
    underline: $('btnUnderline') ? $('btnUnderline').classList.contains('active') : false
  };
}

function setRichTextState(bold, italic, underline) {
  const btnBold = $('btnBold');
  const btnItalic = $('btnItalic');
  const btnUnderline = $('btnUnderline');
  if (btnBold) { if (bold) btnBold.classList.add('active'); else btnBold.classList.remove('active'); }
  if (btnItalic) { if (italic) btnItalic.classList.add('active'); else btnItalic.classList.remove('active'); }
  if (btnUnderline) { if (underline) btnUnderline.classList.add('active'); else btnUnderline.classList.remove('active'); }
}

// ============================================
// #26 PAGE REORDERING
// ============================================
async function renderPageThumbnails() {
  const activeDoc = getActiveDoc();
  const container = $('pageThumbnails');
  const noPdf = $('pagesNoPdf');
  if (!container) return;
  
  if (!activeDoc || !activeDoc.pdfJsDoc) {
    if (noPdf) noPdf.style.display = 'block';
    container.style.display = 'none';
    return;
  }
  
  if (noPdf) noPdf.style.display = 'none';
  container.style.display = 'flex';
  container.innerHTML = '';
  
  for (let i = 1; i <= activeDoc.totalPages; i++) {
    const thumb = document.createElement('div');
    thumb.className = 'page-thumb' + (i === activeDoc.currentPage ? ' active-page' : '');
    thumb.draggable = true;
    thumb.dataset.pageNum = i;
    
    // Render thumbnail canvas
    try {
      const page = await activeDoc.pdfJsDoc.getPage(i);
      const viewport = page.getViewport({ scale: 0.2 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
      thumb.appendChild(canvas);
    } catch (err) {
      const placeholder = document.createElement('div');
      placeholder.style.cssText = 'width:60px;height:80px;background:#1e293b;border-radius:4px;';
      thumb.appendChild(placeholder);
    }
    
    const label = document.createElement('span');
    label.className = 'page-thumb-label';
    label.textContent = `Pág. ${i}`;
    thumb.appendChild(label);
    
    // Click to navigate
    thumb.addEventListener('click', () => {
      activeDoc.currentPage = i;
      renderPage();
      renderPageThumbnails();
    });
    
    // Drag events
    thumb.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', i.toString());
      thumb.classList.add('dragging');
    });
    
    thumb.addEventListener('dragend', () => {
      thumb.classList.remove('dragging');
    });
    
    thumb.addEventListener('dragover', (e) => {
      e.preventDefault();
      thumb.classList.add('drag-over');
    });
    
    thumb.addEventListener('dragleave', () => {
      thumb.classList.remove('drag-over');
    });
    
    thumb.addEventListener('drop', async (e) => {
      e.preventDefault();
      thumb.classList.remove('drag-over');
      const fromPage = parseInt(e.dataTransfer.getData('text/plain'));
      const toPage = i;
      if (fromPage !== toPage) {
        await reorderPages(fromPage, toPage);
      }
    });
    
    container.appendChild(thumb);
  }
}

async function reorderPages(fromIndex, toIndex) {
  const activeDoc = getActiveDoc();
  if (!activeDoc || !activeDoc.originalPdfBytes) return;
  
  try {
    const pdfLib = window.PDFLib;
    const { PDFDocument } = pdfLib;
    
    const srcPdf = await PDFDocument.load(activeDoc.originalPdfBytes, { ignoreEncryption: true });
    const newPdfDoc = await PDFDocument.create();
    
    // Build new page order
    const pageOrder = [];
    for (let i = 1; i <= activeDoc.totalPages; i++) pageOrder.push(i);
    
    // Move fromIndex to toIndex
    const moved = pageOrder.splice(fromIndex - 1, 1)[0];
    pageOrder.splice(toIndex - 1, 0, moved);
    
    // Copy pages in new order
    for (const pageNum of pageOrder) {
      const [copiedPage] = await newPdfDoc.copyPages(srcPdf, [pageNum - 1]);
      newPdfDoc.addPage(copiedPage);
    }
    
    const newPdfBytes = await newPdfDoc.save();
    
    // Update the document with new PDF bytes
    activeDoc.originalPdfBytes = newPdfBytes;
    
    // Re-load with pdfjs
    const pdfjsDoc = await window.pdfjsLib.getDocument({ data: newPdfBytes.slice(0) }).promise;
    activeDoc.pdfJsDoc = pdfjsDoc;
    activeDoc.totalPages = pdfjsDoc.numPages;
    
    // Remap elements: elements were keyed by old page numbers
    // After reorder, element on old page X is now on new position
    const oldElements = activeDoc.elements;
    const newElements = {};
    pageOrder.forEach((oldPageNum, newPageNum) => {
      newElements[newPageNum + 1] = oldElements[oldPageNum] || [];
    });
    activeDoc.elements = newElements;
    
    // Ensure current page is valid
    if (activeDoc.currentPage > activeDoc.totalPages) {
      activeDoc.currentPage = activeDoc.totalPages;
    }
    
    updateTabModified(activeDoc.id, true);
    renderPage();
    renderPageThumbnails();
    showStatus(`Página ${fromIndex} movida a posición ${toIndex}`, 'success');
    scheduleAutoSave();
    
  } catch (err) {
    console.error('Reorder error:', err);
    showStatus('Error al reordenar: ' + err.message, 'error');
  }
}
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
    item.innerHTML = `<img src="${escapeHtml(img.src)}" alt=""><span class="name">${escapeHtml(img.name)}</span><button class="remove-btn" data-idx="${idx}">×</button>`;
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
    item.innerHTML = `<span class="name">📝 ${escapeHtml(doc.name)}</span><button class="remove-btn" data-idx="${idx}">×</button>`;
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
    item.innerHTML = `<span class="name">📄 ${escapeHtml(pdf.name)}</span><button class="remove-btn" data-idx="${idx}">×</button>`;
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

// Copy only selected elements (from multi-select)
function copySelectedElements() {
  const activeDoc = getActiveDoc();
  if (!activeDoc) return;
  const pageElements = activeDoc.elements[activeDoc.currentPage] || [];
  if (selectedIndices.size === 0) { showStatus('Selecciona elementos primero (Shift+Click)', 'error'); return; }
  
  const selected = Array.from(selectedIndices).sort((a, b) => a - b).map(idx => pageElements[idx]).filter(Boolean);
  clipboardElements = JSON.parse(JSON.stringify(selected));
  clearSelection();
  updateClipboardUI();
  showStatus(`${selected.length} elemento(s) copiado(s)`, 'success');
}

// Copy with selector modal - choose which elements to copy
function showCopySelector() {
  const activeDoc = getActiveDoc();
  if (!activeDoc) { showStatus('Primero carga un PDF', 'error'); return; }
  const pageElements = activeDoc.elements[activeDoc.currentPage] || [];
  if (pageElements.length === 0) { showStatus('No hay elementos en esta página', 'error'); return; }
  
  clearSelection();
  
  const modal = $('copySelectorModal');
  const list = $('copySelectorList');
  if (!modal || !list) return;
  
  list.innerHTML = '';
  pageElements.forEach((el, idx) => {
    const label = el.type === 'text' ? (el.text.length > 30 ? el.text.substring(0, 30) + '...' : el.text) : `${el.type}${el.name ? ': ' + el.name : ''}`;
    const div = document.createElement('div');
    div.className = 'copy-selector-item';
    div.innerHTML = `
      <label class="copy-selector-label">
        <input type="checkbox" class="copy-selector-check" data-idx="${idx}" checked>
        <span class="copy-selector-icon">${el.type === 'text' ? '📝' : el.type === 'signature' ? '✍️' : '🖼️'}</span>
        <span class="copy-selector-text">${escapeHtml(label)}</span>
      </label>
    `;
    list.appendChild(div);
  });
  
  const selectAllBtn = $('copySelectorSelectAll');
  const deselectAllBtn = $('copySelectorDeselectAll');
  if (selectAllBtn) selectAllBtn.onclick = () => list.querySelectorAll('.copy-selector-check').forEach(cb => cb.checked = true);
  if (deselectAllBtn) deselectAllBtn.onclick = () => list.querySelectorAll('.copy-selector-check').forEach(cb => cb.checked = false);
  
  modal.classList.add('show');
}

function confirmCopySelector() {
  const activeDoc = getActiveDoc();
  if (!activeDoc) return;
  const pageElements = activeDoc.elements[activeDoc.currentPage] || [];
  
  const checked = document.querySelectorAll('.copy-selector-check:checked');
  if (checked.length === 0) { showStatus('Selecciona al menos un elemento', 'error'); return; }
  
  const selected = Array.from(checked).map(cb => pageElements[parseInt(cb.dataset.idx)]).filter(Boolean);
  clipboardElements = JSON.parse(JSON.stringify(selected));
  
  $('copySelectorModal').classList.remove('show');
  updateClipboardUI();
  showStatus(`${selected.length} elemento(s) copiado(s)`, 'success');
}

function closeCopySelector() {
  const modal = $('copySelectorModal');
  if (modal) modal.classList.remove('show');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

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
    el.x = Math.min(el.x + (offset * (index % 5)), activeDoc.pageWidth - PASTE_OFFSET * 3);
    el.y = Math.min(el.y + (offset * Math.floor(index / 5)), activeDoc.pageHeight - PASTE_OFFSET * 2);
    
    // Add to current page with undo
    pushElement(activeDoc, activeDoc.currentPage, el);
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
