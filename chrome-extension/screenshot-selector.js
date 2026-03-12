// ============================================
// SCREENSHOT SELECTOR - Content Script
// Permite seleccionar un área de la pantalla con el ratón
// ============================================

(function() {
  'use strict';
  
  // Evitar múltiples inyecciones
  if (window.__screenshotSelectorActive) {
    return;
  }
  window.__screenshotSelectorActive = true;
  
  let overlay = null;
  let selection = null;
  let startX = 0;
  let startY = 0;
  let isSelecting = false;
  
  // Crear overlay
  function createOverlay() {
    // Overlay principal
    overlay = document.createElement('div');
    overlay.id = '__screenshot_overlay__';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.3);
      cursor: crosshair;
      z-index: 2147483647;
    `;
    
    // Selección
    selection = document.createElement('div');
    selection.id = '__screenshot_selection__';
    selection.style.cssText = `
      position: absolute;
      border: 2px dashed #fff;
      background: rgba(59, 130, 246, 0.2);
      display: none;
      pointer-events: none;
    `;
    
    // Instrucciones
    const instructions = document.createElement('div');
    instructions.id = '__screenshot_instructions__';
    instructions.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      z-index: 2147483647;
      pointer-events: none;
    `;
    instructions.textContent = 'Arrastra para seleccionar el área · ESC para cancelar';
    
    overlay.appendChild(selection);
    overlay.appendChild(instructions);
    document.body.appendChild(overlay);
    
    // Eventos
    overlay.addEventListener('mousedown', handleMouseDown);
    overlay.addEventListener('mousemove', handleMouseMove);
    overlay.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('keydown', handleKeyDown);
  }
  
  function handleMouseDown(e) {
    if (e.button !== 0) return; // Solo click izquierdo
    
    isSelecting = true;
    startX = e.clientX;
    startY = e.clientY;
    
    selection.style.display = 'block';
    selection.style.left = startX + 'px';
    selection.style.top = startY + 'px';
    selection.style.width = '0';
    selection.style.height = '0';
  }
  
  function handleMouseMove(e) {
    if (!isSelecting) return;
    
    const currentX = e.clientX;
    const currentY = e.clientY;
    
    const left = Math.min(startX, currentX);
    const top = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);
    
    selection.style.left = left + 'px';
    selection.style.top = top + 'px';
    selection.style.width = width + 'px';
    selection.style.height = height + 'px';
  }
  
  function handleMouseUp(e) {
    if (!isSelecting) return;
    isSelecting = false;
    
    const rect = selection.getBoundingClientRect();
    
    // Área mínima
    if (rect.width < 10 || rect.height < 10) {
      cancelSelection();
      return;
    }
    
    // Capturar la selección
    captureSelection(rect);
  }
  
  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      cancelSelection();
    }
  }
  
  function cancelSelection() {
    cleanup();
    // Notificar cancelación
    chrome.runtime.sendMessage({ type: 'SCREENSHOT_CANCELLED' });
  }
  
  async function captureSelection(rect) {
    // Mostrar mensaje de procesamiento
    const instructions = document.getElementById('__screenshot_instructions__');
    if (instructions) {
      instructions.textContent = 'Procesando captura...';
    }
    
    // Ocultar overlay temporalmente para capturar
    overlay.style.display = 'none';
    
    // Calcular ratio de dispositivo (para pantallas HiDPI)
    const dpr = window.devicePixelRatio || 1;
    
    // Enviar mensaje al background para capturar
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CAPTURE_AREA',
        rect: {
          x: Math.round(rect.left * dpr),
          y: Math.round(rect.top * dpr),
          width: Math.round(rect.width * dpr),
          height: Math.round(rect.height * dpr),
          dpr: dpr
        }
      });
      
      if (response && response.success) {
        // Éxito - el background ya procesó la imagen
        cleanup();
      } else {
        throw new Error(response?.error || 'Error desconocido');
      }
    } catch (err) {
      console.error('Error capturando:', err);
      cleanup();
      chrome.runtime.sendMessage({ type: 'SCREENSHOT_ERROR', error: err.message });
    }
  }
  
  function cleanup() {
    if (overlay) {
      overlay.remove();
    }
    window.__screenshotSelectorActive = false;
    document.removeEventListener('keydown', handleKeyDown);
  }
  
  // Iniciar
  createOverlay();
})();
