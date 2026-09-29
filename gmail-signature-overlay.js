(() => {
  if (window.__agendaGmailSignatureOverlayLoaded) return;
  window.__agendaGmailSignatureOverlayLoaded = true;

  let savedNames = new Set();
  let observer = null;
  let scanTimer = null;

  const normalize = value => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9, ]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ',')
    .trim();

  const nameKey = value => normalize(value);

  function isVisible(element) {
    if (!element) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  }

  function extractPersonnel() {
    const bodies = [...document.querySelectorAll('.a3s.aiL, [role="main"] .a3s')].filter(isVisible);
    const people = [];
    const seen = new Set();
    const dniPattern = /\b(?:[XYZ]\s?\d{7}\s?[A-Z]|\d{8}\s?[A-Z])\b/i;
    const namePattern = /([A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ'´ -]{1,70},\s*[A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ'´ -]{1,55})/ig;

    for (const body of bodies) {
      const lines = body.innerText.split(/\r?\n/).map(line => line.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
      for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        const dniMatch = line.match(dniPattern);
        if (!dniMatch) continue;
        const prefix = line.slice(0, dniMatch.index).trim();
        const candidates = [prefix, lines[index - 1] || ''];
        let name = '';
        for (const candidate of candidates) {
          const matches = [...candidate.matchAll(namePattern)];
          if (matches.length) {
            name = matches[matches.length - 1][1].replace(/\s+/g, ' ').trim();
            break;
          }
        }
        if (!name) continue;
        const key = `${nameKey(name)}|${normalize(dniMatch[0]).replace(/ /g, '')}`;
        if (seen.has(key)) continue;
        seen.add(key);
        people.push({ name, dni: normalize(dniMatch[0]).replace(/ /g, ''), saved: savedNames.has(nameKey(name)) });
      }
    }
    return people;
  }

  function renderOverlay(people, error = '') {
    let panel = document.getElementById('agenda-signature-overlay');
    if (!panel) {
      panel = document.createElement('section');
      panel.id = 'agenda-signature-overlay';
      document.body.appendChild(panel);
    }
    if (error) {
      panel.innerHTML = `<div class="agenda-signature-header"><strong>Agenda Staff · Firmas</strong><button data-close title="Cerrar">×</button></div><div class="agenda-signature-empty">${escapeHtml(error)}</div>`;
    } else {
      const saved = people.filter(person => person.saved).length;
      const missing = people.length - saved;
      const rows = people.map(person => `<div class="agenda-signature-row ${person.saved ? 'saved' : 'missing'}"><span class="agenda-signature-icon">${person.saved ? '✓' : '×'}</span><span class="agenda-signature-person"><span class="agenda-signature-name">${escapeHtml(person.name)}</span><span class="agenda-signature-state">${person.saved ? 'Firma guardada' : 'Firma no disponible'}</span></span></div>`).join('');
      panel.innerHTML = `<div class="agenda-signature-header"><strong>Agenda Staff · Firmas</strong><button data-close title="Cerrar">×</button></div><div class="agenda-signature-summary"><span class="agenda-signature-count saved">✓ ${saved} guardadas</span><span class="agenda-signature-count missing">× ${missing} pendientes</span></div><div class="agenda-signature-list">${rows || '<div class="agenda-signature-empty">No se ha detectado ningún listado en el correo visible.</div>'}</div><div class="agenda-signature-footer"><button data-refresh>Actualizar</button><button data-hide>Ocultar</button></div>`;
    }
    panel.querySelector('[data-close]')?.addEventListener('click', () => panel.remove());
    panel.querySelector('[data-hide]')?.addEventListener('click', () => panel.remove());
    panel.querySelector('[data-refresh]')?.addEventListener('click', scanAndRender);
  }

  function escapeHtml(value) {
    const element = document.createElement('div');
    element.textContent = value;
    return element.innerHTML;
  }

  function scanAndRender() {
    renderOverlay(extractPersonnel());
  }

  function observeGmail() {
    if (observer) return;
    observer = new MutationObserver(() => {
      clearTimeout(scanTimer);
      scanTimer = setTimeout(() => {
        if (document.getElementById('agenda-signature-overlay')) scanAndRender();
      }, 700);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  chrome.runtime.onMessage.addListener(message => {
    if (message.type === 'AGENDA_SCAN_GMAIL_SIGNATURES') {
      savedNames = new Set((message.signatureNames || []).map(nameKey));
      scanAndRender();
      observeGmail();
    }
    if (message.type === 'AGENDA_GMAIL_SCAN_ERROR') renderOverlay([], message.error || 'No se ha podido analizar el correo');
  });
})();
