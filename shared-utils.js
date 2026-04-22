// ============================================
// SHARED UTILITIES - AGENDA STAFF
// Common functions used across multiple scripts
// ============================================

// --- Color utilities ---
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 0, g: 0, b: 0 };
}

// --- HTML utilities ---
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// --- DNI / NIE utilities ---

// Regex patterns for Spanish ID documents
const DNI_PATTERNS = [
  /\b\d{8}[A-Za-z]\b/g,           // DNI: 12345678A
  /\b[XYZ]\d{7}[A-Za-z]\b/g,      // NIE: X1234567A
  /\b\d{8}-[A-Za-z]\b/g,          // DNI con guion: 12345678-A
  /\b[XYZ]\d{7}-[A-Za-z]\b/g      // NIE con guion: X1234567-A
];

/**
 * Remove DNI/NIE numbers from a text string.
 * @param {string} text - Input text that may contain DNI/NIE numbers
 * @returns {string} Text with DNI/NIE removed and spaces normalized
 */
function removeDniNie(text) {
  return text
    .replace(/\s*\d{8}[A-Za-z]\s*/gi, ' ')   // DNI: 8 digits + letter
    .replace(/\s*[XYZ]\d{7}[A-Za-z]\s*/gi, ' ')  // NIE: X/Y/Z + 7 digits + letter
    .replace(/\s+/g, ' ')   // Normalize multiple spaces to single space
    .trim();
}

/**
 * Remove accents and normalize text for comparison (e.g. Garcia = García)
 * @param {string} text
 * @returns {string}
 */
function normalizeText(text) {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Extract DNI/NIE from a line of text.
 * @param {string} line - A single line of text
 * @returns {{ foundDni: string|null, textWithoutDni: string }}
 */
function extractDniFromLine(line) {
  for (const pattern of DNI_PATTERNS) {
    const match = line.match(pattern);
    if (match) {
      const foundDni = match[0];
      const textWithoutDni = line.replace(pattern, '').replace(/\s+/g, ' ').trim();
      return { foundDni, textWithoutDni };
    }
  }
  return { foundDni: null, textWithoutDni: line };
}

/**
 * Process text (potentially multi-line) that may contain DNI/NIE numbers.
 * Splits name from DNI when found and creates element data objects.
 * @param {string} text - Raw text (may contain newlines)
 * @param {number} startX - X position for first element
 * @param {number} startY - Y position for first element
 * @param {number} size - Font size
 * @param {string} color - Text color
 * @returns {{ elements: Array, totalCreated: number }} Array of element objects ready to push
 */
function processTextWithDni(text, startX, startY, size, color) {
  const lines = text.split(/\n|\r\n|\r/).map(l => l.trim()).filter(l => l);
  const elements = [];
  let currentY = startY;

  if (lines.length > 1) {
    // Multi-line mode
    lines.forEach(line => {
      const { foundDni, textWithoutDni } = extractDniFromLine(line);

      if (foundDni && textWithoutDni) {
        elements.push({ type: 'text', text: textWithoutDni, x: startX, y: currentY, size, color });
        elements.push({ type: 'text', text: foundDni, x: startX, y: currentY + size + 3, size, color, name: textWithoutDni });
        currentY += (size * 2) + 15;
      } else if (line) {
        elements.push({ type: 'text', text: line, x: startX, y: currentY, size, color });
        currentY += size + 10;
      }
    });
  } else {
    // Single line mode
    const { foundDni, textWithoutDni } = extractDniFromLine(text);

    if (foundDni && textWithoutDni) {
      elements.push({ type: 'text', text: textWithoutDni, x: startX, y: startY, size, color });
      elements.push({ type: 'text', text: foundDni, x: startX, y: startY + size + 3, size, color, name: textWithoutDni });
    } else {
      elements.push({ type: 'text', text: text, x: startX, y: startY, size, color });
    }
  }

  return { elements, totalCreated: elements.length };
}
