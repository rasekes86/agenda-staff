(() => {
  if (window.__agendaGmailSignatureOverlayLoaded) return;
  window.__agendaGmailSignatureOverlayLoaded = true;

  let savedNames = new Set();
  let savedNameTokens = new Set();
  let observer = null;
  let scanTimer = null;
  let signatureDataLoaded = false;
  let lastGmailLocation = location.href;
  let localRefreshInterval = null;
  let remoteRefreshInterval = null;
  const observerConfig = { childList: true, subtree: true };

  function stopAutomaticRefresh() {
    clearTimeout(scanTimer);
    if (localRefreshInterval) clearInterval(localRefreshInterval);
    if (remoteRefreshInterval) clearInterval(remoteRefreshInterval);
    localRefreshInterval = null;
    remoteRefreshInterval = null;
    observer?.disconnect();
  }

  async function sendRuntimeMessage(message) {
    if (!chrome?.runtime?.id) {
      stopAutomaticRefresh();
      throw new Error('La extensión se ha actualizado. Recarga esta pestaña de Gmail.');
    }
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (error) {
      if (!chrome?.runtime?.id || /context invalidated|receiving end does not exist/i.test(error?.message || '')) {
        stopAutomaticRefresh();
      }
      throw error;
    }
  }

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

  function editableElement(value) {
    if (!value) return null;
    return value.nodeType === Node.ELEMENT_NODE ? value : value.parentElement;
  }

  function isEditableContext(value) {
    const element = editableElement(value);
    return Boolean(element?.closest(
      '[contenteditable="true"], [contenteditable="plaintext-only"], [role="textbox"], textarea, input, .Am.Al.editable'
    ));
  }

  function isComposingEmail() {
    return [...document.querySelectorAll(
      '[contenteditable="true"][role="textbox"], [contenteditable="true"].Am, .Am.Al.editable, textarea[aria-label*="Mensaje" i], textarea[aria-label*="Message" i]'
    )].some(isVisible);
  }

  const ignoredMessageSelector = [
    '.gmail_signature',
    '[data-smartmail="gmail_signature"]',
    '.gmail_quote',
    '.gmail_attr',
    'blockquote',
    '[data-agenda-ignore]',
    '.agenda-signature-inline',
    '.agenda-signature-inline-fallback'
  ].join(',');

  function isIgnoredMessageContent(value) {
    return Boolean(editableElement(value)?.closest(ignoredMessageSelector));
  }

  function messageBodyText(body) {
    const cleanBody = body.cloneNode(true);
    cleanBody.querySelectorAll(ignoredMessageSelector).forEach(element => element.remove());
    return cleanBody.innerText || cleanBody.textContent || '';
  }

  function looksLikePersonnelName(value) {
    const name = String(value || '').replace(/\s+/g, ' ').trim();
    const parts = name.split(',');
    if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) return false;
    if (/\d|@|https?:|www\./i.test(name)) return false;
    const leftTokens = parts[0].trim().split(/\s+/).filter(Boolean);
    const rightTokens = parts[1].trim().split(/\s+/).filter(Boolean);
    if (leftTokens.length > 6 || rightTokens.length > 4) return false;
    return !/\b(?:WORKOUT EVENTS?|RECURSOS HUMANOS|RRHH|DEPARTAMENTO|EQUIPO|COORDINACI[ÓO]N|INFORMACI[ÓO]N|ATENTAMENTE|SALUDOS|AVISO|CONFIDENCIAL|EMPRESA|PRODUCCI[ÓO]N|ADMINISTRACI[ÓO]N|S\.?\s*[LA]\.?)\b/i.test(name);
  }

  function looksLikeUnorderedPersonnelName(value) {
    const name = String(value || '').replace(/^[\s•·*-]+/, '').replace(/[(),.;:]+$/g, '').replace(/\s+/g, ' ').trim();
    if (!name || /\d|@|https?:|www\./i.test(name) || name !== name.toLocaleUpperCase('es-ES')) return false;
    const tokens = name.split(' ').filter(Boolean);
    if (tokens.length < 2 || tokens.length > 6 || tokens.some(token => !/^[A-ZÁÉÍÓÚÜÑ'´-]+$/i.test(token))) return false;
    return !/\b(?:MUCHAS?|GRACIAS|SALUDOS?|BUENOS?|D[IÍ]AS|TARDES|ATENTAMENTE|WORKOUT|EVENTS?|PERSONAL|GUARDIA|RESPONSABLE|GESTORA?|DEPARTAMENTO|RRHH|N[ÓO]MINAS?|FIRMA|DNI|NIE|NOMBRE|APELLIDOS?)\b/i.test(name);
  }

  function extractPersonnel() {
    const messageBodies = [...document.querySelectorAll('.a3s.aiL, [role="main"] .a3s, [role="main"] .ii.gt')]
      .filter(body => isVisible(body) && !isEditableContext(body));
    const uniqueBodies = [...new Set(messageBodies)];
    // Gmail frequently returns both the actual .a3s message and a visible
    // parent .ii.gt container. Keep only the innermost body to avoid parsing
    // the same content twice and attaching markers to the wrong copy.
    const bodies = uniqueBodies.filter(candidate => !uniqueBodies.some(other => other !== candidate && candidate.contains(other)));
    const people = [];
    // The same worker may legitimately appear in several messages of a Gmail
    // thread. Deduplicate inside each message, never across the whole thread.
    const seenByBody = new WeakMap();
    const dniPattern = /\b(?:[XYZ]\s?\d{7}\s?[A-Z]|\d{8}\s?[A-Z])\b/i;
    const namePattern = /([A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ'´ -]{1,70},\s*[A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ'´ -]{1,55})/ig;
    const standaloneNamePattern = /^([A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ'´ -]{1,70},\s*[A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ'´ -]{1,55})$/i;

    const addPerson = (name, dni = '', body, options = {}) => {
      const cleanName = String(name || '').replace(/\s+/g, ' ').trim();
      const cleanDni = normalize(dni).replace(/ /g, '');
      const validName = options.allowUnordered ? looksLikeUnorderedPersonnelName(cleanName) : looksLikePersonnelName(cleanName);
      if (!cleanName || !validName || (cleanDni && !dniPattern.test(cleanDni))) return;
      const key = nameKey(cleanName);
      let bodySeen = seenByBody.get(body);
      if (!bodySeen) {
        bodySeen = new Set();
        seenByBody.set(body, bodySeen);
      }
      if (bodySeen.has(key)) return;
      bodySeen.add(key);
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
        if (isIgnoredMessageContent(table)) return;
        const rows = [...table.querySelectorAll('tr')];
        if (!rows.length) return;
        const headerRowIndex = rows.findIndex(row => {
          const text = normalize(row.innerText);
          return text.includes('NOMBRE') && text.includes('APELLIDO 1');
        });
        if (headerRowIndex < 0) {
          // Common headerless formats:
          //   SURNAME SURNAME, FIRST NAME | DNI/NIE | ROLE
          //   DNI/NIE | FIRST NAME | SURNAME SURNAME
          // A valid identity document is mandatory here, which keeps ordinary
          // prose, email signatures and unrelated tables out of this path.
          rows.forEach(row => {
            // Gmail may wrap pasted spreadsheet cells in extra elements. Use
            // leaf cells instead of requiring them to be direct TR children.
            const cells = [...row.querySelectorAll('th, td')]
              .filter(cell => !cell.querySelector('th, td'));
            const dniIndex = cells.findIndex(cell => dniPattern.test(normalize(cell.innerText).replace(/ /g, '')));
            if (dniIndex < 0) return;
            const nameCell = cells.slice(0, dniIndex).find(cell => looksLikePersonnelName(cell.innerText.trim()));
            if (nameCell) {
              addPerson(nameCell.innerText.trim(), cells[dniIndex].innerText.trim(), body, {
                anchorText: nameCell.innerText.trim(),
                anchorElement: nameCell
              });
              return;
            }
            const identityCells = cells
              .map((cell, index) => ({ cell, index, text: cell.innerText.replace(/\s+/g, ' ').trim() }))
              .filter(item => item.index !== dniIndex && item.text);
            if (dniIndex === 0 && identityCells.length >= 2) {
              const firstName = identityCells[0].text;
              const surnames = identityCells.slice(1).map(item => item.text).join(' ');
              if (/\d|@|https?:|www\./i.test(`${firstName} ${surnames}`)) return;
              addPerson(`${surnames}, ${firstName}`, cells[dniIndex].innerText.trim(), body, {
                anchorText: firstName,
                anchorElement: identityCells[0].cell
              });
              return;
            }
            // Some pasted sheets place the identity document last while the
            // name and surnames remain in independent cells.
            if (dniIndex === cells.length - 1 && identityCells.length >= 2) {
              const firstName = identityCells[0].text;
              const surnames = identityCells.slice(1).map(item => item.text).join(' ');
              if (/\d|@|https?:|www\./i.test(`${firstName} ${surnames}`)) return;
              addPerson(`${surnames}, ${firstName}`, cells[dniIndex].innerText.trim(), body, {
                anchorText: firstName,
                anchorElement: identityCells[0].cell
              });
            }
          });
          // Gmail can flatten rows from pasted spreadsheets. Read consecutive
          // leaf cells too, so DNI | name | surnames remains detectable even
          // when the visual row has no usable TR structure.
          const leafCells = [...table.querySelectorAll('th, td')]
            .filter(cell => !cell.querySelector('th, td'));
          leafCells.forEach((cell, index) => {
            const dni = normalize(cell.innerText).replace(/ /g, '');
            if (!dniPattern.test(dni)) return;
            const firstNameCell = leafCells[index + 1];
            const surnamesCell = leafCells[index + 2];
            if (!firstNameCell || !surnamesCell) return;
            const firstName = firstNameCell.innerText.replace(/\s+/g, ' ').trim();
            const surnames = surnamesCell.innerText.replace(/\s+/g, ' ').trim();
            if (!firstName || !surnames || /\d|@|https?:|www\./i.test(`${firstName} ${surnames}`)) return;
            addPerson(`${surnames}, ${firstName}`, cell.innerText.trim(), body, {
              anchorText: firstName,
              anchorElement: firstNameCell
            });
          });
          return;
        }
        const headerCells = [...rows[headerRowIndex].querySelectorAll('th, td')];
        const headers = headerCells.map(cell => normalize(cell.innerText));
        const nameIndex = headers.findIndex(header => header === 'NOMBRE');
        const surname1Index = headers.findIndex(header => header === 'APELLIDO 1' || header === 'PRIMER APELLIDO');
        const surname2Index = headers.findIndex(header => header === 'APELLIDO 2' || header === 'SEGUNDO APELLIDO');
        const dniIndex = headers.findIndex(header => header === 'DNI' || header.includes('DNI NIE'));
        if (nameIndex < 0 || surname1Index < 0) return;
        rows.slice(headerRowIndex + 1).forEach(row => {
          const cells = [...row.querySelectorAll('th, td')];
          const firstName = cells[nameIndex]?.innerText.trim() || '';
          const surname1 = cells[surname1Index]?.innerText.trim() || '';
          const surname2 = surname2Index >= 0 ? cells[surname2Index]?.innerText.trim() || '' : '';
          const dni = dniIndex >= 0 ? cells[dniIndex]?.innerText.trim() || '' : '';
          const surnames = [surname1, surname2].filter(Boolean).join(' ');
          if (firstName && surnames) addPerson(`${surnames}, ${firstName}`, dni, body, { anchorText: firstName, anchorElement: cells[nameIndex] });
        });
      });

      const usefulBodyText = messageBodyText(body);
      // Gmail sometimes exposes visual line breaks as spaces. Scan the whole
      // message for SURNAME(S), FIRST NAME followed by a DNI/NIE as well.
      const inlinePersonnelPattern = /([A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ'´ -]{1,70},\s*[A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ'´ -]{1,55}?)\s+((?:[XYZ]\s?\d{7}\s?[A-Z]|\d{8}\s?[A-Z]))(?=\s|$)/gi;
      let inlinePersonnelCount = 0;
      for (const match of usefulBodyText.matchAll(inlinePersonnelPattern)) {
        addPerson(match[1], match[2], body, { anchorText: match[1] });
        inlinePersonnelCount++;
      }
      const rawLines = usefulBodyText.split(/\r?\n/);
      const tableHeaderIndex = rawLines.findIndex(line => {
        const value = normalize(line);
        return value.includes('NOMBRE') && value.includes('APELLIDO 1');
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

      const lines = usefulBodyText.split(/\r?\n/).map(line => line.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
      let unorderedPersonnelCount = 0;
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
        if (name) {
          addPerson(name, dniMatch[0], body);
          continue;
        }
        const unorderedName = prefix.replace(/^[\s•·*-]+/, '').replace(/[(),.;:]+$/g, '').trim();
        if (looksLikeUnorderedPersonnelName(unorderedName)) {
          addPerson(unorderedName, dniMatch[0], body, { anchorText: unorderedName, allowUnordered: true });
          unorderedPersonnelCount++;
        }
      }

      // Fallback for lists pasted from Excel/Sheets as plain tabulated text:
      // DNI | FIRST NAME | SURNAME(S), without a heading row.
      for (const rawLine of usefulBodyText.split(/\r?\n/)) {
        const columns = rawLine.replace(/\u00a0/g, ' ').trim().split(/\t+|\s{2,}/).map(value => value.trim()).filter(Boolean);
        if (columns.length < 3) continue;
        const dniIndex = columns.findIndex(column => dniPattern.test(normalize(column).replace(/ /g, '')));
        if (dniIndex < 0) continue;
        const identityColumns = columns.filter((_, index) => index !== dniIndex);
        if (identityColumns.length < 2) continue;
        const firstName = identityColumns[0];
        const surnames = identityColumns.slice(1).join(' ');
        if (/\d|@|https?:|www\./i.test(`${firstName} ${surnames}`)) continue;
        addPerson(`${surnames}, ${firstName}`, columns[dniIndex], body, { anchorText: firstName });
      }

      const standaloneCandidates = [];
      const unorderedStandaloneCandidates = [];
      const standaloneLines = usefulBodyText.split(/\r?\n/);
      const hasNamesHeading = standaloneLines.some(line => /\b(NOMBRES?|PERSONAL|LISTADO)\b/i.test(line));
      for (const rawLine of standaloneLines) {
        const line = rawLine.replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
        const match = line.match(standaloneNamePattern);
        if (match && (hasNamesHeading || line === line.toLocaleUpperCase())) standaloneCandidates.push(match[1]);
        if (!match && looksLikeUnorderedPersonnelName(line)) unorderedStandaloneCandidates.push(line.replace(/^[\s•·*-]+/, '').trim());
      }
      if (hasNamesHeading || standaloneCandidates.length >= 2 || inlinePersonnelCount >= 2) {
        standaloneCandidates.forEach(name => addPerson(name, '', body));
      }
      if (unorderedPersonnelCount >= 2) {
        unorderedStandaloneCandidates.forEach(name => addPerson(name, '', body, { anchorText: name, allowUnordered: true }));
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
    document.querySelectorAll('.agenda-signature-name-state').forEach(element => element.classList.remove('agenda-signature-name-state', 'saved', 'missing'));
  }

  function createBadge(person, fallback = false) {
    const badge = document.createElement('span');
    badge.className = `${fallback ? 'agenda-signature-inline-fallback ' : ''}agenda-signature-badge ${person.saved ? 'saved' : 'missing'}`;
    badge.textContent = person.saved ? '✓ Firma' : '✕ Sin firma · Añadir';
    badge.title = person.saved ? 'Firma guardada en Agenda Staff' : 'Pulsa para subir o recortar esta firma';
    badge.setAttribute('aria-label', badge.title);
    if (!person.saved) {
      badge.classList.add('uploadable');
      badge.setAttribute('role', 'button');
      badge.tabIndex = 0;
      const activate = event => {
        if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        openMissingSignatureActions(person);
      };
      badge.addEventListener('click', activate);
      badge.addEventListener('keydown', activate);
    }
    return badge;
  }

  function closeSignatureDialog() {
    document.querySelector('.agenda-signature-dialog-backdrop')?.remove();
  }

  function createDialog(title, description = '') {
    closeSignatureDialog();
    const backdrop = document.createElement('div');
    backdrop.className = 'agenda-signature-dialog-backdrop';
    const dialog = document.createElement('div');
    dialog.className = 'agenda-signature-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    const heading = document.createElement('h3');
    heading.textContent = title;
    dialog.appendChild(heading);
    if (description) {
      const paragraph = document.createElement('p');
      paragraph.textContent = description;
      dialog.appendChild(paragraph);
    }
    backdrop.addEventListener('mousedown', event => {
      if (event.target === backdrop) closeSignatureDialog();
    });
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    return dialog;
  }

  function createDialogButton(text, className, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = text;
    button.addEventListener('click', onClick);
    return button;
  }

  function openMissingSignatureActions(person) {
    const dialog = createDialog(`Añadir firma de ${person.name}`, 'Elige cómo quieres obtenerla.');
    const actions = document.createElement('div');
    actions.className = 'agenda-signature-dialog-actions vertical';
    actions.append(
      createDialogButton('Subir imagen', 'primary', () => {
        closeSignatureDialog();
        uploadMissingSignature(person);
      }),
      createDialogButton('Recortar desde otra pestaña', 'crop', () => openCropTabChooser(person)),
      createDialogButton('Cancelar', 'secondary', closeSignatureDialog)
    );
    dialog.appendChild(actions);
  }

  async function openCropTabChooser(person) {
    const dialog = createDialog('Selecciona el documento', 'Abre primero el documento y deja visible la zona donde está la firma.');
    const loading = document.createElement('div');
    loading.className = 'agenda-signature-dialog-loading';
    loading.textContent = 'Buscando pestañas abiertas…';
    dialog.appendChild(loading);
    try {
      const result = await sendRuntimeMessage({ type: 'AGENDA_GET_CAPTURE_TABS' });
      if (!result?.success) throw new Error(result?.error || 'No se han podido consultar las pestañas');
      loading.remove();
      if (!result.tabs?.length) {
        const empty = document.createElement('div');
        empty.className = 'agenda-signature-dialog-empty';
        empty.textContent = 'No hay otra pestaña web disponible. Abre el documento en Chrome y vuelve a intentarlo.';
        dialog.appendChild(empty);
      } else {
        const list = document.createElement('div');
        list.className = 'agenda-signature-tab-list';
        result.tabs.forEach(tab => {
          const option = document.createElement('button');
          option.type = 'button';
          option.className = 'agenda-signature-tab-option';
          const title = document.createElement('strong');
          title.textContent = tab.title || 'Pestaña sin título';
          const url = document.createElement('span');
          try { url.textContent = new URL(tab.url).hostname || tab.url; }
          catch (_) { url.textContent = tab.url || ''; }
          option.append(title, url);
          option.addEventListener('click', async () => {
            option.disabled = true;
            option.classList.add('loading');
            const oldTitle = title.textContent;
            title.textContent = 'Abriendo selector…';
            try {
              const start = await sendRuntimeMessage({ type: 'AGENDA_START_SIGNATURE_CROP', name: person.name, tabId: tab.id });
              if (!start?.success) throw new Error(start?.error || 'No se ha podido iniciar el recorte');
              closeSignatureDialog();
            } catch (error) {
              option.disabled = false;
              option.classList.remove('loading');
              title.textContent = oldTitle;
              showInlineNotice(error.message || 'No se ha podido abrir esa pestaña', 'error');
            }
          });
          list.appendChild(option);
        });
        dialog.appendChild(list);
      }
      const footer = document.createElement('div');
      footer.className = 'agenda-signature-dialog-actions';
      footer.appendChild(createDialogButton('Volver', 'secondary', () => openMissingSignatureActions(person)));
      dialog.appendChild(footer);
    } catch (error) {
      closeSignatureDialog();
      showInlineNotice(error.message || 'No se han podido consultar las pestañas', 'error');
    }
  }

  function showInlineNotice(text, type = 'success') {
    document.querySelector('.agenda-signature-notice')?.remove();
    const notice = document.createElement('div');
    notice.className = `agenda-signature-notice ${type}`;
    notice.textContent = text;
    document.body.appendChild(notice);
    setTimeout(() => notice.remove(), 3500);
  }

  async function prepareSignatureImage(file) {
    const source = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = reject;
      element.src = source;
    });
    const maxDimension = 1200;
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    let left = canvas.width, top = canvas.height, right = -1, bottom = -1;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const offset = (y * canvas.width + x) * 4;
        const max = Math.max(data[offset], data[offset + 1], data[offset + 2]);
        const min = Math.min(data[offset], data[offset + 1], data[offset + 2]);
        const brightness = (data[offset] + data[offset + 1] + data[offset + 2]) / 3;
        if (brightness > 248 && max - min < 18) data[offset + 3] = 0;
        else if (brightness > 220 && max - min < 32) data[offset + 3] = Math.round(255 * (248 - brightness) / 28);
        if (data[offset + 3] > 18) {
          left = Math.min(left, x); right = Math.max(right, x);
          top = Math.min(top, y); bottom = Math.max(bottom, y);
        }
      }
    }
    context.putImageData(imageData, 0, 0);
    if (right < left || bottom < top) throw new Error('No se han detectado trazos en la imagen');
    const padding = 8;
    left = Math.max(0, left - padding); top = Math.max(0, top - padding);
    right = Math.min(canvas.width - 1, right + padding); bottom = Math.min(canvas.height - 1, bottom + padding);
    const output = document.createElement('canvas');
    output.width = right - left + 1; output.height = bottom - top + 1;
    output.getContext('2d').drawImage(canvas, left, top, output.width, output.height, 0, 0, output.width, output.height);
    return output.toDataURL('image/png');
  }

  function uploadMissingSignature(person) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      showInlineNotice(`Preparando firma de ${person.name}…`);
      try {
        const imageUrl = await prepareSignatureImage(file);
        const result = await sendRuntimeMessage({ type: 'AGENDA_UPLOAD_GMAIL_SIGNATURE', name: person.name, imageUrl });
        if (!result?.success) throw new Error(result?.error || 'No se ha podido guardar la firma');
        savedNames.add(nameKey(person.name));
        savedNameTokens.add(nameTokenKey(person.name));
        showInlineNotice(`✓ Firma guardada: ${person.name}`);
        scanAndRender();
      } catch (error) {
        showInlineNotice(error.message || 'No se ha podido subir la firma', 'error');
      }
    };
    input.click();
  }

  function findExactNameTextNode(body, name) {
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue?.trim() || node.parentElement?.closest('.agenda-signature-inline') || isEditableContext(node) || isIgnoredMessageContent(node)) return NodeFilter.FILTER_REJECT;
        return node.nodeValue.toLocaleUpperCase().includes(name.toLocaleUpperCase()) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    return walker.nextNode();
  }

  function injectIndicator(person) {
    if (isEditableContext(person.anchorElement) || isEditableContext(person.body)) return;
    if (person.anchorElement?.isConnected) {
      person.anchorElement.classList.add('agenda-signature-name-state', person.saved ? 'saved' : 'missing');
      person.anchorElement.append(createBadge(person, true));
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
        wrapper.className = `agenda-signature-inline ${person.saved ? 'saved' : 'missing'}`;
        wrapper.dataset.agendaOriginalName = originalName;
        const nameSpan = document.createElement('span');
        nameSpan.className = 'agenda-signature-inline-name';
        nameSpan.textContent = originalName;
        wrapper.append(nameSpan, createBadge(person));
        textNode.replaceWith(document.createTextNode(before), wrapper, document.createTextNode(after));
        return;
      }
    }

    const name = nameKey(markerText);
    const candidates = [...person.body.querySelectorAll('span, div, td')]
      .filter(element => !element.closest('.agenda-signature-inline') && !isIgnoredMessageContent(element) && nameKey(element.textContent).includes(name))
      .sort((a, b) => a.textContent.length - b.textContent.length);
    if (candidates[0]) {
      candidates[0].classList.add('agenda-signature-name-state', person.saved ? 'saved' : 'missing');
      candidates[0].append(createBadge(person, true));
    }
  }

  function injectIndicators(people) {
    const pendingByBody = new Map();
    people.forEach(person => {
      if (isEditableContext(person.anchorElement) || isEditableContext(person.body)) return;
      if (person.anchorElement?.isConnected) {
        person.anchorElement.classList.add('agenda-signature-name-state', person.saved ? 'saved' : 'missing');
        person.anchorElement.append(createBadge(person, true));
        return;
      }
      if (!pendingByBody.has(person.body)) pendingByBody.set(person.body, []);
      pendingByBody.get(person.body).push(person);
    });

    pendingByBody.forEach((pending, body) => {
      const remaining = new Set(pending);
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (!node.nodeValue?.trim() || node.parentElement?.closest('.agenda-signature-inline') || isEditableContext(node) || isIgnoredMessageContent(node)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      const textNodes = [];
      while (walker.nextNode()) textNodes.push(walker.currentNode);

      textNodes.forEach(textNode => {
        const rawText = textNode.nodeValue;
        const upperText = rawText.toLocaleUpperCase('es-ES');
        const matches = [];
        remaining.forEach(person => {
          const marker = person.anchorText || person.name;
          const start = upperText.indexOf(marker.toLocaleUpperCase('es-ES'));
          if (start >= 0) matches.push({ start, marker, person });
        });
        matches.sort((a, b) => a.start - b.start || b.marker.length - a.marker.length);
        if (!matches.length) return;
        const fragment = document.createDocumentFragment();
        let cursor = 0;
        matches.forEach(match => {
          if (match.start < cursor) return;
          fragment.append(document.createTextNode(rawText.slice(cursor, match.start)));
          const originalName = rawText.slice(match.start, match.start + match.marker.length);
          const wrapper = document.createElement('span');
          wrapper.className = `agenda-signature-inline ${match.person.saved ? 'saved' : 'missing'}`;
          wrapper.dataset.agendaOriginalName = originalName;
          const nameSpan = document.createElement('span');
          nameSpan.className = 'agenda-signature-inline-name';
          nameSpan.textContent = originalName;
          wrapper.append(nameSpan, createBadge(match.person));
          fragment.append(wrapper);
          cursor = match.start + match.marker.length;
          remaining.delete(match.person);
        });
        fragment.append(document.createTextNode(rawText.slice(cursor)));
        textNode.replaceWith(fragment);
      });

      remaining.forEach(injectIndicator);
    });
  }

  function scanAndRender() {
    observer?.disconnect();
    document.getElementById('agenda-signature-overlay')?.remove();
    clearInlineIndicators();
    // Compose areas are already excluded individually. A minimized draft must
    // not disable analysis of the received message currently being viewed.
    injectIndicators(extractPersonnel());
    if (observer) observer.observe(document.body, observerConfig);
  }

  function observeGmail() {
    if (observer) return;
    observer = new MutationObserver(records => {
      // Keystrokes and Gmail's internal mutations inside a draft must never
      // trigger scanning or DOM rewriting in the compose editor.
      if (records.length && records.every(record => isEditableContext(record.target))) return;
      clearTimeout(scanTimer);
      scanTimer = setTimeout(() => {
        if (signatureDataLoaded) scanAndRender();
      }, 700);
    });
    observer.observe(document.body, observerConfig);
  }

  function requestRemoteRefresh() {
    sendRuntimeMessage({ type: 'AGENDA_REQUEST_GMAIL_SCAN' }).catch(() => {});
  }

  function startAutomaticRefresh() {
    if (!localRefreshInterval) {
      localRefreshInterval = setInterval(() => {
        const locationChanged = location.href !== lastGmailLocation;
        if (locationChanged) lastGmailLocation = location.href;
        if (signatureDataLoaded) scanAndRender();
        if (locationChanged) requestRemoteRefresh();
      }, 2500);
    }
    if (!remoteRefreshInterval) remoteRefreshInterval = setInterval(requestRemoteRefresh, 30000);
  }

  chrome.runtime.onMessage.addListener(message => {
    if (message.type === 'AGENDA_SCAN_GMAIL_SIGNATURES') {
      savedNames = new Set((message.signatureNames || []).map(nameKey));
      savedNameTokens = new Set((message.signatureNames || []).map(nameTokenKey));
      signatureDataLoaded = true;
      scanAndRender();
      observeGmail();
      startAutomaticRefresh();
    }
    if (message.type === 'AGENDA_SIGNATURE_CROP_SAVED') {
      const savedName = message.name || '';
      savedNames.add(nameKey(savedName));
      savedNameTokens.add(nameTokenKey(savedName));
      showInlineNotice(`✓ Firma recortada y guardada: ${savedName}`);
      scanAndRender();
    }
    if (message.type === 'AGENDA_GMAIL_SCAN_ERROR') console.warn(message.error || 'No se ha podido analizar el correo');
  });

  document.getElementById('agenda-signature-overlay')?.remove();
  window.addEventListener('focus', requestRemoteRefresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) requestRemoteRefresh(); });
  requestRemoteRefresh();
})();
