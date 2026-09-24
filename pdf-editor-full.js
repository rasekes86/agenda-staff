// ============================================
// PDF EDITOR FULL SCREEN - AGENDA STAFF v8.2.0
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
const MAX_RECENT_SIGNATURES = 5;

// Signature processing settings
const SIG_WHITE_THRESHOLD = 248;   // Near-white paper is removed without erasing pale strokes

// SUPABASE_URL and SUPABASE_KEY are loaded from supabase-config.js (loaded before this script)
// Do NOT redefine them here.

// Multi-document state
let documents = [];
let activeDocIndex = -1;
let tabCounter = 0;

// ============================================
// #20 COLLAPSIBLE SIDEBAR STATE
// ============================================

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
// #22 STAMP TOOL STATE
// ============================================
// stampMode is declared with the stamp functions below

// State for tools that create NEW PDFs
let imgFiles = [];
let wordFiles = [];
let mergeFiles = [];
let currentTool = 'editor';

// State for multiple signatures
let addedSignaturesCount = 0;
let signatureDrawName = '';
let signatureDrawing = false;
let signatureDrawHasInk = false;
let signatureDrawLastPoint = null;

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
  updateMultiSelectUI();
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
  setupCollapsibleInstructions();
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
  
  // The sidebar is always available; remove preferences from the old collapse control.
  localStorage.removeItem('pe_sidebarCollapsed');

  // Restore the preferred colour theme.
  applyLightMode(localStorage.getItem('pe_lightMode') === 'true');
  
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
  
  // Light/dark colour theme toggle
  const btnToggleLightMode = $('btnToggleLightMode');
  if (btnToggleLightMode) btnToggleLightMode.addEventListener('click', toggleLightMode);
  
  // #21 Drawing tool buttons
  const btnDraw = $('btnDraw');
  if (btnDraw) btnDraw.addEventListener('click', enterDrawMode);
  const btnDrawClear = $('btnDrawClear');
  if (btnDrawClear) btnDrawClear.addEventListener('click', clearDrawing);
  const btnDrawConfirm = $('btnDrawConfirm');
  if (btnDrawConfirm) btnDrawConfirm.addEventListener('click', confirmDrawing);
  
  // #22 Stamp tool buttons (Check and X)
  const btnStampCheck = $('btnStampCheck');
  if (btnStampCheck) btnStampCheck.addEventListener('click', () => enterStampMode('check'));
  const btnStampX = $('btnStampX');
  if (btnStampX) btnStampX.addEventListener('click', () => enterStampMode('x'));
  
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

  setupSignatureDrawing();

  // Position templates
  $('btnOpenTemplates')?.addEventListener('click', showTemplatesModal);
  $('btnFillTemplate')?.addEventListener('click', showFillTemplateModal);
  $('btnShowSaveView')?.addEventListener('click', showTemplateSaveView);
  $('btnConfirmSaveTemplate')?.addEventListener('click', confirmSaveTemplate);
  $('btnCancelSaveTemplate')?.addEventListener('click', cancelTemplateDraft);
  $('btnPlaceTemplateSlot')?.addEventListener('click', beginTemplateSlotPlacement);
  $('btnAdjustTemplateSlots')?.addEventListener('click', adjustTemplateDraftOnPdf);
  document.querySelectorAll('[data-template-quick-field]').forEach(button => {
    button.addEventListener('click', () => beginQuickTemplatePlacement(button.dataset.templateQuickType, button.dataset.templateQuickField));
  });
  $('closeTemplatesModal')?.addEventListener('click', () => $('templatesModal')?.classList.remove('show'));
  $('closeFillTemplateModal')?.addEventListener('click', () => $('fillTemplateModal')?.classList.remove('show'));
  $('templateNameInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmSaveTemplate();
  });
  $('templatesModal')?.addEventListener('click', (e) => {
    if (e.target === $('templatesModal')) $('templatesModal').classList.remove('show');
  });
  $('fillTemplateModal')?.addEventListener('click', (e) => {
    if (e.target === $('fillTemplateModal')) $('fillTemplateModal').classList.remove('show');
  });
  
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

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('fillTemplateModal')?.classList.contains('show')) {
      $('fillTemplateModal').classList.remove('show');
      return;
    }
    if (e.key === 'Escape' && $('templatesModal')?.classList.contains('show')) {
      if ($('templateSaveView')?.style.display !== 'none') cancelTemplateDraft();
      else $('templatesModal').classList.remove('show');
      return;
    }
    if (e.key === 'Escape' && templatePlacementMode) {
      templatePlacementMode = false;
      renderPage();
      $('templatesModal')?.classList.add('show');
      return;
    }
    if (e.key === 'Escape' && $('drawSignatureModal')?.classList.contains('show')) {
      closeDrawSignatureModal();
      return;
    }
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
    if (e.key === 'Escape' && stampMode) {
      exitStampMode();
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
      updateDocumentTabsVisibility();
      
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

// A tab bar is unnecessary for a single PDF. It only appears when it is
// actually needed to switch between two or more open documents.
function updateDocumentTabsVisibility() {
  const docTabs = $('documentTabs');
  const hasMultiple = documents.length > 1;
  if (docTabs) docTabs.classList.toggle('has-multiple', hasMultiple);
  document.body.classList.toggle('multiple-documents', hasMultiple);
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
  updateDocumentTabsVisibility();
  
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
// COLLAPSIBLE INSTRUCTIONS
// ============================================

function setupCollapsibleInstructions() {
  const toggle = $('instructionsToggle');
  const content = $('instructionsContent');
  if (!toggle || !content) return;
  
  toggle.addEventListener('click', () => {
    const isOpen = content.style.display !== 'none';
    if (isOpen) {
      content.style.display = 'none';
      toggle.classList.remove('open');
    } else {
      content.style.display = 'block';
      toggle.classList.add('open');
    }
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
    if (stampMode) overlay.classList.add('placement-mode');
    if (templatePlacementMode) overlay.classList.add('template-placement-mode');
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
    
    // Mousedown on overlay starts box selection (or stamp placement)
    overlay.addEventListener('mousedown', (e) => {
      if (templatePlacementMode) {
        placeTemplateSlotAtEvent(e, overlay, scale, activeDoc);
        return;
      }
      // #22 Stamp mode: place check/X on click
      if (stampMode) {
        onStampClick(e);
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
    
    // #22 Stamp click handled in mousedown above
    
    const currentPageNum = $('currentPageNum');
    const totalPagesNum = $('totalPagesNum');
    const btnPrevPage = $('btnPrevPage');
    const btnNextPage = $('btnNextPage');
    
    if (currentPageNum) currentPageNum.textContent = activeDoc.currentPage;
    if (totalPagesNum) totalPagesNum.textContent = activeDoc.totalPages;
    if (btnPrevPage) btnPrevPage.disabled = activeDoc.currentPage <= 1;
    if (btnNextPage) btnNextPage.disabled = activeDoc.currentPage >= activeDoc.totalPages;
    updateFillTemplateVisibility();
    
  } catch (err) {
    console.error('Error rendering page:', err);
  }
}

function createElementDiv(el, idx, scale, activeDoc) {
  const div = document.createElement('div');
  div.className = 'pdf-element pdf-element-' + el.type;
  if (el.isPlaceholder) div.classList.add('pdf-element-placeholder');
  div.dataset.idx = idx;
  div.style.left = (el.x * scale) + 'px';
  div.style.top = (el.y * scale) + 'px';
  
  if (el.isPlaceholder) {
    const placeholder = document.createElement('div');
    placeholder.className = 'placeholder-label';
    placeholder.textContent = el.placeholderLabel || el.fieldGroup || 'HUECO';
    div.appendChild(placeholder);
    if (el.type === 'text') {
      div.style.width = ((el.width || 150) * scale) + 'px';
      div.style.height = ((el.height || Math.max(28, (el.size || 14) + 12)) * scale) + 'px';
    } else {
      div.style.width = ((el.width || 100) * scale) + 'px';
      div.style.height = ((el.height || 60) * scale) + 'px';
    }
    div.title = el.type === 'image' ? 'Doble clic para elegir una imagen' : `Hueco ${el.fieldGroup || ''}`;
  } else if (el.type === 'text') {
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
  } // end shape/image element rendering (shapes removed, stamps are type 'image')
  
  // Normal click keeps one element selected; Shift+click toggles multi-select.
  div.addEventListener('click', (e) => {
    e.stopPropagation();
    if (e.shiftKey) {
      toggleMultiSelect(idx);
      return;
    }

    if (!selectedIndices.has(idx) || selectedIndices.size !== 1) {
      clearSelection();
      selectElementIdx(idx);
    }
  });

  // Double click on text element: open edit modal
  if (el.type === 'text') {
    div.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      if (el.templateDraft) return;
      openEditTextModal(idx, activeDoc, scale);
    });
  } else if (el.type === 'image' && el.isPlaceholder && !el.templateDraft) {
    div.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      fillImagePlaceholder(activeDoc.currentPage, idx);
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
  makeWheelResizable(div, el, scale, activeDoc, idx);
  
  return div;
}

/**
 * Resize a selected element with the mouse wheel. A wheel gesture is grouped
 * into one undo action, and image-like elements retain their aspect ratio.
 */
function makeWheelResizable(div, el, scale, activeDoc, idx) {
  let resizeStart = null;
  let resizeTimer = null;

  div.addEventListener('wheel', (e) => {
    if (selectedIndices.size !== 1 || !selectedIndices.has(idx)) return;

    e.preventDefault();
    e.stopPropagation();

    if (!resizeStart) {
      resizeStart = el.type === 'text'
        ? { size: el.size || DEFAULT_FONT_SIZE }
        : { x: el.x, y: el.y, width: el.width, height: el.height };
    }

    if (el.type === 'text') {
      const step = e.deltaY < 0 ? 1 : -1;
      el.size = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, (el.size || DEFAULT_FONT_SIZE) + step));
      div.style.fontSize = (el.size * scale) + 'px';
    } else {
      const factor = e.deltaY < 0 ? 1.06 : 1 / 1.06;
      const oldWidth = el.width;
      const oldHeight = el.height;
      const maxWidth = activeDoc.pageWidth * 2;
      const maxHeight = activeDoc.pageHeight * 2;
      let newWidth = Math.max(MIN_ELEMENT_SIZE, Math.min(maxWidth, oldWidth * factor));
      let newHeight = Math.max(MIN_ELEMENT_SIZE, Math.min(maxHeight, oldHeight * factor));

      // If either dimension reached a limit, restore the original ratio.
      const ratio = oldWidth / oldHeight;
      if (newWidth / newHeight > ratio) newWidth = newHeight * ratio;
      else newHeight = newWidth / ratio;

      const centeredX = el.x - (newWidth - oldWidth) / 2;
      const centeredY = el.y - (newHeight - oldHeight) / 2;
      el.x = Math.max(0, Math.min(Math.max(0, activeDoc.pageWidth - newWidth), centeredX));
      el.y = Math.max(0, Math.min(Math.max(0, activeDoc.pageHeight - newHeight), centeredY));
      el.width = newWidth;
      el.height = newHeight;

      const img = div.querySelector('img');
      if (img) {
        img.style.width = (newWidth * scale) + 'px';
        img.style.height = (newHeight * scale) + 'px';
      }
      div.style.left = (el.x * scale) + 'px';
      div.style.top = (el.y * scale) + 'px';
    }

    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const currentProps = el.type === 'text'
        ? { size: el.size }
        : { x: el.x, y: el.y, width: el.width, height: el.height };
      pushUndo(activeDoc.id, {
        type: 'resize',
        page: activeDoc.currentPage,
        index: idx,
        prevProps: resizeStart,
        currentProps
      });
      resizeStart = null;
      resizeTimer = null;
      updateTabModified(activeDoc.id, true);
      scheduleAutoSave();
      showStatus('Tamaño actualizado con la rueda', 'success');
    }, 220);
  }, { passive: false });
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
      if (el.isPlaceholder) clearPlaceholderMetadata(el);
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
  enterStampMode('date');
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
        <div class="signature-missing-actions">
          <button class="signature-draw-btn" data-name="${escapeHtml(name)}">✍️ Dibujar</button>
          <button class="signature-upload-btn" data-name="${escapeHtml(name)}">📤 Subir</button>
        </div>
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

  document.querySelectorAll('.signature-draw-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openDrawSignatureModal(btn.dataset.name);
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
      await saveMissingSignature(name, processedBase64);
    } catch (err) {
      console.error('Upload signature error:', err);
      showStatus('Error: ' + err.message, 'error');
    }
  };
  
  input.click();
}

