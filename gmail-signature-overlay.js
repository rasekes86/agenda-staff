(() => {
  if (window.__agendaGmailSignatureOverlayLoaded) return;
  window.__agendaGmailSignatureOverlayLoaded = true;

  let savedNames = new Set();
  let savedNameTokens = new Set();
  let observer = null;
  let scanTimer = null;
  let signatureDataLoaded = false;
  const observerConfig = { childList: true, subtree: true };

  const normalize = value => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9, ]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ',')
    .trim();

  const nameKey = value => normalize(value);
  const nameTokenKey = value => normalize(value).replace(/,/g, ' ').split(' ').filter(Boolean).sort().join('|');
  const hasSavedSignature = value => savedNames.has(nameKey(value)) || savedNameTokens.has(nameTokenKey(value));

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

    const addPerson = (name, dni, body, options = {}) => {
      const cleanName = String(name || '').replace(/\s+/g, ' ').trim();
      const cleanDni = normalize(dni).replace(/ /g, '');
      if (!cleanName || !dniPattern.test(cleanDni)) return;
      const key = `${nameKey(cleanName)}|${cleanDni}`;
      if (seen.has(key)) return;
      seen.add(key);
      people.push({
        name: cleanName,
        dni: cleanDni,
        saved: hasSavedSignature(cleanName),
        body,
        anchorText: options.anchorText || cleanName,
        anchorElement: options.anchorElement || null
      });
    };

    for (const body of bodies) {
      body.querySelectorAll('table').forEach(table => {
        const rows = [...table.querySelectorAll('tr')];
        if (rows.length < 2) return;
        const headerRowIndex = rows.findIndex(row => {
          const text = normalize(row.innerText);
          return text.includes('NOMBRE') && text.includes('APELLIDO 1') && text.includes('DNI');
        });
        if (headerRowIndex < 0) return;
        const headerCells = [...rows[headerRowIndex].querySelectorAll('th, td')];
        const headers = headerCells.map(cell => normalize(cell.innerText));
        const nameIndex = headers.findIndex(header => header === 'NOMBRE');
        const surname1Index = headers.findIndex(header => header === 'APELLIDO 1' || header === 'PRIMER APELLIDO');
        const surname2Index = headers.findIndex(header => header === 'APELLIDO 2' || header === 'SEGUNDO APELLIDO');
        const dniIndex = headers.findIndex(header => header === 'DNI' || header.includes('DNI NIE'));
        if (nameIndex < 0 || surname1Index < 0 || dniIndex < 0) return;
        rows.slice(headerRowIndex + 1).forEach(row => {
          const cells = [...row.querySelectorAll('th, td')];
          const firstName = cells[nameIndex]?.innerText.trim() || '';
          const surname1 = cells[surname1Index]?.innerText.trim() || '';
          const surname2 = surname2Index >= 0 ? cells[surname2Index]?.innerText.trim() || '' : '';
          const dni = cells[dniIndex]?.innerText.trim() || '';
          const surnames = [surname1, surname2].filter(Boolean).join(' ');
          if (firstName && surnames) addPerson(`${surnames}, ${firstName}`, dni, body, { anchorText: firstName, anchorElement: cells[nameIndex] });
        });
      });

      const rawLines = body.innerText.split(/\r?\n/);
      const tableHeaderIndex = rawLines.findIndex(line => {
        const value = normalize(line);
        return value.includes('NOMBRE') && value.includes('APELLIDO 1') && value.includes('DNI');
      });
      if (tableHeaderIndex >= 0) {
        for (const rawLine of rawLines.slice(tableHeaderIndex + 1)) {
          if (!rawLine.trim()) continue;
          const columns = rawLine.trim().split(/\t+|\s{2,}/).map(value => value.trim()).filter(Boolean);
          const dni = columns.at(-1) || '';
          if (!dniPattern.test(dni) || columns.length < 3) continue;
          const firstName = columns[0];
          const surname1 = columns[1];
          const surname2 = columns.length >= 4 ? columns.slice(2, -1).join(' ') : '';
          const surnames = [surname1, surname2].filter(Boolean).join(' ');
          addPerson(`${surnames}, ${firstName}`, dni, body, { anchorText: firstName });
        }
      }

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
        addPerson(name, dniMatch[0], body);
      }
    }
    return people;
  }

  function clearInlineIndicators() {
    document.querySelectorAll('.agenda-signature-inline').forEach(wrapper => {
      const originalName = wrapper.dataset.agendaOriginalName || wrapper.querySelector('.agenda-signature-inline-name')?.textContent || '';
      const text = document.createTextNode(originalName);
      const parent = wrapper.parentNode;
      wrapper.replaceWith(text);
      parent?.normalize();
    });
    document.querySelectorAll('.agenda-signature-inline-fallback').forEach(badge => badge.remove());
  }

  function createBadge(saved, fallback = false) {
    const badge = document.createElement('span');
    badge.className = `${fallback ? 'agenda-signature-inline-fallback ' : ''}agenda-signature-badge ${saved ? 'saved' : 'missing'}`;
    badge.textContent = saved ? '✓ Firma' : '✕ Sin firma';
    badge.title = saved ? 'Firma guardada en Agenda Staff' : 'Firma no disponible en Agenda Staff';
    badge.setAttribute('aria-label', badge.title);
    return badge;
  }

  function findExactNameTextNode(body, name) {
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue?.trim() || node.parentElement?.closest('.agenda-signature-inline')) return NodeFilter.FILTER_REJECT;
        return node.nodeValue.toLocaleUpperCase().includes(name.toLocaleUpperCase()) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    return walker.nextNode();
  }

  function injectIndicator(person) {
    if (person.anchorElement?.isConnected) {
      person.anchorElement.append(createBadge(person.saved, true));
      return;
    }

    const markerText = person.anchorText || person.name;
    const textNode = findExactNameTextNode(person.body, markerText);
    if (textNode) {
      const rawText = textNode.nodeValue;
      const start = rawText.toLocaleUpperCase().indexOf(markerText.toLocaleUpperCase());
      if (start >= 0) {
        const before = rawText.slice(0, start);
        const originalName = rawText.slice(start, start + markerText.length);
        const after = rawText.slice(start + markerText.length);
        const wrapper = document.createElement('span');
        wrapper.className = 'agenda-signature-inline';
        wrapper.dataset.agendaOriginalName = originalName;
        const nameSpan = document.createElement('span');
        nameSpan.className = 'agenda-signature-inline-name';
        nameSpan.textContent = originalName;
        wrapper.append(nameSpan, createBadge(person.saved));
        textNode.replaceWith(document.createTextNode(before), wrapper, document.createTextNode(after));
        return;
      }
    }

    const name = nameKey(markerText);
    const candidates = [...person.body.querySelectorAll('span, div, td')]
      .filter(element => !element.closest('.agenda-signature-inline') && nameKey(element.textContent).includes(name))
      .sort((a, b) => a.textContent.length - b.textContent.length);
    if (candidates[0]) candidates[0].append(createBadge(person.saved, true));
  }

  function scanAndRender() {
    observer?.disconnect();
    document.getElementById('agenda-signature-overlay')?.remove();
    clearInlineIndicators();
    extractPersonnel().forEach(injectIndicator);
    if (observer) observer.observe(document.body, observerConfig);
  }

  function observeGmail() {
    if (observer) return;
    observer = new MutationObserver(() => {
      clearTimeout(scanTimer);
      scanTimer = setTimeout(() => {
        if (signatureDataLoaded) scanAndRender();
      }, 700);
    });
    observer.observe(document.body, observerConfig);
  }

  chrome.runtime.onMessage.addListener(message => {
    if (message.type === 'AGENDA_SCAN_GMAIL_SIGNATURES') {
      savedNames = new Set((message.signatureNames || []).map(nameKey));
      savedNameTokens = new Set((message.signatureNames || []).map(nameTokenKey));
      signatureDataLoaded = true;
      scanAndRender();
      observeGmail();
    }
    if (message.type === 'AGENDA_GMAIL_SCAN_ERROR') console.warn(message.error || 'No se ha podido analizar el correo');
  });

  document.getElementById('agenda-signature-overlay')?.remove();
  chrome.runtime.sendMessage({ type: 'AGENDA_REQUEST_GMAIL_SCAN' }).catch(() => {});
})();
