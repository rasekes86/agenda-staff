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
  document.documentElement.classList.add('android-app');
  document.addEventListener('DOMContentLoaded', () => {
    document.body.classList.add('android-app');
    const sidebar = document.getElementById('editorSidebar');
    if (sidebar) {
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
      toggle.addEventListener('click', () => setOpen(true));
      backdrop.addEventListener('click', () => setOpen(false));
      sidebar.addEventListener('click', event => {
        if (event.target.closest('.sidebar-btn')) setTimeout(() => setOpen(false), 80);
      });
    }
    document.getElementById('btnMobileLogout')?.addEventListener('click', async () => {
      if (!confirm('¿Cerrar la sesión del editor?')) return;
      await chrome.storage.local.remove(['session', 'user']);
      location.href = 'mobile-index.html';
    });

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