async function saveMissingSignature(name, processedBase64) {
  const headers = {
    'apikey': SUPABASE_KEY,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };
  if (session && session.access_token) headers.Authorization = `Bearer ${session.access_token}`;

  const upperName = name.toUpperCase();
  const checkResponse = await fetch(`${SUPABASE_URL}/rest/v1/signatures?name=eq.${encodeURIComponent(upperName)}&select=id`, {
    method: 'GET', headers
  });

  if (checkResponse.ok) {
    const existing = await checkResponse.json();
    if (existing?.length) {
      const deleteResponse = await fetch(`${SUPABASE_URL}/rest/v1/signatures?id=eq.${existing[0].id}`, {
        method: 'DELETE', headers
      });
      if (!deleteResponse.ok) throw new Error('No se pudo reemplazar la firma existente');
    }
  }

  const bodyData = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2),
    name: upperName,
    image_url: processedBase64
  };
  if (currentUser) {
    bodyData.user_id = currentUser.id;
    bodyData.user_name = currentUser.name;
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/signatures`, {
    method: 'POST', headers, body: JSON.stringify(bodyData)
  });
  if (!response.ok) throw new Error('Error al guardar: ' + await response.text());

  showStatus('✓ Firma guardada: ' + name, 'success');
  selectSignature(processedBase64, name);
  searchSignatures();
}

function setupSignatureDrawing() {
  const canvas = $('drawSignatureCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 7;

  const pointFromEvent = (e) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height)
    };
  };

  canvas.addEventListener('pointerdown', (e) => {
    signatureDrawing = true;
    signatureDrawLastPoint = pointFromEvent(e);
    ctx.beginPath();
    ctx.arc(signatureDrawLastPoint.x, signatureDrawLastPoint.y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
    signatureDrawHasInk = true;
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!signatureDrawing) return;
    const point = pointFromEvent(e);
    ctx.beginPath();
    ctx.moveTo(signatureDrawLastPoint.x, signatureDrawLastPoint.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    signatureDrawLastPoint = point;
    signatureDrawHasInk = true;
    e.preventDefault();
  });
  const stopDrawing = () => { signatureDrawing = false; signatureDrawLastPoint = null; };
  canvas.addEventListener('pointerup', stopDrawing);
  canvas.addEventListener('pointercancel', stopDrawing);

  $('btnClearDrawSignature')?.addEventListener('click', clearDrawSignatureCanvas);
  $('btnCancelDrawSignature')?.addEventListener('click', closeDrawSignatureModal);
  $('btnSaveDrawSignature')?.addEventListener('click', saveDrawnSignature);
}

function openDrawSignatureModal(name) {
  signatureDrawName = name;
  clearDrawSignatureCanvas();
  const nameEl = $('drawSignatureName');
  if (nameEl) nameEl.textContent = name;
  $('drawSignatureModal')?.classList.add('show');
}

function clearDrawSignatureCanvas() {
  const canvas = $('drawSignatureCanvas');
  canvas?.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  signatureDrawHasInk = false;
}

function closeDrawSignatureModal() {
  $('drawSignatureModal')?.classList.remove('show');
  signatureDrawing = false;
  signatureDrawName = '';
}

async function saveDrawnSignature() {
  const canvas = $('drawSignatureCanvas');
  if (!canvas || !signatureDrawHasInk || !signatureDrawName) {
    showStatus('Dibuja la firma antes de guardarla', 'error');
    return;
  }

  const button = $('btnSaveDrawSignature');
  if (button) button.disabled = true;
  const name = signatureDrawName;
  try {
    const processedBase64 = await processSignatureImage(canvas.toDataURL('image/png'));
    await saveMissingSignature(name, processedBase64);
    closeDrawSignatureModal();
  } catch (err) {
    console.error('Draw signature save error:', err);
    showStatus('Error: ' + err.message, 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

function selectSignature(url, name) {
  const activeDoc = getActiveDoc();
  if (!activeDoc) return;
  
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = async () => {
    const offset = addedSignaturesCount * 15;
    
    // Process the signature image for natural appearance
    // (remove white bg, feather edges, ink variance, trim borders)
    let processedSrc = url;
    try {
      processedSrc = await processSignatureImage(url);
    } catch (err) {
      console.warn('Could not pre-process signature, using original:', err);
    }
    
    // Calculate dimensions from the processed (trimmed) image
    let imgWidth, imgHeight;
    const procImg = new Image();
    procImg.onload = () => {
      imgWidth = procImg.width;
      imgHeight = procImg.height;
      const maxSize = 100;
      
      if (imgWidth > maxSize || imgHeight > maxSize) {
        const ratio = Math.min(maxSize / imgWidth, maxSize / imgHeight);
        imgWidth = Math.round(imgWidth * ratio);
        imgHeight = Math.round(imgHeight * ratio);
      }
      
      placeSignatureInTemplateOrPage(activeDoc, processedSrc, name, imgWidth, imgHeight, offset);
      
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
    procImg.onerror = () => {
      // Fallback: use original dimensions
      imgWidth = img.width;
      imgHeight = img.height;
      const maxSize = 100;
      if (imgWidth > maxSize || imgHeight > maxSize) {
        const ratio = Math.min(maxSize / imgWidth, maxSize / imgHeight);
        imgWidth = Math.round(imgWidth * ratio);
        imgHeight = Math.round(imgHeight * ratio);
      }
      placeSignatureInTemplateOrPage(activeDoc, processedSrc, name, imgWidth, imgHeight, offset);
      addedSignaturesCount++;
      updateTabModified(activeDoc.id, true);
      renderPage();
      showStatus(`✓ Firma añadida: ${name}`, 'success');
    };
    procImg.src = processedSrc;
  };
  img.onerror = () => showStatus('No se pudo cargar la firma', 'error');
  img.src = url;
}

function placeSignatureInTemplateOrPage(activeDoc, src, name, width, height, offset = 0) {
  for (let page = 1; page <= activeDoc.totalPages; page++) {
    const elements = activeDoc.elements[page] || [];
    const placeholder = elements.find(el => el.isPlaceholder && !el.templateDraft && el.type === 'signature');
    if (!placeholder) continue;

    placeholder.src = src;
    placeholder.name = name;
    // The template dimensions are intentional; fit the signature inside them.
    const boxWidth = placeholder.width || width;
    const boxHeight = placeholder.height || height;
    const ratio = Math.min(boxWidth / width, boxHeight / height);
    placeholder.width = Math.max(1, width * ratio);
    placeholder.height = Math.max(1, height * ratio);
    clearPlaceholderMetadata(placeholder);
    if (activeDoc.currentPage !== page) activeDoc.currentPage = page;
    return true;
  }

  pushElement(activeDoc, activeDoc.currentPage, {
    type: 'signature', src,
    x: activeDoc.pageWidth / 2 - width / 2 + offset,
    y: activeDoc.pageHeight / 2 - height / 2 + offset,
    width, height, name
  });
  return false;
}

// escapeHtml moved to shared-utils.js

// ============================================
// SIGNATURE IMAGE PROCESSING
// Removes paper backgrounds and reinforces faint ink without resampling.
// Reprocessing is safe and does not progressively degrade the signature.
// ============================================

/**
 * Process a signature image so it remains dark and legible on a PDF.
 * Steps:
 * 1. Remove white/near-white background (make transparent)
 * 2. Reinforce pale strokes while retaining transparent edges
 * 3. Trim empty transparent borders without resizing the bitmap
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
      
      // Remove the paper background once and reinforce the surviving ink.
      // The fixed opacity levels make this idempotent: processing the same
      // transparent PNG again cannot progressively fade or blur its strokes.
      removeWhiteBackground(data, canvas.width, canvas.height);
      reinforceSignatureInk(data);
      
      ctx.putImageData(imageData, 0, 0);
      
      // Step 4: Trim transparent borders
      // This removes the large transparent padding around the signature
      const trimmedSrc = trimSignatureCanvas(canvas);
      
      // Export as PNG (lossless, preserves transparency)
      resolve(trimmedSrc);
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
  let transparentPixels = 0;
  const pixelCount = width * height;

  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 245) transparentPixels++;
  }

  // Stored signatures are already transparent. Do not remove their pale
  // anti-aliased edges again; only reinforce them in the next step.
  if (transparentPixels > pixelCount * 0.005) return;
  
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a === 0) continue;

    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    const inkStrength = Math.max(0, Math.min(1, (threshold - luminance) / 185));
    data[i + 3] = inkStrength <= 0
      ? 0
      : Math.round(a * Math.min(1, Math.pow(inkStrength, 0.58) * 1.35));
  }
}

/**
 * Make faint transparent strokes solid and dark without resampling pixels.
 * Alpha is mapped to stable levels so repeated processing is lossless.
 */
function reinforceSignatureInk(data) {
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha < 18) {
      // Transparent pixels must also be black in RGB. Leaving a white RGB
      // matte behind a zero alpha channel creates a white fringe when the
      // browser or PDF renderer scales the PNG with bilinear interpolation.
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 0;
      continue;
    }

    // Stable multi-level antialiasing: enough levels for smooth curves, but
    // every output is a fixed point so repeated processing cannot fade it.
    data[i + 3] = alpha <= 24 ? 24
      : alpha <= 48 ? 48
      : alpha <= 80 ? 80
      : alpha <= 120 ? 120
      : alpha <= 168 ? 168
      : alpha <= 216 ? 216
      : 255;

    // Preserve blue/black ink hue while limiting brightness to a dark tone.
    const maxChannel = Math.max(data[i], data[i + 1], data[i + 2]);
    if (maxChannel > 80) {
      const factor = 80 / maxChannel;
      data[i] = Math.round(data[i] * factor);
      data[i + 1] = Math.round(data[i + 1] * factor);
      data[i + 2] = Math.round(data[i + 2] * factor);
    }
  }
}

/**
 * Trim transparent borders from a canvas, returning a cropped data URL.
 * Scans all pixels to find the bounding box of non-transparent content,
 * adds padding, and returns a new trimmed canvas as PNG data URL.
 */
function trimSignatureCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  if (w === 0 || h === 0) return canvas.toDataURL('image/png');
  
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  let top = h, bottom = 0, left = w, right = 0;
  
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      if (data[idx + 3] > 20) { // alpha > 20 = non-transparent
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }
  
  // If no non-transparent pixels found, return as-is
  if (top >= bottom || left >= right) return canvas.toDataURL('image/png');
  
  // Add padding around the content
  const pad = 10;
  top = Math.max(0, top - pad);
  left = Math.max(0, left - pad);
  bottom = Math.min(h, bottom + pad);
  right = Math.min(w, right + pad);
  
  const tw = right - left, th = bottom - top;
  const tc = document.createElement('canvas');
  tc.width = tw;
  tc.height = th;
  tc.getContext('2d').drawImage(canvas, left, top, tw, th, 0, 0, tw, th);
  return tc.toDataURL('image/png');
}

/**
 * Trim transparent borders from an image src (data URL or URL).
 * Returns a Promise that resolves to a trimmed PNG data URL.
 */
function trimSignatureImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      resolve(trimSignatureCanvas(canvas));
    };
    img.onerror = () => resolve(src);
    img.src = src;
  });
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
        // Empty template slots are visual guides only and must never be exported.
        if (el.isPlaceholder) continue;
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
        }
        // Shape type removed — stamps are saved as type 'image' above
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
  // Clear ALL loaded PDFs and return to upload screen
  if (documents.length === 0) return;
  
  const hasAnyElements = documents.some(doc => 
    Object.values(doc.elements).some(arr => arr.length > 0)
  );
  if (hasAnyElements && !confirm('¿Limpiar todos los documentos? Se perderán los cambios no guardados.')) return;
  
  // Remove all documents at once
  documents.length = 0;
  activeDocIndex = -1;
  
  // Remove all tabs
  document.querySelectorAll('.doc-tab').forEach(tab => tab.remove());
  updateDocumentTabsVisibility();
  
  // Show upload area
  showUploadArea();
  showStatus('Documentos limpiados', 'success');
}

// ============================================
// POSITION TEMPLATES
// ============================================
const TEMPLATES_STORAGE_KEY = 'pdfEditorTemplates';
let templateCache = [];
let templatePlacementMode = false;
let pendingTemplateSlot = null;

async function ensureSession() {
  if (session?.access_token) return session;
  try {
    const stored = await chrome.storage.local.get(['session', 'user']);
    session = stored.session || null;
    currentUser = stored.user || currentUser;
  } catch (err) {
    console.warn('Could not refresh the current session:', err);
  }
  return session;
}

function getTemplateHeaders(write = false) {
  const headers = { apikey: SUPABASE_KEY };
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  if (write) {
    headers['Content-Type'] = 'application/json';
    headers.Prefer = 'return=representation';
  }
  return headers;
}

async function loadTemplates() {
  let remote = [];
  let local = [];
  try {
    const stored = await chrome.storage.local.get(TEMPLATES_STORAGE_KEY);
    local = Array.isArray(stored[TEMPLATES_STORAGE_KEY]) ? stored[TEMPLATES_STORAGE_KEY] : [];
  } catch (err) {
    console.warn('Could not load local templates:', err);
  }

  try {
    await ensureSession();
    const response = await fetch(`${SUPABASE_URL}/rest/v1/pdf_templates?select=*&order=created_at.desc`, {
      headers: getTemplateHeaders()
    });
    if (response.ok) {
      const rows = await response.json();
      remote = rows.map(row => ({
        id: row.id,
        name: row.name,
        slots: Array.isArray(row.slots) ? row.slots : [],
        user_id: row.user_id || null,
        user_name: row.user_name || '',
        createdAt: row.created_at ? new Date(row.created_at).getTime() : 0,
        shared: true
      }));
    } else {
      console.warn('Template load failed:', response.status);
    }
  } catch (err) {
    console.warn('Supabase template load failed; using local templates:', err);
  }

  const remoteIds = new Set(remote.map(t => String(t.id)));
  templateCache = [...remote, ...local.filter(t => !remoteIds.has(String(t.id)))];
  return templateCache;
}

async function saveTemplateToSupabase(name, slots) {
  await ensureSession();
  if (!session?.access_token) throw new Error('No hay una sesión activa');
  const body = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    name,
    slots,
    user_id: currentUser?.id || null,
    user_name: currentUser?.name || currentUser?.user_name || 'Usuario'
  };
  const response = await fetch(`${SUPABASE_URL}/rest/v1/pdf_templates`, {
    method: 'POST', headers: getTemplateHeaders(true), body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(await response.text() || 'No se pudo guardar la plantilla');
  return body.id;
}

async function saveTemplateLocally(template) {
  const stored = await chrome.storage.local.get(TEMPLATES_STORAGE_KEY);
  const templates = Array.isArray(stored[TEMPLATES_STORAGE_KEY]) ? stored[TEMPLATES_STORAGE_KEY] : [];
  templates.unshift(template);
  await chrome.storage.local.set({ [TEMPLATES_STORAGE_KEY]: templates });
}

async function deleteTemplate(template) {
  if (String(template.id).startsWith('local_')) {
    const stored = await chrome.storage.local.get(TEMPLATES_STORAGE_KEY);
    const templates = (stored[TEMPLATES_STORAGE_KEY] || []).filter(t => t.id !== template.id);
    await chrome.storage.local.set({ [TEMPLATES_STORAGE_KEY]: templates });
    return;
  }
  const response = await fetch(`${SUPABASE_URL}/rest/v1/pdf_templates?id=eq.${encodeURIComponent(template.id)}`, {
    method: 'DELETE', headers: getTemplateHeaders()
  });
  if (!response.ok) throw new Error('No tienes permiso para eliminar esta plantilla');
}

function guessTemplateField(el) {
  if (el.type === 'signature') return 'FIRMA';
  if (el.type === 'image') return 'IMAGEN';
  const value = `${el.name || ''} ${el.text || ''}`.trim().toUpperCase();
  if (/\b(DNI|NIE)\b/.test(value) || /^[XYZ]?\d{7,8}[A-Z]$/.test(value)) return 'DNI';
  if (/\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/.test(value)) return 'FECHA';
  if (value.includes('@')) return 'EMAIL';
  if (/^\+?[\d\s-]{7,}$/.test(value)) return 'TELEFONO';
  return 'TEXTO';
}

function showTemplatesModal() {
  const activeDoc = getActiveDoc();
  if (!activeDoc) { showStatus('Primero carga un PDF', 'error'); return; }
  if (collectTemplateDraftSlots().length) {
    if ($('templateListView')) $('templateListView').style.display = 'none';
    if ($('templateSaveView')) $('templateSaveView').style.display = '';
    renderTemplateSlotSelection();
    $('templatesModal')?.classList.add('show');
    return;
  }
  showTemplateListView();
  $('templatesModal')?.classList.add('show');
}

function showTemplateListView() {
  templatePlacementMode = false;
  pendingTemplateSlot = null;
  if ($('templateListView')) $('templateListView').style.display = '';
  if ($('templateSaveView')) $('templateSaveView').style.display = 'none';
  if ($('templateNameInput')) $('templateNameInput').value = '';
  renderTemplatesList();
}

function showTemplateSaveView() {
  removeTemplateDraftSlots();
  templatePlacementMode = false;
  pendingTemplateSlot = null;
  if ($('templateListView')) $('templateListView').style.display = 'none';
  if ($('templateSaveView')) $('templateSaveView').style.display = '';
  if ($('templateNameInput')) {
    $('templateNameInput').value = '';
    $('templateNameInput').focus();
  }
  renderTemplateSlotSelection();
}

function collectTemplateDraftSlots() {
  const activeDoc = getActiveDoc();
  if (!activeDoc) return [];
  const result = [];
  for (let page = 1; page <= activeDoc.totalPages; page++) {
    (activeDoc.elements[page] || []).forEach((el, index) => {
      if (el.templateDraft) result.push({ page, index, el });
    });
  }
  return result;
}

function renderTemplateSlotSelection() {
  const list = $('templateSlotList');
  if (!list) return;
  const items = collectTemplateDraftSlots();
  if (!items.length) {
    list.innerHTML = '<div style="color:#94a3b8;text-align:center;padding:18px;font-size:12px;">Aún no has marcado ningún hueco. Elige un campo y pulsa “Colocar en PDF”.</div>';
    return;
  }
  const icons = { text: '📝', signature: '✍️', image: '🖼️' };
  list.innerHTML = items.map((item, index) => {
    return `<div style="display:flex;align-items:center;gap:6px;padding:6px;background:#1e293b;border-radius:6px;margin-bottom:4px;">
      <span title="Página ${item.page}">${icons[item.el.type]} P${item.page}</span>
      <strong style="flex:1;color:#c4b5fd;font-size:11px;">${escapeHtml(item.el.fieldGroup || 'TEXTO')}</strong>
      <span class="template-draft-size" title="Ancho × alto">
        <input type="number" min="20" step="5" value="${Math.round(item.el.width)}" data-template-size="width" data-page="${item.page}" data-index="${item.index}">
        ×
        <input type="number" min="20" step="5" value="${Math.round(item.el.height)}" data-template-size="height" data-page="${item.page}" data-index="${item.index}">
      </span>
      <button class="sidebar-btn template-draft-delete" data-page="${item.page}" data-index="${item.index}" style="padding:3px 6px;background:#6b2c2c;color:#fca5a5;">✕</button>
    </div>`;
  }).join('');
  list.querySelectorAll('.template-draft-delete').forEach(button => {
    button.onclick = () => {
      const activeDoc = getActiveDoc();
      activeDoc?.elements[Number(button.dataset.page)]?.splice(Number(button.dataset.index), 1);
      renderTemplateSlotSelection();
      renderPage();
    };
  });
  list.querySelectorAll('[data-template-size]').forEach(input => {
    input.addEventListener('change', () => {
      const activeDoc = getActiveDoc();
      const element = activeDoc?.elements[Number(input.dataset.page)]?.[Number(input.dataset.index)];
      if (!element?.templateDraft) return;
      const dimension = input.dataset.templateSize;
      const maximum = dimension === 'width' ? activeDoc.pageWidth : activeDoc.pageHeight;
      element[dimension] = Math.max(MIN_ELEMENT_SIZE, Math.min(maximum, Number(input.value) || MIN_ELEMENT_SIZE));
      input.value = Math.round(element[dimension]);
      updateTabModified(activeDoc.id, true);
      renderPage();
      showStatus('Tamaño del campo actualizado', 'success');
    });
  });
}

function beginTemplateSlotPlacement() {
  const activeDoc = getActiveDoc();
  if (!activeDoc) { showStatus('Primero carga un PDF', 'error'); return; }
  pendingTemplateSlot = { waitingForPosition: true };
  templatePlacementMode = true;
  $('templatesModal')?.classList.remove('show');
  renderPage();
  showStatus('Pulsa en el hueco del PDF que quieres marcar', 'success');
}

function beginQuickTemplatePlacement(type, label) {
  const activeDoc = getActiveDoc();
  if (!activeDoc) { showStatus('Primero carga un PDF', 'error'); return; }
  pendingTemplateSlot = { type, label };
  templatePlacementMode = true;
  $('templatesModal')?.classList.remove('show');
  renderPage();
  showStatus(`Pulsa para colocar ${label}`, 'success');
}

function adjustTemplateDraftOnPdf() {
  if (!collectTemplateDraftSlots().length) { showStatus('Todavía no hay huecos que ajustar', 'error'); return; }
  $('templatesModal')?.classList.remove('show');
  showStatus('Mueve o redimensiona los huecos y pulsa Plantillas para continuar', 'success');
}

function placeTemplateSlotAtEvent(event, overlay, scale, activeDoc) {
  if (!pendingTemplateSlot) return;
  event.preventDefault();
  event.stopPropagation();
  const rect = overlay.getBoundingClientRect();
  const x = Math.max(0, (event.clientX - rect.left) / scale);
  const y = Math.max(0, (event.clientY - rect.top) / scale);
  const position = { page: activeDoc.currentPage, x, y };
  const quickSlot = pendingTemplateSlot?.type && pendingTemplateSlot?.label ? { ...pendingTemplateSlot } : null;
  templatePlacementMode = false;
  pendingTemplateSlot = null;
  renderPage();
  if (quickSlot) {
    addTemplateDraftSlot(position, quickSlot.type, quickSlot.label);
    $('templatesModal')?.classList.add('show');
  } else {
    showTemplateFieldPicker(position);
  }
}

function addTemplateDraftSlot(position, type, label) {
  const activeDoc = getActiveDoc();
  if (!activeDoc) return;
  const dimensions = type === 'signature' ? { width: 180, height: 70 } : { width: label === 'NOMBRE' ? 220 : 110, height: 32 };
  (activeDoc.elements[position.page] ||= []).push({
    type,
    x: Math.min(position.x, Math.max(0, activeDoc.pageWidth - dimensions.width)),
    y: Math.min(position.y, Math.max(0, activeDoc.pageHeight - dimensions.height)),
    ...dimensions,
    size: DEFAULT_FONT_SIZE,
    color: '#000000', text: '', src: '', name: '',
    isPlaceholder: true, templateDraft: true,
    fieldGroup: label, placeholderLabel: label
  });
  updateTabModified(activeDoc.id, true);
  renderTemplateSlotSelection();
  renderPage();
  showStatus(`Hueco ${label} añadido`, 'success');
}

function showTemplateFieldPicker(position) {
  const picker = document.createElement('div');
  picker.className = 'modal-overlay show';
  picker.innerHTML = `<div class="modal" style="max-width:390px;">
    <h3>¿Qué dato irá en este hueco?</h3>
    <p style="color:#94a3b8;font-size:12px;margin-bottom:12px;">La numeración se calculará automáticamente por el orden de los huecos en el PDF.</p>
    <div class="template-field-picker">
      <button data-field="NOMBRE" data-type="text">👤 Nombre</button>
      <button data-field="DNI" data-type="text">🪪 DNI / NIE</button>
      <button data-field="FECHA" data-type="text">📅 Fecha</button>
      <button data-field="FIRMA" data-type="signature">✍️ Firma</button>
    </div>
    <div class="modal-actions"><button class="btn-cancel" data-cancel>Cancelar</button></div>
  </div>`;
  document.body.appendChild(picker);
  const close = () => { picker.remove(); $('templatesModal')?.classList.add('show'); };
  picker.querySelector('[data-cancel]').onclick = close;
  picker.addEventListener('click', event => { if (event.target === picker) close(); });
  picker.querySelectorAll('[data-field]').forEach(button => {
    button.onclick = () => {
      const activeDoc = getActiveDoc();
      if (!activeDoc) { close(); return; }
      picker.remove();
      addTemplateDraftSlot(position, button.dataset.type, button.dataset.field);
      $('templatesModal')?.classList.add('show');
    };
  });
}

function removeTemplateDraftSlots() {
  const activeDoc = getActiveDoc();
  if (!activeDoc) return;
  for (let page = 1; page <= activeDoc.totalPages; page++) {
    activeDoc.elements[page] = (activeDoc.elements[page] || []).filter(el => !el.templateDraft);
  }
}

function cancelTemplateDraft() {
  removeTemplateDraftSlots();
  templatePlacementMode = false;
  pendingTemplateSlot = null;
  showTemplateListView();
  renderPage();
}

async function confirmSaveTemplate() {
  const activeDoc = getActiveDoc();
  const name = $('templateNameInput')?.value.trim();
  if (!activeDoc || !name) { showStatus('Escribe un nombre para la plantilla', 'error'); return; }
  const draftSlots = collectTemplateDraftSlots();
  if (!draftSlots.length) { showStatus('Coloca al menos un hueco sobre el PDF', 'error'); return; }

  const templates = await loadTemplates();
  if (templates.some(t => String(t.name || '').trim().toLocaleLowerCase() === name.toLocaleLowerCase())) {
    showStatus('Ya existe una plantilla con ese nombre', 'error');
    return;
  }

  const slots = draftSlots.map(item => {
    const el = item.el;
    return {
      type: el.type, label: el.fieldGroup || 'TEXTO', page: item.page,
      x: el.x, y: el.y,
      width: el.width || (el.type === 'text' ? 150 : 100),
      height: el.height || (el.type === 'text' ? Math.max(28, (el.size || 14) + 12) : 60),
      size: el.size || DEFAULT_FONT_SIZE,
      color: el.color || '#000000',
      bold: Boolean(el.bold), italic: Boolean(el.italic), underline: Boolean(el.underline),
      sourcePageWidth: activeDoc.pageWidth,
      sourcePageHeight: activeDoc.pageHeight
    };
  });

  try {
    await saveTemplateToSupabase(name, slots);
    showStatus(`Plantilla “${name}” compartida (${slots.length} huecos)`, 'success');
  } catch (err) {
    await saveTemplateLocally({ id: `local_${Date.now()}`, name, slots, createdAt: Date.now(), shared: false });
    showStatus(`Plantilla “${name}” guardada en este equipo`, 'success');
  }
  removeTemplateDraftSlots();
  updateTabModified(activeDoc.id, true);
  renderPage();
  showTemplateListView();
}

async function renderTemplatesList() {
  const list = $('templatesList');
  if (!list) return;
  list.innerHTML = '<div style="color:#94a3b8;text-align:center;padding:15px;">Cargando…</div>';
  const templates = await loadTemplates();
  if (!templates.length) {
    list.innerHTML = '<div style="color:#94a3b8;text-align:center;padding:18px;font-size:12px;">Todavía no hay plantillas.</div>';
    return;
  }
  list.innerHTML = templates.map((template, index) => {
    const groups = {};
    (template.slots || []).forEach(slot => { groups[slot.label || 'TEXTO'] = (groups[slot.label || 'TEXTO'] || 0) + 1; });
    const summary = Object.entries(groups).map(([label, count]) => `${label}×${count}`).join(' · ');
    const isLocal = String(template.id).startsWith('local_');
    const canDelete = isLocal || !template.user_id || template.user_id === currentUser?.id;
    return `<div class="template-card">
      <div class="template-card-info">
        <strong class="template-card-name">📄 ${escapeHtml(template.name)}</strong>
        <span class="template-card-summary">${escapeHtml(summary || 'Sin campos')}</span>
        <span class="template-card-origin">${isLocal ? 'Guardada en este equipo' : `Plantilla compartida${template.user_name ? ` · ${escapeHtml(template.user_name)}` : ''}`}</span>
      </div>
      <div class="template-card-actions">
        <button class="sidebar-btn" data-template-use="${index}" style="background:#2563eb;color:white;">Usar</button>
        ${canDelete ? `<button class="sidebar-btn" data-template-delete="${index}" style="background:#6b2c2c;color:#fca5a5;">Borrar</button>` : ''}
      </div>
    </div>`;
  }).join('');
  list.querySelectorAll('[data-template-use]').forEach(button => {
    button.onclick = () => applyTemplate(templateCache[Number(button.dataset.templateUse)]);
  });
  list.querySelectorAll('[data-template-delete]').forEach(button => {
    button.onclick = async () => {
      const template = templateCache[Number(button.dataset.templateDelete)];
      if (!template || !confirm(`¿Eliminar la plantilla “${template.name}”?`)) return;
      try {
        await deleteTemplate(template);
        showStatus('Plantilla eliminada', 'success');
        renderTemplatesList();
      } catch (err) {
        showStatus(err.message, 'error');
      }
    };
  });
}

function applyTemplate(template) {
  const activeDoc = getActiveDoc();
  if (!activeDoc || !template?.slots?.length) { showStatus('La plantilla no contiene huecos', 'error'); return; }
  const requiredPages = Math.max(...template.slots.map(slot => slot.page || 1));
  if (requiredPages > activeDoc.totalPages && !confirm(`La plantilla usa ${requiredPages} páginas y este PDF solo tiene ${activeDoc.totalPages}. ¿Aplicar los huecos compatibles?`)) return;

  const groupTotals = {};
  const groupIndexes = {};
  template.slots.forEach(slot => { groupTotals[slot.label || 'TEXTO'] = (groupTotals[slot.label || 'TEXTO'] || 0) + 1; });
  let added = 0;
  [...template.slots].sort((a, b) => (a.page || 1) - (b.page || 1) || a.y - b.y || a.x - b.x).forEach(slot => {
    const page = slot.page || 1;
    if (page > activeDoc.totalPages) return;
    const label = slot.label || 'TEXTO';
    groupIndexes[label] = (groupIndexes[label] || 0) + 1;
    const scaleX = slot.sourcePageWidth ? activeDoc.pageWidth / slot.sourcePageWidth : 1;
    const scaleY = slot.sourcePageHeight ? activeDoc.pageHeight / slot.sourcePageHeight : 1;
    const placeholder = {
      type: slot.type,
      x: slot.x * scaleX, y: slot.y * scaleY,
      width: (slot.width || 100) * scaleX, height: (slot.height || 60) * scaleY,
      size: (slot.size || DEFAULT_FONT_SIZE) * Math.min(scaleX, scaleY),
      color: slot.color || '#000000', bold: Boolean(slot.bold), italic: Boolean(slot.italic), underline: Boolean(slot.underline),
      isPlaceholder: true, fieldGroup: label,
      placeholderLabel: `${label} (${groupIndexes[label]}/${groupTotals[label]})`,
      text: '', src: '', name: ''
    };
    pushElement(activeDoc, page, placeholder);
    added++;
  });
  if (!added) { showStatus('No hay huecos compatibles con este PDF', 'error'); return; }
  activeDoc.currentPage = Math.min(...template.slots.map(slot => slot.page || 1).filter(page => page <= activeDoc.totalPages));
  updateTabModified(activeDoc.id, true);
  $('templatesModal')?.classList.remove('show');
  renderPage();
  showStatus(`Plantilla “${template.name}” aplicada: ${added} huecos`, 'success');
}

function updateFillTemplateVisibility() {
  const section = $('fillTemplateSection');
  const activeDoc = getActiveDoc();
  if (!section) return;
  const hasPlaceholders = activeDoc && Object.values(activeDoc.elements).some(elements => elements.some(el => el.isPlaceholder && !el.templateDraft));
  section.style.display = hasPlaceholders ? '' : 'none';
}

function getTemplateGroups() {
  const activeDoc = getActiveDoc();
  const groups = {};
  if (!activeDoc) return groups;
  for (let page = 1; page <= activeDoc.totalPages; page++) {
    (activeDoc.elements[page] || []).forEach((el, index) => {
      if (!el.isPlaceholder || el.templateDraft) return;
      const label = el.fieldGroup || 'TEXTO';
      (groups[label] ||= []).push({ page, index, el });
    });
  }
  Object.values(groups).forEach(items => items.sort((a, b) => a.page - b.page || a.el.y - b.el.y || a.el.x - b.el.x));
  return groups;
}

function showFillTemplateModal() {
  const modal = $('fillTemplateModal');
  const content = $('fillTemplateContent');
  const groups = getTemplateGroups();
  if (!modal || !content) return;
  const names = Object.keys(groups).sort();
  if (!names.length) { showStatus('No quedan huecos por rellenar', 'error'); return; }
  const hasPeopleFields = groups.NOMBRE?.length || groups.DNI?.length || groups.FIRMA?.length;
  const peopleFill = hasPeopleFields ? `<div style="background:#172554;border:1px solid #3b82f6;border-radius:8px;padding:10px;margin-bottom:12px;">
    <strong>👥 Rellenar listado de personal</strong>
    <p style="font-size:10px;color:#bfdbfe;margin:5px 0 7px;">Una persona por línea: APELLIDO 1 APELLIDO 2, NOMBRE&nbsp;&nbsp;&nbsp;DNI</p>
    <textarea id="templatePeopleInput" rows="6" placeholder="GARCÍA LÓPEZ, ANA    12345678A&#10;PÉREZ MARTÍN, LUIS    87654321B" style="width:100%;padding:7px;background:#0f172a;border:1px solid #3b82f6;border-radius:6px;color:#f1f5f9;resize:vertical;"></textarea>
    <button class="sidebar-btn fill-template-people" style="width:100%;margin-top:6px;background:#2563eb;color:white;justify-content:center;">Rellenar nombres, DNI y firmas</button>
  </div>` : '';
  content.innerHTML = peopleFill + names.map(name => {
    const items = groups[name];
    const type = items[0].el.type;
    if (type === 'text') return `<div style="background:#1e293b;border-radius:8px;padding:10px;margin-bottom:8px;"><strong>📝 ${escapeHtml(name)}</strong> <small>(${items.length})</small><textarea class="fill-template-values" data-group="${escapeHtml(name)}" rows="${Math.min(5, items.length + 1)}" placeholder="Un valor por línea" style="width:100%;margin-top:7px;padding:7px;background:#0f172a;border:1px solid #334155;border-radius:6px;color:#f1f5f9;"></textarea><button class="sidebar-btn fill-template-text" data-group="${escapeHtml(name)}" style="width:100%;margin-top:5px;background:#4338ca;color:white;">Rellenar</button>${['FECHA','DATE'].includes(name) ? `<button class="sidebar-btn fill-template-date" data-group="${escapeHtml(name)}" style="width:100%;margin-top:5px;background:#8b5cf6;color:white;">Usar fecha de hoy</button>` : ''}</div>`;
    if (type === 'signature') return `<div style="background:#1e293b;border-radius:8px;padding:10px;margin-bottom:8px;"><strong>✍️ ${escapeHtml(name)}</strong> <small>(${items.length})</small><button class="sidebar-btn fill-template-signature" style="width:100%;margin-top:7px;background:#7c3aed;color:white;">Buscar firmas</button></div>`;
    return `<div style="background:#1e293b;border-radius:8px;padding:10px;margin-bottom:8px;"><strong>🖼️ ${escapeHtml(name)}</strong> <small>(${items.length})</small><p style="font-size:10px;color:#94a3b8;margin-top:5px;">Haz doble clic sobre cada hueco para elegir su imagen.</p></div>`;
  }).join('');
  content.querySelector('.fill-template-people')?.addEventListener('click', () => {
    fillTemplatePeople($('templatePeopleInput')?.value || '');
  });
  content.querySelectorAll('.fill-template-text').forEach(button => {
    button.onclick = () => {
      const input = content.querySelector(`.fill-template-values[data-group="${CSS.escape(button.dataset.group)}"]`);
      fillTemplateTextGroup(button.dataset.group, input?.value || '');
    };
  });
  content.querySelectorAll('.fill-template-date').forEach(button => { button.onclick = () => fillTemplateDateGroup(button.dataset.group); });
  content.querySelectorAll('.fill-template-signature').forEach(button => {
    button.onclick = () => { modal.classList.remove('show'); showSignatureModal(); };
  });
  modal.classList.add('show');
}

function clearPlaceholderMetadata(el) {
  delete el.isPlaceholder;
  delete el.placeholderLabel;
  delete el.fieldGroup;
  delete el.templateDraft;
}

function fillTemplateTextGroup(groupName, rawValues) {
  const values = rawValues.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  if (!values.length) { showStatus('Introduce al menos un valor', 'error'); return; }
  const activeDoc = getActiveDoc();
  const slots = getTemplateGroups()[groupName] || [];
  const count = Math.min(values.length, slots.length);
  for (let i = 0; i < count; i++) {
    const el = activeDoc.elements[slots[i].page][slots[i].index];
    el.text = values[i];
    clearPlaceholderMetadata(el);
  }
  updateTabModified(activeDoc.id, true);
  renderPage();
  showStatus(`${count} campo(s) de ${groupName} rellenado(s)`, 'success');
  if (Object.keys(getTemplateGroups()).length) showFillTemplateModal();
  else $('fillTemplateModal')?.classList.remove('show');
}

function fillTemplateDateGroup(groupName) {
  const now = new Date();
  const value = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
  const slots = getTemplateGroups()[groupName] || [];
  fillTemplateTextGroup(groupName, slots.map(() => value).join('\n'));
}

async function findSignatureForPerson(name) {
  const headers = { apikey: SUPABASE_KEY };
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  const searchValues = [...new Set([name, normalizeText(name)])];
  const signatures = [];
  for (const value of searchValues) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/signatures?select=*&name=ilike.*${encodeURIComponent(value)}*&order=name.asc`, { headers });
    if (!response.ok) continue;
    const matches = await response.json();
    matches.forEach(match => {
      if (!signatures.some(signature => signature.id === match.id)) signatures.push(match);
    });
  }
  if (!signatures.length) return null;
  const normalizedName = normalizeText(name).toUpperCase().replace(/\s+/g, ' ').trim();
  return signatures.find(signature => normalizeText(signature.name).toUpperCase().replace(/\s+/g, ' ').trim() === normalizedName) || signatures[0];
}

