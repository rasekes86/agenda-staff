(function () {
  const isAndroid = Boolean(window.AndroidBridge);

  if (!window.chrome) window.chrome = {};
  if (!window.chrome.storage) {
    const readAll = () => {
      try { return JSON.parse(localStorage.getItem('agendaStaffStorage') || '{}'); }
      catch (_) { return {}; }
    };
    const writeAll = value => localStorage.setItem('agendaStaffStorage', JSON.stringify(value));
    window.chrome.storage = {
      local: {
        async get(keys) {
          const all = readAll();
          if (keys == null) return all;
          if (typeof keys === 'string') return { [keys]: all[keys] };
          if (Array.isArray(keys)) return Object.fromEntries(keys.map(key => [key, all[key]]));
          return Object.fromEntries(Object.entries(keys).map(([key, fallback]) => [key, all[key] ?? fallback]));
        },
        async set(values) { writeAll({ ...readAll(), ...values }); },
        async remove(keys) {
          const all = readAll();
          for (const key of (Array.isArray(keys) ? keys : [keys])) delete all[key];
          writeAll(all);
        },
        async clear() { localStorage.removeItem('agendaStaffStorage'); }
      }
    };
  }

  if (!isAndroid) return;

  // The shared editor also runs as a Chrome extension. Provide the small
  // runtime surface it expects so Android never aborts during startup.
  if (!window.chrome.runtime) {
    window.chrome.runtime = {
      onMessage: { addListener() {} },
      async sendMessage() {
        return { success: false, error: 'Esta acción solo está disponible en la extensión de Chrome' };
      }
    };
  }

  let sessionRefreshPromise = null;
  window.ensureAndroidSession = async function ensureAndroidSession(force = false) {
    if (sessionRefreshPromise) return sessionRefreshPromise;
    sessionRefreshPromise = (async () => {
      const stored = await chrome.storage.local.get(['session', 'user']);
      const savedSession = stored.session || null;
      if (!savedSession?.refresh_token) return savedSession;
      const expiresAt = Number(savedSession.expires_at || 0);
      const stillValid = savedSession.access_token && expiresAt > (Date.now() / 1000) + 300;
      if (!force && stillValid) return savedSession;

      try {
        const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
          method: 'POST',
          headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: savedSession.refresh_token })
        });
        const refreshed = await response.json();
        if (!response.ok) throw new Error(refreshed.error_description || refreshed.msg || 'No se pudo renovar la sesión');
        const meta = refreshed.user?.user_metadata || {};
        const user = refreshed.user ? {
          id: refreshed.user.id,
          email: refreshed.user.email,
          name: meta.name || meta.full_name || refreshed.user.email
        } : stored.user;
        await chrome.storage.local.set({ session: refreshed, user });
        window.dispatchEvent(new CustomEvent('agenda-android-session', { detail: { session: refreshed, user } }));
        return refreshed;
      } catch (error) {
        console.warn('No se pudo renovar la sesión de Android:', error);
        return savedSession;
      }
    })();
    try { return await sessionRefreshPromise; }
    finally { sessionRefreshPromise = null; }
  };

  document.documentElement.classList.add('android-app');
  document.addEventListener('DOMContentLoaded', () => {
    document.body.classList.add('android-app');
    const sidebar = document.getElementById('editorSidebar');
    if (sidebar) {
      const sheetHeader = document.createElement('div');
      sheetHeader.className = 'mobile-sheet-header';
      sheetHeader.innerHTML = '<div><strong>¿Qué quieres hacer?</strong><small>Editor PDF</small></div><button type="button" aria-label="Cerrar herramientas">×</button>';

      const actionsHost = document.createElement('div');
      actionsHost.className = 'mobile-actions-host';

      const templateActions = document.createElement('div');
      templateActions.className = 'mobile-template-actions';
      const templateItems = [
        ['📐', 'Plantillas', 'Crear, usar o editar', 'btnOpenTemplates'],
        ['📋', 'Rellenar plantilla', 'Completar documento', 'btnFillTemplate']
      ];
      templateItems.forEach(([icon, label, hint, targetId]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.mobileTarget = targetId;
        button.innerHTML = `<span>${icon}</span><span><b>${label}</b><small>${hint}</small></span>`;
        templateActions.appendChild(button);
      });

      const quickActions = document.createElement('div');
      quickActions.className = 'mobile-action-grid mobile-editor-actions';
      const editorActions = [
        ['📂', 'Abrir PDF', 'btnUpload'],
        ['📝', 'Texto', 'btnAddText'],
        ['🖼️', 'Imagen', 'btnAddImage'],
        ['✍️', 'Firma', 'btnAddSignature'],
        ['📅', 'Fecha completa', 'btnAddDate'],
        ['🗓️', 'Fecha separada', 'btnAddDateParts'],
        ['W', 'Workout Events', 'btnAddWorkout'],
        ['🏢', 'CIF empresa', 'btnAddCompanyCif'],
        ['📍', 'Ciudad', 'btnAddCity'],
        ['🏷️', 'Categoría', 'btnAddCategory'],
        ['✏️', 'Dibujar', 'btnDraw'],
        ['✅', 'Check', 'btnStampCheck'],
        ['❌', 'X', 'btnStampX']
      ];
      editorActions.forEach(([icon, label, targetId]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.mobileTarget = targetId;
        button.innerHTML = `<span>${icon}</span><b>${label}</b>`;
        quickActions.appendChild(button);
      });

      const utilities = document.createElement('details');
      utilities.className = 'mobile-utilities';
      utilities.innerHTML = '<summary>⚙️ Más utilidades <small>Convertir, unir y ordenar</small></summary>';
      const utilityGrid = document.createElement('div');
      utilityGrid.className = 'mobile-action-grid';
      const utilityActions = [
        ['🖼️', 'Imágenes → PDF', 'tool:imgToPdf'],
        ['W', 'Word → PDF', 'tool:wordToPdf'],
        ['🔗', 'Juntar PDFs', 'tool:merge'],
        ['✂️', 'Separar PDF', 'tool:split'],
        ['🔢', 'Ordenar páginas', 'tool:pages'],
        ['⬜', 'Fondo blanco', 'tool:whiteBackground']
      ];
      utilityActions.forEach(([icon, label, targetId]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.mobileTarget = targetId;
        button.innerHTML = `<span>${icon}</span><b>${label}</b>`;
        utilityGrid.appendChild(button);
      });
      utilities.appendChild(utilityGrid);

      const saveButton = document.createElement('button');
      saveButton.type = 'button';
      saveButton.className = 'mobile-save-action';
      saveButton.dataset.mobileTarget = 'btnSave';
      saveButton.innerHTML = '<span>💾</span><b>Guardar PDF</b>';
      actionsHost.append(templateActions, quickActions, utilities, saveButton);

      sidebar.prepend(actionsHost);
      sidebar.prepend(sheetHeader);

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'mobile-tools-toggle';
      toggle.textContent = '✏️ Herramientas';
      toggle.setAttribute('aria-label', 'Abrir herramientas de edición');
      const backdrop = document.createElement('div');
      backdrop.className = 'mobile-sidebar-backdrop';
      document.body.append(backdrop, toggle);
      const setOpen = open => {
        sidebar.classList.toggle('mobile-open', open);
        backdrop.classList.toggle('show', open);
        toggle.style.display = open ? 'none' : '';
      };
      const openTools = event => {
        event.preventDefault();
        event.stopPropagation();
        setOpen(true);
      };
      toggle.addEventListener('touchstart', openTools, { passive: false });
      toggle.addEventListener('pointerdown', openTools);
      toggle.addEventListener('click', openTools);
      backdrop.addEventListener('click', () => setOpen(false));
      sheetHeader.querySelector('button').addEventListener('click', () => setOpen(false));
      actionsHost.addEventListener('click', event => {
        const action = event.target.closest('[data-mobile-target]');
        if (!action) return;
        const actionTarget = action.dataset.mobileTarget;
        const target = actionTarget.startsWith('tool:')
          ? document.querySelector(`.tool-tab[data-tool="${actionTarget.slice(5)}"]`)
          : document.getElementById(actionTarget);
        if (target && !target.disabled) target.click();
        setOpen(false);
      });
      sidebar.addEventListener('click', event => {
        if (event.target.closest('.sidebar-btn')) setTimeout(() => setOpen(false), 80);
      });
    }
    document.getElementById('btnMobileLogout')?.addEventListener('click', async () => {
      if (!confirm('¿Cerrar la sesión del editor?')) return;
      await chrome.storage.local.remove(['session', 'user']);
      location.href = 'mobile-index.html';
    });

    window.ensureAndroidSession();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) window.ensureAndroidSession();
    });
    setInterval(() => window.ensureAndroidSession(), 5 * 60 * 1000);

    let touchDragTarget = null;
    const forwardTouch = (type, touch, target) => target.dispatchEvent(new MouseEvent(type, {
      bubbles: true, cancelable: true, clientX: touch.clientX, clientY: touch.clientY, button: 0
    }));
    document.addEventListener('touchstart', event => {
      const target = event.target.closest('.pdf-element, .resize-handle');
      if (!target || event.touches.length !== 1) return;
      touchDragTarget = target;
      forwardTouch('mousedown', event.touches[0], target);
      event.preventDefault();
    }, { passive: false });
    document.addEventListener('touchmove', event => {
      if (!touchDragTarget || event.touches.length !== 1) return;
      forwardTouch('mousemove', event.touches[0], document);
      event.preventDefault();
    }, { passive: false });
    document.addEventListener('touchend', event => {
      if (!touchDragTarget) return;
      const touch = event.changedTouches[0];
      forwardTouch('mouseup', touch, document);
      touchDragTarget = null;
      event.preventDefault();
    }, { passive: false });
  });

  const originalClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (!this.download || !(this.href.startsWith('blob:') || this.href.startsWith('data:'))) {
      return originalClick.call(this);
    }
    const filename = this.download || 'documento.pdf';
    fetch(this.href).then(response => response.blob()).then(blob => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = String(reader.result).split(',')[1] || '';
        window.AndroidBridge.saveBase64File(filename, blob.type || 'application/octet-stream', base64);
      };
      reader.readAsDataURL(blob);
    }).catch(error => alert(`No se pudo guardar el archivo: ${error.message}`));
  };
})();