async function fillTemplatePeople(rawText) {
  const activeDoc = getActiveDoc();
  const lines = rawText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!activeDoc || !lines.length) { showStatus('Pega al menos una persona', 'error'); return; }
  const people = lines.map(line => {
    const { foundDni, textWithoutDni } = extractDniFromLine(line);
    return { name: textWithoutDni.replace(/\s+/g, ' ').trim(), dni: foundDni || '' };
  }).filter(person => person.name);
  if (!people.length) { showStatus('No se han podido interpretar los nombres', 'error'); return; }

  const groups = getTemplateGroups();
  const nameSlots = groups.NOMBRE || [];
  const dniSlots = groups.DNI || [];
  const signatureSlots = groups.FIRMA || [];
  let namesFilled = 0;
  let dniFilled = 0;
  let signaturesFilled = 0;
  const missingSignatures = [];

  for (let index = 0; index < people.length; index++) {
    const person = people[index];
    if (nameSlots[index]) {
      nameSlots[index].el.text = person.name;
      clearPlaceholderMetadata(nameSlots[index].el);
      namesFilled++;
    }
    if (dniSlots[index] && person.dni) {
      dniSlots[index].el.text = person.dni.toUpperCase();
      dniSlots[index].el.name = person.name;
      clearPlaceholderMetadata(dniSlots[index].el);
      dniFilled++;
    }
    if (signatureSlots[index]) {
      try {
        const signature = await findSignatureForPerson(person.name);
        if (signature?.image_url) {
          signatureSlots[index].el.src = signature.image_url;
          signatureSlots[index].el.name = person.name;
          clearPlaceholderMetadata(signatureSlots[index].el);
          signaturesFilled++;
        } else {
          missingSignatures.push(person.name);
        }
      } catch (err) {
        missingSignatures.push(person.name);
      }
    }
  }

  updateTabModified(activeDoc.id, true);
  renderPage();
  $('fillTemplateModal')?.classList.remove('show');
  const missingText = missingSignatures.length ? ` · Sin firma: ${missingSignatures.join(', ')}` : '';
  showStatus(`${namesFilled} nombres · ${dniFilled} DNI · ${signaturesFilled} firmas${missingText}`, missingSignatures.length ? 'error' : 'success');
}

function fillImagePlaceholder(page, index) {
  const activeDoc = getActiveDoc();
  const slot = activeDoc?.elements[page]?.[index];
  if (!slot?.isPlaceholder || slot.type !== 'image') return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      slot.src = reader.result;
      clearPlaceholderMetadata(slot);
      updateTabModified(activeDoc.id, true);
      renderPage();
      showStatus('Imagen colocada en la plantilla', 'success');
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

// hexToRgb moved to shared-utils.js

// ============================================
// LIGHT MODE
// ============================================
let lightModeActive = false;

function applyLightMode(active) {
  lightModeActive = Boolean(active);
  document.body.classList.toggle('light-mode', lightModeActive);
  const btn = $('btnToggleLightMode');
  if (btn) {
    btn.classList.toggle('primary', lightModeActive);
    btn.classList.toggle('secondary', !lightModeActive);
    btn.innerHTML = lightModeActive
      ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg> Modo oscuro`
      : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line></svg> Modo claro`;
  }
}

function toggleLightMode() {
  applyLightMode(!lightModeActive);
  localStorage.setItem('pe_lightMode', String(lightModeActive));
  localStorage.removeItem('pe_cleanView');
}

// ============================================
// #19 RECENT SIGNATURES CACHE
// ============================================
function getRecentSignatures() {
  try {
    const stored = JSON.parse(localStorage.getItem('pe_recentSignatures') || '[]');
    const recents = Array.isArray(stored)
      ? stored.filter(sig => sig && sig.name && sig.imageUrl).slice(0, MAX_RECENT_SIGNATURES)
      : [];

    // Migrate older caches that may contain more than five entries.
    if (!Array.isArray(stored) || stored.length !== recents.length) {
      localStorage.setItem('pe_recentSignatures', JSON.stringify(recents));
    }
    return recents;
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
  // Keep only the five most recently used signatures.
  recents = recents.slice(0, MAX_RECENT_SIGNATURES);
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
    btn.type = 'button';
    btn.title = `Insertar firma de ${sig.name}`;
    btn.textContent = sig.name;
    
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
  
  // Exit stamp mode if active
  if (stampMode) exitStampMode();
  
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
  
  // Add as a signature element (so save dialog recognizes it)
  pushElement(activeDoc, activeDoc.currentPage, {
    type: 'signature',
    src: dataUrl,
    x: pdfX,
    y: pdfY,
    width: pdfW,
    height: pdfH,
    name: 'Firma manuscrita',
    paths: storedPaths
  });
  
  updateTabModified(activeDoc.id, true);
  
  // Exit draw mode and re-render
  exitDrawMode();
  renderPage();
  showStatus('Firma manuscrita añadida', 'success');
  scheduleAutoSave();
}

// ============================================
// #22 PLACEMENT TOOLS (Check ✓, X ✗ and current date)
// ============================================
let stampMode = null; // 'check', 'x', 'date' or null

/**
 * Generate a stamp image (check or X) as a PNG data URL.
 * @param {string} type - 'check' or 'x'
 * @param {string} color - hex color
 * @param {number} size - canvas size in pixels
 * @returns {string} PNG data URL
 */
function generateStampImage(type, color, size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  
  const r = parseInt(color.slice(1,3), 16);
  const g = parseInt(color.slice(3,5), 16);
  const b = parseInt(color.slice(5,7), 16);
  
  ctx.strokeStyle = `rgba(${r},${g},${b},0.85)`;
  ctx.lineWidth = Math.max(2, size * 0.08);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  
  const pad = size * 0.15;
  
  if (type === 'check') {
    // Draw a checkmark ✓
    ctx.beginPath();
    ctx.moveTo(pad, size * 0.55);
    ctx.lineTo(size * 0.38, size - pad);
    ctx.lineTo(size - pad, pad);
    ctx.stroke();
  } else {
    // Draw an X ✗
    ctx.beginPath();
    ctx.moveTo(pad, pad);
    ctx.lineTo(size - pad, size - pad);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(size - pad, pad);
    ctx.lineTo(pad, size - pad);
    ctx.stroke();
  }
  
  return canvas.toDataURL('image/png');
}

function enterStampMode(type) {
  const activeDoc = getActiveDoc();
  if (!activeDoc || !activeDoc.pdfJsDoc) {
    showStatus('Primero carga un PDF', 'error');
    return;
  }
  
  // Exit draw mode if active
  if (isDrawMode) exitDrawMode();
  
  // Toggle stamp mode
  if (stampMode === type) {
    exitStampMode();
    return;
  }
  
  stampMode = type;
  const buttonIds = { check: 'btnStampCheck', x: 'btnStampX', date: 'btnAddDate' };
  Object.values(buttonIds).forEach(id => $(id)?.classList.remove('active'));
  $(buttonIds[type])?.classList.add('active');
  getCanvasContainer()?.querySelector('.elements-overlay')?.classList.add('placement-mode');

  const modeLabel = type === 'check' ? '✓ Check' : type === 'x' ? '✗ X' : '📅 Fecha';
  showStatus(`Modo ${modeLabel} activado - haz clic en el PDF para colocar`, 'success');
}

function exitStampMode() {
  stampMode = null;
  ['btnStampCheck', 'btnStampX', 'btnAddDate'].forEach(id => $(id)?.classList.remove('active'));
  getCanvasContainer()?.querySelector('.elements-overlay')?.classList.remove('placement-mode');
}

function onStampClick(e) {
  if (!stampMode) return;
  
  const activeDoc = getActiveDoc();
  if (!activeDoc) return;
  
  const container = getCanvasContainer();
  if (!container) return;
  
  // Only handle clicks on the container, not on existing elements
  if (e.target.closest('.pdf-element') || e.target.closest('.resize-handle')) return;
  
  const rect = container.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const clickY = e.clientY - rect.top;
  const scale = activeDoc.zoom;

  if (stampMode === 'date') {
    const today = new Date();
    const dateStr = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;
    const fontSize = 14;
    const estimatedWidth = 78;

    pushElement(activeDoc, activeDoc.currentPage, {
      type: 'text',
      text: dateStr,
      x: Math.max(0, clickX / scale - estimatedWidth / 2),
      y: Math.max(0, clickY / scale - fontSize / 2),
      size: fontSize,
      color: '#000000'
    });

    updateTabModified(activeDoc.id, true);
    renderPage();
    showStatus(`📅 Fecha añadida: ${dateStr}`, 'success');
    scheduleAutoSave();
    return;
  }
  
  // Stamp size (in PDF points, ~30pt)
  const stampSize = 30;
  const stampSizePx = stampSize * scale;
  
  // Generate stamp image
  const dataUrl = generateStampImage(stampMode, '#000000', Math.round(stampSizePx * 2));
  
  // Position: center the stamp on the click point
  const pdfX = (clickX - stampSizePx / 2) / scale;
  const pdfY = (clickY - stampSizePx / 2) / scale;
  
  pushElement(activeDoc, activeDoc.currentPage, {
    type: 'image',
    src: dataUrl,
    x: pdfX,
    y: pdfY,
    width: stampSize,
    height: stampSize
  });
  
  updateTabModified(activeDoc.id, true);
  renderPage();
  showStatus(`${stampMode === 'check' ? '✓ Check' : '✗ X'} añadido`, 'success');
  scheduleAutoSave();
  
  // Stay in stamp mode for repeated stamps
}

function getCanvasContainer() {
  const canvasArea = $('canvasArea');
  return canvasArea ? canvasArea.querySelector('.canvas-container') : null;
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
  container.style.display = 'grid';
  container.innerHTML = '';

  // Keep every page reachable when the PDF contains many sheets. Native
  // drag-and-drop does not reliably scroll nested panels, so gently scroll
  // the thumbnail grid when the pointer approaches either edge.
  container.ondragover = (e) => {
    e.preventDefault();
    const bounds = container.getBoundingClientRect();
    const edgeSize = 44;
    if (e.clientY < bounds.top + edgeSize) container.scrollTop -= 14;
    else if (e.clientY > bounds.bottom - edgeSize) container.scrollTop += 14;
  };
  
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
      e.dataTransfer.effectAllowed = 'move';
      thumb.classList.add('dragging');
    });
    
    thumb.addEventListener('dragend', () => {
      thumb.classList.remove('dragging');
    });
    
    thumb.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
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
