// ============================================
// AGENDA STAFF v5.23.20 - STICKY SIDEBAR
// ============================================

const SUPABASE_URL = 'https://iugutcsukxkxlgpkmzxt.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1Z3V0Y3N1a3hreGxncGttenh0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzc5OTExMjksImV4cCI6MjA1MzU2NzEyOX0.PpolAzqqXNBOhRlUVzplqkKeGQxzfed4gH377CidVJE';

// State
let currentUser = null;
let session = null;
let events = {};
let collapsed = new Set();
let manuallyExpanded = new Set(); // Days manually expanded by user
let expandedEvents = new Set();
let editingId = null;
let dragId = null;
let dragDate = null;
let calDate = new Date();
let viewStartDate = new Date();
const VISIBLE_DAYS = 30;

// Notification settings
let notificationSettings = {
  enabled: true,
  minutesBefore: 5,
  sound: 'bell'
};

// Current reminder banner
let currentReminder = null;

// PDF state
let pdfImages = [];
let pdfOrientation = 'portrait';
let mergePdfs = [];
let splitPdfFile = null;

// Word to PDF state
let wordFile = null;

// PDF Editor state
let editorPdfBytes = null;
let editorPdfDoc = null;
let editorCurrentPage = 1;
let editorTotalPages = 0;
let editorElements = {}; // Elements per page: { pageNum: [elements] }
let editorScale = 1;
let editorCanvas = null;
let selectedElement = null;

// DOM
const $ = id => document.getElementById(id);
const daysList = $('daysList');
const modalOverlay = $('modalOverlay');
const toast = $('toast');

// ============================================
// AUTHENTICATION
// ============================================

async function checkSession() {
  try {
    const stored = await chrome.storage.local.get(['session', 'user']);
    
    if (stored.session && stored.user) {
      const expiresAt = stored.session.expires_at;
      const now = Math.floor(Date.now() / 1000);
      const isExpired = expiresAt && (expiresAt - now < 300);
      
      if (isExpired && stored.session.refresh_token) {
        const refreshed = await refreshSession(stored.session.refresh_token);
        if (refreshed) {
          session = stored.session;
          currentUser = stored.user;
          showMainScreen();
          return;
        } else {
          await clearSession();
          showAuthScreen();
          return;
        }
      }
      
      const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${stored.session.access_token}`
        }
      });
      
      if (res.ok) {
        session = stored.session;
        currentUser = stored.user;
        showMainScreen();
      } else {
        if (stored.session.refresh_token) {
          const refreshed = await refreshSession(stored.session.refresh_token);
          if (refreshed) {
            const newStored = await chrome.storage.local.get(['session', 'user']);
            session = newStored.session;
            currentUser = newStored.user;
            showMainScreen();
            return;
          }
        }
        await clearSession();
        showAuthScreen();
      }
    } else {
      showAuthScreen();
    }
  } catch (err) {
    console.error('Session check error:', err);
    showAuthScreen();
  }
}

async function refreshSession(refreshToken) {
  try {
    console.log('Refreshing session...');
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ refresh_token: refreshToken })
    });
    
    if (!res.ok) {
      console.log('Refresh failed:', res.status);
      return false;
    }
    
    const data = await res.json();
    
    await chrome.storage.local.set({
      session: data,
      user: {
        id: data.user.id,
        email: data.user.email,
        name: data.user.user_metadata?.name || data.user.email.split('@')[0]
      }
    });
    
    console.log('Session refreshed successfully');
    return true;
  } catch (err) {
    console.error('Refresh error:', err);
    return false;
  }
}

async function saveSession(sessionData, userData) {
  await chrome.storage.local.set({
    session: sessionData,
    user: userData
  });
}

async function clearSession() {
  await chrome.storage.local.remove(['session', 'user']);
  session = null;
  currentUser = null;
}

function showAuthScreen() {
  $('authScreen').style.display = 'flex';
  $('mainScreen').style.display = 'none';
}

async function showMainScreen() {
  $('authScreen').style.display = 'none';
  $('mainScreen').style.display = 'flex';
  
  viewStartDate = new Date();
  viewStartDate.setHours(0, 0, 0, 0);
  
  if (currentUser) {
    $('userName').textContent = currentUser.name || 'Usuario';
    $('userEmail').textContent = currentUser.email || '';
    $('userAvatar').textContent = (currentUser.name || currentUser.email || 'U')[0].toUpperCase();
  }
  
  await loadNotificationSettings();
  
  try {
    await chrome.runtime.sendMessage({ type: 'START_NOTIFICATION_CHECK' });
  } catch (err) {
    console.log('Could not start notification check:', err);
  }
  
  loadEvents();
}

async function loadNotificationSettings() {
  try {
    const stored = await chrome.storage.local.get(['notificationSettings']);
    if (stored.notificationSettings) {
      notificationSettings = { ...notificationSettings, ...stored.notificationSettings };
    }
    updateNotificationUI();
  } catch (err) {
    console.error('Error loading notification settings:', err);
  }
}

function updateNotificationUI() {
  const toggle = $('notifToggle');
  const minutesSelect = $('notifMinutes');
  const soundSelect = $('notifSound');
  
  if (toggle) toggle.checked = notificationSettings.enabled;
  if (minutesSelect) minutesSelect.value = notificationSettings.minutesBefore;
  if (soundSelect) soundSelect.value = notificationSettings.sound;
}

async function saveNotificationSettings() {
  notificationSettings = {
    enabled: $('notifToggle').checked,
    minutesBefore: parseInt($('notifMinutes').value),
    sound: $('notifSound').value
  };
  
  await chrome.storage.local.set({ notificationSettings });
  scheduleNotifications();
  showToast('Configuración guardada');
}

// Login
async function handleLogin(e) {
  e.preventDefault();
  
  const email = $('loginEmail').value.trim();
  const password = $('loginPassword').value;
  const errorEl = $('loginError');
  const btn = $('btnLogin');
  
  if (!email || !password) {
    showAuthError(errorEl, 'Completa todos los campos');
    return;
  }
  
  btn.disabled = true;
  btn.querySelector('.btn-text').textContent = 'Entrando...';
  btn.querySelector('.btn-loader').style.display = 'block';
  errorEl.classList.remove('show');
  
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password })
    });
    
    const data = await res.json();
    
    if (!res.ok) {
      throw new Error(data.error_description || data.message || 'Error al iniciar sesión');
    }
    
    session = data;
    currentUser = {
      id: data.user.id,
      email: data.user.email,
      name: data.user.user_metadata?.name || data.user.email.split('@')[0]
    };
    
    await saveSession(session, currentUser);
    showMainScreen();
    
  } catch (err) {
    showAuthError(errorEl, err.message);
  } finally {
    btn.disabled = false;
    btn.querySelector('.btn-text').textContent = 'Entrar';
    btn.querySelector('.btn-loader').style.display = 'none';
  }
}

// Register
async function handleRegister(e) {
  e.preventDefault();
  
  const name = $('registerName').value.trim();
  const email = $('registerEmail').value.trim();
  const password = $('registerPassword').value;
  const errorEl = $('registerError');
  const btn = $('btnRegister');
  
  if (!name || !email || !password) {
    showAuthError(errorEl, 'Completa todos los campos');
    return;
  }
  
  if (password.length < 6) {
    showAuthError(errorEl, 'La contraseña debe tener al menos 6 caracteres');
    return;
  }
  
  btn.disabled = true;
  btn.querySelector('.btn-text').textContent = 'Creando cuenta...';
  btn.querySelector('.btn-loader').style.display = 'block';
  errorEl.classList.remove('show');
  
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        email, 
        password,
        data: { name }
      })
    });
    
    const data = await res.json();
    
    if (!res.ok) {
      if (data.message?.includes('already registered')) {
        throw new Error('Este email ya está registrado');
      }
      throw new Error(data.error_description || data.message || 'Error al registrar');
    }
    
    if (data.session && data.user) {
      session = data.session;
      currentUser = {
        id: data.user.id,
        email: data.user.email,
        name: data.user.user_metadata?.name || name
      };
      
      await saveSession(session, currentUser);
      showMainScreen();
      showToast('¡Cuenta creada correctamente!');
    } else if (data.user) {
      showAuthError(errorEl, '✓ Cuenta creada. Revisa tu email para confirmarla y luego inicia sesión.');
      setTimeout(() => {
        document.querySelector('[data-tab="login"]').click();
        $('loginEmail').value = email;
      }, 2000);
    } else {
      throw new Error('Respuesta inesperada del servidor');
    }
    
  } catch (err) {
    showAuthError(errorEl, err.message);
  } finally {
    btn.disabled = false;
    btn.querySelector('.btn-text').textContent = 'Crear Cuenta';
    btn.querySelector('.btn-loader').style.display = 'none';
  }
}

// Logout
async function handleLogout() {
  try {
    if (session?.access_token) {
      await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${session.access_token}`
        }
      });
    }
  } catch (err) {
    console.log('Logout error:', err);
  }
  
  await clearSession();
  events = {};
  showAuthScreen();
  $('userDropdown').classList.remove('show');
}

function showAuthError(el, msg) {
  el.textContent = msg;
  el.classList.add('show');
}

// ============================================
// SUPABASE API WITH AUTH
// ============================================

async function api(method, body, query = '') {
  if (!session || !session.access_token) {
    const stored = await chrome.storage.local.get(['session']);
    if (stored.session && stored.session.access_token) {
      session = stored.session;
    } else {
      throw new Error('No hay sesión activa. Por favor, inicia sesión de nuevo.');
    }
  }
  
  const url = `${SUPABASE_URL}/rest/v1/calendar_events${query}`;
  const opts = {
    method,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    }
  };
  if (body) opts.body = JSON.stringify(body);
  
  console.log('API Call:', method, url, body ? JSON.stringify(body) : 'no body');
  
  const res = await fetch(url, opts);
  console.log('API Response:', res.status, res.statusText);
  
  if (!res.ok) {
    const errText = await res.text();
    console.error('API Error:', errText);
    if (res.status === 401 || res.status === 403) {
      if (session.refresh_token) {
        const refreshed = await refreshSession(session.refresh_token);
        if (refreshed) {
          const newStored = await chrome.storage.local.get(['session']);
          session = newStored.session;
          opts.headers.Authorization = `Bearer ${session.access_token}`;
          const retryRes = await fetch(url, opts);
          if (retryRes.ok) {
            if (method === 'DELETE') return {};
            return retryRes.json();
          }
        }
      }
      await handleLogout();
      throw new Error('Sesión expirada. Por favor, inicia sesión de nuevo.');
    }
    throw new Error(errText || `Error ${res.status}: ${res.statusText}`);
  }
  if (method === 'DELETE') return {};
  return res.json();
}

// ============================================
// INIT
// ============================================

document.addEventListener('DOMContentLoaded', () => {
  console.log('AGENDA STAFF v5.23.20 iniciado...');
  
  // Configure PDF.js worker after library is loaded
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdf.worker.min.js');
    console.log('PDF.js worker configured');
  } else {
    console.log('PDF.js library not loaded - PDF preview will use placeholder');
  }
  
  checkSession();
  setupListeners();
});

// Event Listeners
function setupListeners() {
  // Auth tabs
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      if (tab.dataset.tab === 'login') {
        $('loginForm').style.display = 'block';
        $('registerForm').style.display = 'none';
      } else {
        $('loginForm').style.display = 'none';
        $('registerForm').style.display = 'block';
      }
    });
  });
  
  // Auth forms
  $('loginForm').addEventListener('submit', handleLogin);
  $('registerForm').addEventListener('submit', handleRegister);
  
  // User menu
  $('btnUser').addEventListener('click', (e) => {
    e.stopPropagation();
    $('userDropdown').classList.toggle('show');
  });
  
  document.addEventListener('click', () => {
    $('userDropdown').classList.remove('show');
  });
  
  $('btnLogout').addEventListener('click', handleLogout);
  
  // Add event button
  $('btnAddEvent').addEventListener('click', () => openModal());
  
  // Screenshot button
  $('btnScreenshot').addEventListener('click', startScreenshot);
  
  // Toggle calendar visibility
  $('btnToggleCal').addEventListener('click', () => {
    document.querySelector('.mini-calendar').classList.toggle('hidden');
  });
  
  // Modal buttons
  $('btnCloseModal').addEventListener('click', closeModal);
  $('btnCancel').addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', e => {
    if (e.target === modalOverlay) closeModal();
  });
  
  // Form submit
  $('eventForm').addEventListener('submit', handleSubmit);
  
  // Calendar navigation
  $('btnPrevMonth').addEventListener('click', () => {
    calDate.setMonth(calDate.getMonth() - 1);
    renderCal();
  });
  $('btnNextMonth').addEventListener('click', () => {
    calDate.setMonth(calDate.getMonth() + 1);
    renderCal();
  });
  $('btnToday').addEventListener('click', () => {
    calDate = new Date();
    renderCal();
  });
  
  // Event delegation for days list (clicks)
  daysList.addEventListener('click', handleDaysClick);
  
  // Notification settings
  $('btnSettings').addEventListener('click', () => {
    $('settingsModal').classList.toggle('show');
  });
  
  $('closeSettings').addEventListener('click', () => {
    $('settingsModal').classList.remove('show');
  });
  
  $('notifToggle').addEventListener('change', saveNotificationSettings);
  $('notifMinutes').addEventListener('change', saveNotificationSettings);
  $('notifSound').addEventListener('change', saveNotificationSettings);
  
  $('btnTestNotif').addEventListener('click', testNotification);
  
  // Reminder banner buttons
  $('btnReminderDone').addEventListener('click', dismissReminder);
  $('btnReminderSnooze5').addEventListener('click', () => snoozeReminder(5));
  $('btnReminderSnooze15').addEventListener('click', () => snoozeReminder(15));
  
  // PDF Converter
  setupPdfListeners();
  
  // Signatures Manager
  setupSignatureListeners();
  
  // Drag events
  daysList.addEventListener('dragstart', handleDragStart);
  daysList.addEventListener('dragend', handleDragEnd);
  daysList.addEventListener('dragover', handleDragOver);
  daysList.addEventListener('dragleave', handleDragLeave);
  daysList.addEventListener('drop', handleDrop);
  
  // Calendar click and tooltip
  const calGrid = $('calGrid');
  calGrid.addEventListener('click', handleCalClick);
  calGrid.addEventListener('pointerenter', handleCalHover, true);
  calGrid.addEventListener('pointerleave', handleCalLeave, true);
}

// Handle calendar day hover (tooltip)
let currentTooltipDay = null;
let lastCalClick = { date: null, time: 0 };

function handleCalHover(e) {
  const day = e.target.closest('.cal-day');
  if (!day || day === currentTooltipDay) return;
  
  currentTooltipDay = day;
  
  const count = parseInt(day.dataset.count) || 0;
  if (count === 0) return;
  
  const tip = day.dataset.tip || '';
  if (!tip) return;
  
  const items = tip.split('||').filter(t => t);
  if (items.length === 0) return;
  
  const tooltip = $('calTip');
  tooltip.innerHTML = items.map(item => `<div class="tip-item">${esc(item)}</div>`).join('');
  
  const rect = day.getBoundingClientRect();
  tooltip.style.left = (rect.left + rect.width / 2) + 'px';
  tooltip.style.top = (rect.top - 8) + 'px';
  tooltip.style.transform = 'translate(-50%, -100%)';
  tooltip.classList.add('show');
}

function handleCalLeave(e) {
  const day = e.target.closest('.cal-day');
  if (!day) return;
  currentTooltipDay = null;
  $('calTip').classList.remove('show');
}

function handleCalClick(e) {
  const day = e.target.closest('.cal-day');
  if (!day) return;
  
  const targetDate = day.dataset.date;
  const now = Date.now();
  
  // Check for double click (within 300ms on same date)
  if (lastCalClick.date === targetDate && now - lastCalClick.time < 300) {
    // Double click - open modal to add event
    lastCalClick = { date: null, time: 0 };
    openModal(null, targetDate);
  } else {
    // Single click - navigate to the day
    lastCalClick = { date: targetDate, time: now };
    navigateToDate(targetDate);
  }
}

// Navigate to a specific date in the days list
function navigateToDate(targetDate) {
  const target = new Date(targetDate + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const rangeStart = new Date(viewStartDate);
  rangeStart.setHours(0, 0, 0, 0);
  const rangeEnd = new Date(rangeStart);
  rangeEnd.setDate(rangeEnd.getDate() + VISIBLE_DAYS);
  
  const isInRange = target >= rangeStart && target < rangeEnd;
  
  if (!isInRange) {
    // Set view start to show the target date
    // For past dates, start from the target date itself
    // For future dates, start a few days before
    viewStartDate = new Date(target);
    if (target >= today) {
      viewStartDate.setDate(viewStartDate.getDate() - 3);
    }
    viewStartDate.setHours(0, 0, 0, 0);
    
    renderDays();
  }
  
  document.querySelectorAll('.day-row.highlighted').forEach(el => {
    el.classList.remove('highlighted');
  });
  
  // Calculate if this day is in the "open by default" range
  const daysFromToday = Math.floor((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  const isOpenByDefault = daysFromToday >= 0 && daysFromToday <= 2;
  
  // Expand the day we're navigating to
  if (isOpenByDefault) {
    // For days open by default, remove from collapsed if present
    if (collapsed.has(targetDate)) {
      collapsed.delete(targetDate);
      renderDays();
    }
  } else {
    // For days collapsed by default, add to manuallyExpanded
    if (!manuallyExpanded.has(targetDate)) {
      manuallyExpanded.add(targetDate);
      renderDays();
    }
  }
  
  setTimeout(() => {
    const dayRow = document.querySelector(`.day-row[data-date="${targetDate}"]`);
    if (dayRow) {
      dayRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
      dayRow.classList.add('highlighted');
      
      setTimeout(() => {
        dayRow.classList.remove('highlighted');
      }, 2000);
    }
  }, 100);
}

function handleDaysClick(e) {
  const expandBtn = e.target.closest('.btn-expand');
  if (expandBtn) {
    const evtId = expandBtn.dataset.id;
    if (expandedEvents.has(evtId)) {
      expandedEvents.delete(evtId);
    } else {
      expandedEvents.add(evtId);
    }
    renderDays();
    return;
  }
  
  const completeBtn = e.target.closest('.btn-complete');
  if (completeBtn) {
    toggleCompleted(completeBtn.dataset.id);
    return;
  }
  
  const dayHeader = e.target.closest('.day-header');
  if (dayHeader) {
    const dayRow = dayHeader.closest('.day-row');
    const dateKey = dayRow.dataset.date;
    
    // Determine if this day is in the "open by default" range (today + 2 days)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dateObj = new Date(dateKey + 'T00:00:00');
    const daysFromToday = Math.floor((dateObj.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    const isOpenByDefault = daysFromToday >= 0 && daysFromToday <= 2;
    
    if (isOpenByDefault) {
      // For days that are open by default: use collapsed set
      if (collapsed.has(dateKey)) {
        collapsed.delete(dateKey);
      } else {
        collapsed.add(dateKey);
      }
    } else {
      // For days that are collapsed by default: use manuallyExpanded set
      if (manuallyExpanded.has(dateKey)) {
        manuallyExpanded.delete(dateKey);
      } else {
        manuallyExpanded.add(dateKey);
      }
    }
    renderDays();
    return;
  }
  
  const editBtn = e.target.closest('.btn-edit');
  if (editBtn) {
    openModal(editBtn.dataset.id);
    return;
  }
  
  const delBtn = e.target.closest('.btn-del');
  if (delBtn) {
    deleteEvent(delBtn.dataset.id);
    return;
  }
}

async function toggleCompleted(id) {
  let evt = null;
  let evtDate = null;
  for (const d in events) {
    const found = events[d].find(e => e.id === id);
    if (found) { evt = found; evtDate = d; break; }
  }
  
  if (!evt) return;
  
  const newStatus = !evt.completed;
  
  try {
    setStatus('sync', 'Actualizando...');
    await api('PATCH', { completed: newStatus }, `?id=eq.${id}`);
    evt.completed = newStatus;
    setStatus('ok', 'Sincronizado');
    renderDays();
    renderCal();
    
    // Re-schedule notifications (excludes completed events)
    scheduleNotifications();
    
    showToast(newStatus ? 'Tarea completada' : 'Tarea pendiente');
  } catch (err) {
    console.error(err);
    setStatus('err', 'Error');
    showToast('Error al actualizar');
  }
}

// Drag & Drop
function handleDragStart(e) {
  const row = e.target.closest('.event-row');
  if (!row) return;
  dragId = row.dataset.id;
  dragDate = row.dataset.date;
  row.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}

function handleDragEnd(e) {
  const row = e.target.closest('.event-row');
  if (row) row.classList.remove('dragging');
  document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  dragId = null;
  dragDate = null;
}

function handleDragOver(e) {
  e.preventDefault();
  const dayRow = e.target.closest('.day-row');
  if (dayRow) dayRow.classList.add('drag-over');
}

function handleDragLeave(e) {
  const dayRow = e.target.closest('.day-row');
  if (dayRow) dayRow.classList.remove('drag-over');
}

async function handleDrop(e) {
  e.preventDefault();
  const dayRow = e.target.closest('.day-row');
  if (!dayRow) return;
  
  dayRow.classList.remove('drag-over');
  const newDate = dayRow.dataset.date;
  
  if (!dragId || !dragDate || dragDate === newDate) return;
  
  try {
    setStatus('sync', 'Moviendo...');
    await api('PATCH', { date: newDate }, `?id=eq.${dragId}`);
    
    const oldList = events[dragDate] || [];
    const idx = oldList.findIndex(ev => ev.id === dragId);
    if (idx !== -1) {
      const [evt] = oldList.splice(idx, 1);
      evt.date = newDate;
      if (!events[newDate]) events[newDate] = [];
      events[newDate].push(evt);
      if (oldList.length === 0) delete events[dragDate];
    }
    
    setStatus('ok', 'Sincronizado');
    renderDays();
    renderCal();
    showToast('Evento movido');
  } catch (err) {
    console.error(err);
    setStatus('err', 'Error');
    showToast('Error al mover');
  }
}

// Render Days List
function renderDays() {
  const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 
                       'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  let html = '';
  
  for (let i = 0; i < VISIBLE_DAYS; i++) {
    const date = new Date(viewStartDate);
    date.setDate(date.getDate() + i);
    const key = fmtDate(date);
    const list = events[key] || [];
    const isToday = date.getTime() === today.getTime();
    
    // Calculate days from today (0 = today, 1 = tomorrow, etc.)
    const daysFromToday = Math.floor((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    const isOpenByDefault = daysFromToday >= 0 && daysFromToday <= 2;
    
    // Logic: Today + next 2 days are open by default (user can collapse them)
    // Other days are collapsed by default (user can expand them via manuallyExpanded)
    let isCol;
    if (isOpenByDefault) {
      isCol = collapsed.has(key);
    } else {
      isCol = !manuallyExpanded.has(key);
    }
    
    html += `
      <div class="day-row ${isToday ? 'today' : ''} ${isCol ? 'collapsed' : ''} ${list.length === 0 ? 'no-events' : ''}" data-date="${key}">
        <div class="day-header">
          <div class="day-date">
            <div class="day-name">${isToday ? 'HOY' : dayNames[date.getDay()]}</div>
            <div class="day-num">${date.getDate()} ${monthNames[date.getMonth()]}</div>
          </div>
          <div class="day-info">
            <span class="day-count">${list.length} evento${list.length !== 1 ? 's' : ''}</span>
            <div class="day-dots">
              ${list.slice(0, 4).map(ev => `<span class="day-dot ${ev.completed ? 'completed' : ''}" style="background:${ev.completed ? '#86efac' : ev.color}"></span>`).join('')}
            </div>
          </div>
          <div class="day-toggle">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </div>
        </div>
        <div class="day-events">
          ${list.length > 0 ? list.map(ev => {
            const isExpanded = expandedEvents.has(ev.id);
            const isOwn = ev.user_id === currentUser.id;
            const publicBadge = ev.is_public ? '<span class="event-public">🌍 Público</span>' : '';
            const authorName = !isOwn && ev.user_name ? `<span class="event-author">por ${esc(ev.user_name)}</span>` : '';
            return `
            <div class="event-row ${ev.completed ? 'completed' : ''} ${!isOwn ? 'shared-event' : ''}" draggable="${isOwn}" data-id="${ev.id}" data-date="${ev.date}">
              <span class="event-color ${ev.completed ? 'completed' : ''}" style="background:${ev.completed ? '#86efac' : ev.color}"></span>
              <div class="event-content">
                <div class="event-title">${ev.completed ? '✓ ' : ''}${esc(ev.title)}${publicBadge}${authorName}</div>
                ${ev.time ? `<div class="event-time">${fmtTime(ev.time)}</div>` : ''}
                ${isExpanded && ev.description ? `<div class="event-details">${esc(ev.description)}</div>` : ''}
              </div>
              <div class="event-btns">
                <button class="evt-btn btn-expand" data-id="${ev.id}" title="${isExpanded ? 'Ocultar detalles' : 'Ver detalles'}">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="transform: ${isExpanded ? 'rotate(180deg)' : 'rotate(0)'}">
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </button>
                ${isOwn ? `
                <button class="evt-btn btn-complete" data-id="${ev.id}" title="${ev.completed ? 'Desmarcar' : 'Completar'}">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                </button>
                <button class="evt-btn btn-edit" data-id="${ev.id}" title="Editar">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </button>
                <button class="evt-btn del btn-del" data-id="${ev.id}" title="Eliminar">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                  </svg>
                </button>
                ` : ''}
              </div>
            </div>
          `}).join('') : '<div class="no-events">Sin eventos</div>'}
        </div>
      </div>
    `;
  }
  
  daysList.innerHTML = html;
}

// Render Mini Calendar
function renderCal() {
  const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 
                       'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  
  $('calMonth').textContent = `${monthNames[calDate.getMonth()]} ${calDate.getFullYear()}`;
  
  const year = calDate.getFullYear();
  const month = calDate.getMonth();
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  
  let start = first.getDay();
  start = start === 0 ? 6 : start - 1;
  
  const days = last.getDate();
  const prev = new Date(year, month, 0).getDate();
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  let html = '';
  
  // Prev month days
  for (let i = start - 1; i >= 0; i--) {
    const d = prev - i;
    const dt = new Date(year, month - 1, d);
    const key = fmtDate(dt);
    const evts = events[key] || [];
    const tooltip = evts.map(e => `${e.completed ? '✓ ' : ''}${e.time ? fmtTime(e.time)+' ' : ''}${e.title}`).join('||');
    html += `<div class="cal-day other ${evts.length === 0 ? 'empty' : ''}" data-date="${key}" data-tip="${esc(tooltip)}" data-count="${evts.length}">${d}
      <div class="cal-dots">${evts.slice(0, 3).map(e => `<span class="cal-dot ${e.completed ? 'completed' : ''}" style="background:${e.completed ? '#86efac' : e.color}"></span>`).join('')}</div>
    </div>`;
  }
  
  // Current month
  for (let d = 1; d <= days; d++) {
    const dt = new Date(year, month, d);
    const key = fmtDate(dt);
    const evts = events[key] || [];
    const isToday = dt.getTime() === today.getTime();
    const tooltip = evts.map(e => `${e.completed ? '✓ ' : ''}${e.time ? fmtTime(e.time)+' ' : ''}${e.title}`).join('||');
    html += `<div class="cal-day ${isToday ? 'today' : ''} ${evts.length === 0 ? 'empty' : ''}" data-date="${key}" data-tip="${esc(tooltip)}" data-count="${evts.length}">${d}
      <div class="cal-dots">${evts.slice(0, 3).map(e => `<span class="cal-dot ${e.completed ? 'completed' : ''}" style="background:${e.completed ? '#86efac' : e.color}"></span>`).join('')}</div>
    </div>`;
  }
  
  // Next month
  const rem = 42 - (start + days);
  for (let d = 1; d <= rem; d++) {
    const dt = new Date(year, month + 1, d);
    const key = fmtDate(dt);
    const evts = events[key] || [];
    const tooltip = evts.map(e => `${e.completed ? '✓ ' : ''}${e.time ? fmtTime(e.time)+' ' : ''}${e.title}`).join('||');
    html += `<div class="cal-day other ${evts.length === 0 ? 'empty' : ''}" data-date="${key}" data-tip="${esc(tooltip)}" data-count="${evts.length}">${d}
      <div class="cal-dots">${evts.slice(0, 3).map(e => `<span class="cal-dot ${e.completed ? 'completed' : ''}" style="background:${e.completed ? '#86efac' : e.color}"></span>`).join('')}</div>
    </div>`;
  }
  
  $('calGrid').innerHTML = html;
}

// Modal
function openModal(id = null, date = null) {
  editingId = id;
  
  if (id) {
    let evt = null;
    for (const d in events) {
      const found = events[d].find(e => e.id === id);
      if (found) { evt = found; break; }
    }
    
    if (evt) {
      $('modalTitle').textContent = 'Editar Evento';
      $('inputTitle').value = evt.title;
      $('inputDate').value = evt.date;
      $('inputTime').value = evt.time || '';
      $('inputDesc').value = evt.description || '';
      $('inputPublic').checked = evt.is_public || false;
      
      const radio = document.querySelector(`input[name="color"][value="${evt.color}"]`);
      if (radio) radio.checked = true;
    }
  } else {
    $('modalTitle').textContent = 'Nuevo Evento';
    $('inputTitle').value = '';
    $('inputDate').value = date || fmtDate(new Date());
    $('inputTime').value = '';
    $('inputDesc').value = '';
    $('inputPublic').checked = false;
    $('c1').checked = true;
  }
  
  modalOverlay.classList.add('show');
  $('inputTitle').focus();
}

function closeModal() {
  modalOverlay.classList.remove('show');
  editingId = null;
}

// Handle form submit
async function handleSubmit(e) {
  e.preventDefault();
  
  const title = $('inputTitle').value.trim();
  const date = $('inputDate').value;
  const time = $('inputTime').value;
  const desc = $('inputDesc').value.trim();
  const color = document.querySelector('input[name="color"]:checked').value;
  const isPublic = $('inputPublic').checked;
  
  if (!title || !date) {
    showToast('Título y fecha requeridos');
    return;
  }
  
  try {
    setStatus('sync', 'Guardando...');
    
    if (editingId) {
      let oldDate = null;
      let oldCompleted = false;
      for (const d in events) {
        const found = events[d].find(e => e.id === editingId);
        if (found) { oldDate = d; oldCompleted = found.completed; break; }
      }
      
      await api('PATCH', { title, date, time: time || null, description: desc || null, color, is_public: isPublic, user_name: currentUser.name }, `?id=eq.${editingId}`);
      
      if (oldDate) {
        events[oldDate] = events[oldDate].filter(e => e.id !== editingId);
        if (events[oldDate].length === 0) delete events[oldDate];
      }
      if (!events[date]) events[date] = [];
      events[date].push({ id: editingId, title, date, time, description: desc, color, completed: oldCompleted, is_public: isPublic, user_id: currentUser.id, user_name: currentUser.name });
      
      showToast('Evento actualizado');
    } else {
      if (!currentUser || !currentUser.id) {
        throw new Error('Usuario no identificado. Por favor, recarga la página.');
      }
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
      console.log('Creating event with user_id:', currentUser.id);
      await api('POST', { id, title, date, time: time || null, description: desc || null, color, completed: false, user_id: currentUser.id, user_name: currentUser.name, is_public: isPublic });
      
      if (!events[date]) events[date] = [];
      events[date].push({ id, title, date, time, description: desc, color, completed: false, is_public: isPublic, user_id: currentUser.id, user_name: currentUser.name });
      
      showToast('Evento creado');
    }
    
    setStatus('ok', 'Sincronizado');
    closeModal();
    renderDays();
    renderCal();
    
    // Schedule notifications for upcoming events
    scheduleNotifications();
  } catch (err) {
    console.error('Error al guardar evento:', err);
    setStatus('err', 'Error');
    showToast('Error: ' + (err.message || 'Error al guardar'));
  }
}

// Delete
async function deleteEvent(id) {
  if (!confirm('¿Eliminar este evento?')) return;
  
  try {
    setStatus('sync', 'Eliminando...');
    await api('DELETE', null, `?id=eq.${id}`);
    
    for (const d in events) {
      events[d] = events[d].filter(e => e.id !== id);
      if (events[d].length === 0) delete events[d];
    }
    
    setStatus('ok', 'Sincronizado');
    renderDays();
    renderCal();
    showToast('Evento eliminado');
  } catch (err) {
    console.error(err);
    setStatus('err', 'Error');
    showToast('Error al eliminar');
  }
}

// Load Events
async function loadEvents() {
  if (!session || !currentUser) {
    console.log('No session, skipping load');
    return;
  }
  
  try {
    setStatus('sync', 'Cargando...');
    
    // Load events: own events OR public events from others
    const query = `?select=*&or=(user_id.eq.${currentUser.id},is_public.eq.true)&order=date.asc&order=time.asc`;
    const data = await api('GET', null, query);
    
    events = {};
    const eventsList = [];
    
    if (data && data.length > 0) {
      data.forEach(ev => {
        if (!events[ev.date]) events[ev.date] = [];
        events[ev.date].push({
          id: ev.id,
          title: ev.title,
          date: ev.date,
          time: ev.time,
          description: ev.description,
          color: ev.color,
          completed: ev.completed || false,
          is_public: ev.is_public || false,
          user_id: ev.user_id,
          user_name: ev.user_name && ev.user_name !== 'Usuario' ? ev.user_name : null
        });
        
        // Add to flat list for notifications (only own events with time AND NOT completed)
        if (ev.user_id === currentUser.id && ev.time && !ev.completed) {
          eventsList.push(ev);
        }
      });
    }
    
    setStatus('ok', 'Sincronizado');
    renderDays();
    renderCal();
    
    // Schedule notifications for upcoming events (excludes completed)
    scheduleNotifications(eventsList);
  } catch (err) {
    console.error('Load error:', err);
    setStatus('err', 'Error');
    showToast('Error de conexión: ' + err.message);
    
    if (err.message.includes('expirada') || err.message.includes('401') || err.message.includes('403')) {
      handleLogout();
    }
  }
}

// Schedule notifications - ONLY for events that are NOT completed
function scheduleNotifications(eventsList) {
  if (!eventsList) {
    // Build events list from current events (exclude completed)
    eventsList = [];
    for (const date in events) {
      events[date].forEach(ev => {
        // Only include own events with time AND NOT completed
        if (ev.user_id === currentUser?.id && ev.time && !ev.completed) {
          eventsList.push(ev);
        }
      });
    }
  }
  
  chrome.runtime.sendMessage({
    type: 'SCHEDULE_NOTIFICATIONS',
    events: eventsList
  });
}

// Test notification
function testNotification() {
  chrome.runtime.sendMessage({
    type: 'TEST_NOTIFICATION',
    title: 'Prueba de notificación 📅'
  });
  showToast('Notificación de prueba enviada');
}

// Show reminder banner
function showReminderBanner(event) {
  currentReminder = event;
  const banner = $('reminderBanner');
  
  $('reminderTitle').textContent = event.title;
  $('reminderTime').textContent = event.time ? fmtTime(event.time) : '';
  
  banner.classList.add('show');
}

// Dismiss reminder
function dismissReminder() {
  $('reminderBanner').classList.remove('show');
  currentReminder = null;
}

// Snooze reminder
function snoozeReminder(minutes) {
  if (currentReminder) {
    chrome.runtime.sendMessage({
      type: 'SCHEDULE_NOTIFICATIONS',
      events: [{
        ...currentReminder,
        id: `snooze_${Date.now()}`
      }]
    });
    showToast(`Recordatorio pospuesto ${minutes} minutos`);
  }
  dismissReminder();
}

// ============================================
// PDF TOOLS
// ============================================

function setupPdfListeners() {
  // Open PDF modal
  $('btnPdf').addEventListener('click', openPdfModal);
  $('closePdfModal').addEventListener('click', closePdfModal);
  
  // PDF Editor (simplified - no tabs)
  $('pdfEditorUpload').addEventListener('click', () => $('editorFileInput').click());
  $('editorFileInput').addEventListener('change', handleEditorFileSelect);
  $('pdfEditorUpload').addEventListener('dragover', (e) => { e.preventDefault(); e.currentTarget.classList.add('drag-over'); });
  $('pdfEditorUpload').addEventListener('dragleave', (e) => e.currentTarget.classList.remove('drag-over'));
  $('pdfEditorUpload').addEventListener('drop', handleEditorDrop);
  $('btnAddText').addEventListener('click', () => addTextToPdf());
  $('btnAddImage').addEventListener('click', () => addImageToPdf());
  $('btnAddSignature').addEventListener('click', () => addSignatureToPdf());
  $('btnClearEditor').addEventListener('click', clearPdfEditor);
  $('btnPrevPage').addEventListener('click', () => navigateEditorPage(-1));
  $('btnNextPage').addEventListener('click', () => navigateEditorPage(1));
  $('btnSavePdf').addEventListener('click', saveEditedPdf);
  $('btnOpenFullEditor').addEventListener('click', openFullPdfEditor);
}

function openPdfModal() {
  // Show the modal in fullscreen mode (occupy entire sidepanel)
  $('pdfModal').classList.add('show', 'fullscreen');
  
  // Hide header, calendar and days list when modal is open
  document.querySelector('.header').style.display = 'none';
  document.querySelector('.days-section').style.display = 'none';
  document.querySelector('.mini-calendar').style.display = 'none';
}

function closePdfModal() {
  $('pdfModal').classList.remove('show', 'fullscreen');
  
  // Restore header and days list when modal is closed
  document.querySelector('.header').style.display = '';
  document.querySelector('.days-section').style.display = '';
  
  // Only show mini-calendar if it was NOT hidden before (respect the hidden class)
  const miniCal = document.querySelector('.mini-calendar');
  if (miniCal) {
    // Remove any inline display style, let the CSS class control visibility
    miniCal.style.display = '';
  }
}

// Image to PDF functions
function handlePdfDragOver(e) {
  e.preventDefault();
  $('pdfDropzone').classList.add('drag-over');
}

function handlePdfDragLeave(e) {
  $('pdfDropzone').classList.remove('drag-over');
}

function handlePdfDrop(e) {
  e.preventDefault();
  $('pdfDropzone').classList.remove('drag-over');
  const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
  if (files.length > 0) {
    addPdfImages(files);
  }
}

function handlePdfFileSelect(e) {
  const files = Array.from(e.target.files);
  if (files.length > 0) {
    addPdfImages(files);
  }
}

async function addPdfImages(files) {
  for (const file of files) {
    const reader = new FileReader();
    const dataUrl = await new Promise((resolve, reject) => {
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    pdfImages.push({ name: file.name, dataUrl });
  }
  renderPdfPreview();
}

function renderPdfPreview() {
  if (pdfImages.length === 0) {
    $('pdfPreviewArea').style.display = 'none';
    return;
  }
  
  $('pdfPreviewArea').style.display = 'block';
  $('pdfPreviewList').innerHTML = pdfImages.map((img, i) => `
    <div class="pdf-preview-item">
      <img src="${img.dataUrl}" alt="${img.name}">
      <span class="pdf-preview-name">${img.name}</span>
      <button class="pdf-remove-btn" data-index="${i}">✕</button>
    </div>
  `).join('');
  
  // Add remove listeners
  document.querySelectorAll('.pdf-remove-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const index = parseInt(e.target.dataset.index);
      pdfImages.splice(index, 1);
      renderPdfPreview();
    });
  });
}

function clearPdfFiles() {
  pdfImages = [];
  $('pdfPreviewArea').style.display = 'none';
  $('pdfFileInput').value = '';
}

function selectOrientation(orient) {
  pdfOrientation = orient;
  document.querySelectorAll('.pdf-option-btn').forEach(btn => btn.classList.remove('active'));
  $(orient === 'portrait' ? 'btnPortrait' : 'btnLandscape').classList.add('active');
}

async function convertToPdf() {
  if (pdfImages.length === 0) {
    showToast('Añade al menos una imagen');
    return;
  }
  
  const btn = $('btnConvertPdf');
  btn.disabled = true;
  btn.querySelector('.btn-text').textContent = 'Convirtiendo...';
  btn.querySelector('.btn-loader').style.display = 'block';
  
  try {
    const { jsPDF } = window.jspdf;
    const pageSize = $('pdfPageSize').value;
    
    // Determine orientation and size
    let orientation = pdfOrientation;
    let pageWidth, pageHeight;
    
    switch (pageSize) {
      case 'a4':
        pageWidth = orientation === 'portrait' ? 210 : 297;
        pageHeight = orientation === 'portrait' ? 297 : 210;
        break;
      case 'letter':
        pageWidth = orientation === 'portrait' ? 215.9 : 279.4;
        pageHeight = orientation === 'portrait' ? 279.4 : 215.9;
        break;
      case 'legal':
        pageWidth = orientation === 'portrait' ? 215.9 : 355.6;
        pageHeight = orientation === 'portrait' ? 355.6 : 215.9;
        break;
      case 'fit':
        // Will be determined per image
        break;
    }
    
    const pdf = new jsPDF({
      orientation: pageSize === 'fit' ? 'portrait' : orientation,
      unit: 'mm',
      format: pageSize === 'fit' ? 'a4' : pageSize
    });
    
    for (let i = 0; i < pdfImages.length; i++) {
      if (i > 0) pdf.addPage();
      
      const img = pdfImages[i];
      const imgEl = await createImageBitmap(await (await fetch(img.dataUrl)).blob());
      
      if (pageSize === 'fit') {
        // Fit page to image
        const imgWidth = imgEl.width * 0.264583; // px to mm
        const imgHeight = imgEl.height * 0.264583;
        pdf.internal.pageSize.setWidth(imgWidth);
        pdf.internal.pageSize.setHeight(imgHeight);
        pdf.addImage(img.dataUrl, 'JPEG', 0, 0, imgWidth, imgHeight);
      } else {
        // Fit image to page with margins
        const margin = 10;
        const maxWidth = pageWidth - margin * 2;
        const maxHeight = pageHeight - margin * 2;
        
        const imgRatio = imgEl.width / imgEl.height;
        let finalWidth = maxWidth;
        let finalHeight = finalWidth / imgRatio;
        
        if (finalHeight > maxHeight) {
          finalHeight = maxHeight;
          finalWidth = finalHeight * imgRatio;
        }
        
        const x = (pageWidth - finalWidth) / 2;
        const y = (pageHeight - finalHeight) / 2;
        
        pdf.addImage(img.dataUrl, 'JPEG', x, y, finalWidth, finalHeight);
      }
    }
    
    pdf.save('documento.pdf');
    showToast('PDF creado correctamente');
    closePdfModal();
    clearPdfFiles();
    
  } catch (err) {
    console.error('Error creating PDF:', err);
    showToast('Error al crear PDF: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.querySelector('.btn-text').textContent = 'Convertir a PDF →';
    btn.querySelector('.btn-loader').style.display = 'none';
  }
}

// Merge PDFs functions
function handleMergeDragOver(e) {
  e.preventDefault();
  $('mergeDropzone').classList.add('drag-over');
}

function handleMergeDragLeave(e) {
  $('mergeDropzone').classList.remove('drag-over');
}

function handleMergeDrop(e) {
  e.preventDefault();
  $('mergeDropzone').classList.remove('drag-over');
  const files = Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf');
  if (files.length > 0) {
    addMergeFiles(files);
  }
}

function handleMergeFileSelect(e) {
  const files = Array.from(e.target.files);
  if (files.length > 0) {
    addMergeFiles(files);
  }
}

async function addMergeFiles(files) {
  for (const file of files) {
    const arrayBuffer = await file.arrayBuffer();
    mergePdfs.push({ name: file.name, data: arrayBuffer });
  }
  renderMergePreview();
}

function renderMergePreview() {
  if (mergePdfs.length === 0) {
    $('mergePreviewArea').style.display = 'none';
    return;
  }
  
  $('mergePreviewArea').style.display = 'block';
  $('mergePreviewList').innerHTML = mergePdfs.map((pdf, i) => `
    <div class="pdf-preview-item" draggable="true" data-index="${i}">
      <span class="pdf-icon">📄</span>
      <span class="pdf-preview-name">${pdf.name}</span>
      <button class="pdf-remove-btn" data-index="${i}">✕</button>
    </div>
  `).join('');
  
  document.querySelectorAll('#mergePreviewList .pdf-remove-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const index = parseInt(e.target.dataset.index);
      mergePdfs.splice(index, 1);
      renderMergePreview();
    });
  });
}

function clearMergeFiles() {
  mergePdfs = [];
  $('mergePreviewArea').style.display = 'none';
  $('mergeFileInput').value = '';
}

async function mergePdfsAction() {
  if (mergePdfs.length < 2) {
    showToast('Añade al menos 2 PDFs para juntar');
    return;
  }
  
  const btn = $('btnMergePdf');
  btn.disabled = true;
  btn.querySelector('.btn-text').textContent = 'Juntando...';
  btn.querySelector('.btn-loader').style.display = 'block';
  
  try {
    // Use pdf-lib from global scope
    const PDFLib = window.PDFLib;
    if (!PDFLib) {
      throw new Error('pdf-lib no está cargado. Recarga la página.');
    }
    
    const mergedPdf = await PDFLib.PDFDocument.create();
    
    for (const pdfFile of mergePdfs) {
      const pdfDoc = await PDFLib.PDFDocument.load(pdfFile.data);
      const pages = await mergedPdf.copyPages(pdfDoc, pdfDoc.getPageIndices());
      pages.forEach(page => mergedPdf.addPage(page));
    }
    
    const pdfBytes = await mergedPdf.save();
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = 'documento_combinado.pdf';
    a.click();
    URL.revokeObjectURL(url);
    
    showToast('PDFs combinados correctamente');
    closePdfModal();
    clearMergeFiles();
    
  } catch (err) {
    console.error('Error merging PDFs:', err);
    showToast('Error: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.querySelector('.btn-text').textContent = 'Juntar PDFs →';
    btn.querySelector('.btn-loader').style.display = 'none';
  }
}

// Split PDF functions
function handleSplitDragOver(e) {
  e.preventDefault();
  $('splitDropzone').classList.add('drag-over');
}

function handleSplitDragLeave(e) {
  $('splitDropzone').classList.remove('drag-over');
}

function handleSplitDrop(e) {
  e.preventDefault();
  $('splitDropzone').classList.remove('drag-over');
  const files = Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf');
  if (files.length > 0) {
    setSplitFile(files[0]);
  }
}

function handleSplitFileSelect(e) {
  const files = Array.from(e.target.files);
  if (files.length > 0) {
    setSplitFile(files[0]);
  }
}

async function setSplitFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  splitPdfFile = { name: file.name, data: arrayBuffer };
  
  $('splitPreviewArea').style.display = 'block';
  $('splitFileInfo').innerHTML = `
    <span class="pdf-icon">📄</span>
    <span>${file.name}</span>
  `;
}

function clearSplitFile() {
  splitPdfFile = null;
  $('splitPreviewArea').style.display = 'none';
  $('splitFileInput').value = '';
}

async function splitPdfAction() {
  if (!splitPdfFile) {
    showToast('Selecciona un PDF para separar');
    return;
  }
  
  const btn = $('btnSplitPdf');
  btn.disabled = true;
  btn.querySelector('.btn-text').textContent = 'Separando...';
  btn.querySelector('.btn-loader').style.display = 'block';
  
  try {
    // Use pdf-lib from global scope
    const PDFLib = window.PDFLib;
    if (!PDFLib) {
      throw new Error('pdf-lib no está cargado');
    }
    
    const pdfDoc = await PDFLib.PDFDocument.load(splitPdfFile.data);
    const pageCount = pdfDoc.getPageCount();
    
    showToast(`Separando ${pageCount} páginas en PDFs...`);
    
    for (let i = 0; i < pageCount; i++) {
      const newPdf = await PDFLib.PDFDocument.create();
      const [page] = await newPdf.copyPages(pdfDoc, [i]);
      newPdf.addPage(page);
      
      const pdfBytes = await newPdf.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `pagina_${i + 1}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    }
    
    showToast(`${pageCount} PDFs creados correctamente`);
    closePdfModal();
    clearSplitFile();
    
  } catch (err) {
    console.error('Error splitting PDF:', err);
    showToast('Error al separar PDF: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.querySelector('.btn-text').textContent = 'Separar en PDFs →';
    btn.querySelector('.btn-loader').style.display = 'none';
  }
}

// ============================================
// SCREENSHOT FUNCTIONALITY
// ============================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SCREENSHOT_RESULT') {
    handleScreenshotResult(message.dataUrl);
    sendResponse({ success: true });
    return true;
  }
  
  if (message.type === 'SCREENSHOT_CANCELLED') {
    $('btnScreenshot').classList.remove('capturing');
    showToast('Captura cancelada');
    sendResponse({ success: true });
    return true;
  }
  
  if (message.type === 'SCREENSHOT_ERROR') {
    $('btnScreenshot').classList.remove('capturing');
    showToast('Error: ' + message.error);
    sendResponse({ success: true });
    return true;
  }
  
  if (message.type === 'SHOW_REMINDER') {
    showReminderBanner(message.event);
    sendResponse({ success: true });
    return true;
  }
});

async function startScreenshot() {
  const btn = $('btnScreenshot');
  btn.classList.add('capturing');
  
  try {
    await chrome.runtime.sendMessage({ type: 'START_SCREENSHOT' });
  } catch (err) {
    console.error('Error starting screenshot:', err);
    btn.classList.remove('capturing');
    showToast('Error al iniciar captura');
  }
}

async function handleScreenshotResult(dataUrl) {
  const btn = $('btnScreenshot');
  btn.classList.remove('capturing');
  
  if (!dataUrl) {
    showToast('Error: No se recibió la imagen');
    return;
  }
  
  try {
    const response = await fetch(dataUrl);
    if (!response.ok) throw new Error('Error convirtiendo datos');
    const blob = await response.blob();
    
    if (!blob || blob.size === 0) throw new Error('Blob vacío');
    
    // Try clipboard first
    let clipboardSuccess = false;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ]);
      clipboardSuccess = true;
    } catch (clipErr) {
      console.log('Clipboard no disponible:', clipErr.message);
    }
    
    // Only download if clipboard failed
    if (!clipboardSuccess) {
      try {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `captura-${Date.now()}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (downloadErr) {
        console.log('Download error:', downloadErr.message);
      }
      showToast('✅ Captura descargada');
    } else {
      showToast('✅ Captura copiada al portapapeles');
    }
  } catch (err) {
    console.error('Error processing screenshot:', err);
    showToast('Error al procesar: ' + err.message);
  }
}

// Helpers
function setStatus(type, text) {
  const avatar = $('userAvatar');
  // Map type to valid status: 'sync', 'ok', 'err'
  const status = type || 'ok';
  avatar.dataset.status = status;
}

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hr = parseInt(h);
  const ap = hr >= 12 ? 'PM' : 'AM';
  return `${hr % 12 || 12}:${m} ${ap}`;
}

function esc(txt) {
  const div = document.createElement('div');
  div.textContent = txt;
  return div.innerHTML;
}

// Sync every 30s
setInterval(() => {
  if (currentUser && session) {
    loadEvents();
  }
}, 30000);

// Auto-refresh token every 50 minutes
setInterval(async () => {
  if (session && session.refresh_token) {
    const stored = await chrome.storage.local.get(['session']);
    if (stored.session && stored.session.refresh_token) {
      const success = await refreshSession(stored.session.refresh_token);
      if (success) {
        const newStored = await chrome.storage.local.get(['session']);
        session = newStored.session;
        console.log('Token auto-refreshed');
      }
    }
  }
}, 50 * 60 * 1000);

// ============================================
// WORD TO PDF
// ============================================

function handleWordDragOver(e) {
  e.preventDefault();
  $('wordDropzone').classList.add('drag-over');
}

function handleWordDragLeave(e) {
  $('wordDropzone').classList.remove('drag-over');
}

function handleWordDrop(e) {
  e.preventDefault();
  $('wordDropzone').classList.remove('drag-over');
  const files = e.dataTransfer.files;
  if (files.length > 0) {
    processWordFile(files[0]);
  }
}

function handleWordFileSelect(e) {
  const file = e.target.files[0];
  if (file) processWordFile(file);
}

function processWordFile(file) {
  const validTypes = [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword'
  ];
  const ext = file.name.split('.').pop().toLowerCase();
  
  if (!validTypes.includes(file.type) && !['docx', 'doc'].includes(ext)) {
    showToast('Por favor, selecciona un archivo Word (.docx o .doc)');
    return;
  }
  
  wordFile = file;
  $('wordFileInfo').innerHTML = `<span style="font-size:16px">📝</span> ${file.name}`;
  $('wordPreviewArea').style.display = 'block';
  $('wordDropzone').style.display = 'none';
}

function clearWordFile() {
  wordFile = null;
  $('wordPreviewArea').style.display = 'none';
  $('wordDropzone').style.display = 'block';
  $('wordFileInput').value = '';
}

async function convertWordToPdf() {
  if (!wordFile) {
    showToast('Selecciona un archivo Word');
    return;
  }
  
  const btn = $('btnWordToPdf');
  btn.disabled = true;
  btn.querySelector('.btn-text').textContent = 'Convirtiendo...';
  btn.querySelector('.btn-loader').style.display = 'inline-block';
  
  try {
    // Read the Word file
    const arrayBuffer = await wordFile.arrayBuffer();
    
    // Check if mammoth is available (use window.mammoth for global access)
    const mammothLib = window.mammoth;
    if (!mammothLib) {
      throw new Error('La librería mammoth no está cargada. Recarga la extensión.');
    }
    
    const result = await mammothLib.convertToHtml({ arrayBuffer });
    const html = result.value;
    
    // Create PDF from HTML using jspdf
    if (typeof window.jspdf === 'undefined') {
      throw new Error('La librería jsPDF no está cargada. Recarga la extensión.');
    }
    
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    // Parse HTML and add to PDF
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    tempDiv.style.width = '170mm';
    document.body.appendChild(tempDiv);
    
    // Extract text content
    const textContent = tempDiv.innerText || tempDiv.textContent;
    const lines = doc.splitTextToSize(textContent, 180);
    
    let y = 20;
    const pageHeight = doc.internal.pageSize.height;
    
    for (let i = 0; i < lines.length; i++) {
      if (y > pageHeight - 20) {
        doc.addPage();
        y = 20;
      }
      doc.text(lines[i], 15, y);
      y += 7;
    }
    
    document.body.removeChild(tempDiv);
    
    // Download PDF
    const fileName = wordFile.name.replace(/\.(docx|doc)$/i, '.pdf');
    doc.save(fileName);
    
    showToast('✅ PDF creado correctamente');
    clearWordFile();
    
  } catch (err) {
    console.error('Word to PDF error:', err);
    showToast('Error: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.querySelector('.btn-text').textContent = 'Convertir a PDF →';
    btn.querySelector('.btn-loader').style.display = 'none';
  }
}

async function loadMammoth() {
  // Check if mammoth is already loaded (from local script in HTML)
  if (typeof mammoth !== 'undefined') {
    return Promise.resolve();
  }
  // If not loaded, show error - we can't load external scripts in Chrome extension
  return Promise.reject(new Error('mammoth.js no está disponible. Recarga la extensión.'));
}

// ============================================
// PDF EDITOR
// ============================================

function handleEditorDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  const files = e.dataTransfer.files;
  if (files.length > 0) {
    loadPdfForEditor(files[0]);
  }
}

function handleEditorFileSelect(e) {
  const file = e.target.files[0];
  if (file) loadPdfForEditor(file);
}

async function loadPdfForEditor(file) {
  if (file.type !== 'application/pdf' && !file.name.endsWith('.pdf')) {
    showToast('Por favor, selecciona un archivo PDF');
    return;
  }
  
  // Check if PDFLib is available (use window.PDFLib for global access)
  const pdfLib = window.PDFLib;
  if (!pdfLib) {
    showToast('Error: La librería PDFLib no está cargada. Recarga la extensión.');
    return;
  }
  
  // Ensure modal is open
  const pdfModal = $('pdfModal');
  if (pdfModal && !pdfModal.classList.contains('show')) {
    openPdfModal();
  }
  
  try {
    const arrayBuffer = await file.arrayBuffer();
    editorPdfBytes = new Uint8Array(arrayBuffer);
    
    // Load with pdf-lib
    const { PDFDocument } = pdfLib;
    editorPdfDoc = await PDFDocument.load(editorPdfBytes);
    editorTotalPages = editorPdfDoc.getPageCount();
    editorCurrentPage = 1;
    
    // Initialize elements for each page
    editorElements = {};
    for (let i = 1; i <= editorTotalPages; i++) {
      editorElements[i] = [];
    }
    
    // Render first page
    await renderEditorPage();
    
    // Show UI (with null checks)
    const uploadEl = $('pdfEditorUpload');
    const navEl = $('pdfEditorNav');
    const saveBtn = $('btnSavePdf');
    
    if (uploadEl) uploadEl.style.display = 'none';
    if (navEl) navEl.style.display = 'flex';
    if (saveBtn) saveBtn.style.display = 'flex';
    
    showToast(`PDF cargado: ${editorTotalPages} páginas`);
    
  } catch (err) {
    console.error('Error loading PDF:', err);
    showToast('Error al cargar el PDF');
  }
}

async function renderEditorPage() {
  if (!editorPdfDoc) {
    console.error('renderEditorPage: No PDF document loaded');
    return;
  }
  
  const container = $('pdfEditorPages');
  
  // Ensure elements array exists for current page
  if (!editorElements[editorCurrentPage]) {
    editorElements[editorCurrentPage] = [];
  }
  
  try {
    // Get page dimensions first (before clearing container)
    const page = editorPdfDoc.getPage(editorCurrentPage - 1);
    const { width, height } = page.getSize();
    
    // Calculate scale to fit container (max width ~280px)
    editorScale = Math.min(280 / width, 400 / height, 1);
    
    // Create canvas for rendering
    const canvasContainer = document.createElement('div');
    canvasContainer.className = 'pdf-canvas-container';
    canvasContainer.style.position = 'relative';
    
    const canvas = document.createElement('canvas');
    canvas.width = width * editorScale;
    canvas.height = height * editorScale;
    editorCanvas = canvas;
    
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Try to render with pdf.js if available, otherwise show placeholder
    let renderSuccess = false;
    if (typeof pdfjsLib !== 'undefined') {
      try {
        const pdfJsDoc = await pdfjsLib.getDocument(editorPdfBytes).promise;
        const pdfJsPage = await pdfJsDoc.getPage(editorCurrentPage);
        const viewport = pdfJsPage.getViewport({ scale: editorScale });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await pdfJsPage.render({ canvasContext: ctx, viewport }).promise;
        renderSuccess = true;
      } catch (e) {
        console.log('pdf.js render failed, using placeholder:', e);
      }
    }
    
    // If pdf.js failed, draw placeholder
    if (!renderSuccess) {
      drawPlaceholder(ctx, canvas.width, canvas.height);
    }
    
    canvasContainer.appendChild(canvas);
    
    // Create overlay for elements
    const overlay = document.createElement('div');
    overlay.className = 'pdf-editor-overlay';
    overlay.id = 'editorOverlay';
    overlay.style.width = canvas.width + 'px';
    overlay.style.height = canvas.height + 'px';
    
    // Render existing elements for this page
    const pageElements = editorElements[editorCurrentPage] || [];
    pageElements.forEach((el, idx) => {
      const elDiv = createEditorElement(el, idx);
      overlay.appendChild(elDiv);
    });
    
    canvasContainer.appendChild(overlay);
    
    // Only clear container AFTER canvas is fully prepared
    container.innerHTML = '';
    container.appendChild(canvasContainer);
    
    // Update page info
    $('currentPageNum').textContent = editorCurrentPage;
    $('totalPages').textContent = editorTotalPages;
    
  } catch (err) {
    console.error('Error rendering PDF page:', err);
    // Show error message in container instead of leaving it empty
    container.innerHTML = `<div class="pdf-error" style="padding: 20px; text-align: center; color: #dc2626;">
      <p>Error al renderizar la página</p>
      <p style="font-size: 12px; color: #666;">${err.message}</p>
      <button onclick="renderEditorPage()" style="margin-top: 10px; padding: 8px 16px; cursor: pointer;">Reintentar</button>
    </div>`;
  }
}

function drawPlaceholder(ctx, width, height) {
  ctx.fillStyle = '#f0f0f0';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#999';
  ctx.font = '14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`Página ${editorCurrentPage}`, width / 2, height / 2);
}

function createEditorElement(el, idx) {
  const div = document.createElement('div');
  div.className = `pdf-element pdf-element-${el.type}`;
  div.dataset.idx = idx;
  div.style.left = (el.x * editorScale) + 'px';
  div.style.top = (el.y * editorScale) + 'px';
  
  if (el.type === 'text') {
    // Create text span (to allow child elements like name label)
    const textSpan = document.createElement('span');
    textSpan.textContent = el.text;
    div.appendChild(textSpan);
    div.style.fontSize = (el.size || 14) * editorScale + 'px';
    div.style.color = el.color || '#000';
    
    // Show name label for DNI/NIE texts
    if (el.name) {
      const nameLabel = document.createElement('div');
      nameLabel.className = 'text-name-label';
      nameLabel.textContent = el.name;
      div.appendChild(nameLabel);
      div.title = `DNI de: ${el.name}`;
    }
  } else if (el.type === 'image' || el.type === 'signature') {
    const img = document.createElement('img');
    img.src = el.src;
    img.style.width = (el.width * editorScale) + 'px';
    img.style.height = 'auto';
    img.draggable = false;
    div.appendChild(img);
    div.style.background = 'transparent';
  }
  
  // Delete button
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'pdf-element-delete';
  deleteBtn.textContent = '✕';
  deleteBtn.onclick = (e) => {
    e.stopPropagation();
    // Ensure the page array exists
    if (editorElements[editorCurrentPage]) {
      editorElements[editorCurrentPage].splice(idx, 1);
      renderEditorPage();
    }
  };
  div.appendChild(deleteBtn);
  
  // Make draggable
  makeElementDraggable(div, el);
  
  return div;
}

function makeElementDraggable(div, el) {
  let isDragging = false;
  let startX, startY, origX, origY;
  
  div.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('pdf-element-delete')) return;
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    origX = el.x * editorScale;
    origY = el.y * editorScale;
    div.classList.add('selected');
    selectedElement = { div, el };
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
    el.x = Math.max(0, (origX + dx) / editorScale);
    el.y = Math.max(0, (origY + dy) / editorScale);
    div.classList.remove('selected');
  });
}

function addTextToPdf() {
  if (!editorPdfDoc) {
    showToast('Primero carga un PDF');
    return;
  }
  
  // Create text input modal
  const modal = document.createElement('div');
  modal.className = 'pdf-text-input-modal';
  modal.innerHTML = `
    <h4>📝 Añadir texto</h4>
    <textarea id="textInputText" placeholder="Escribe el texto...&#10;&#10;Puedes añadir múltiples líneas:&#10;NOMBRE APELLIDOS 12345678A&#10;OTRO NOMBRE X1234567B" style="min-height: 120px;"></textarea>
    <input type="number" id="textInputSize" placeholder="Tamaño de fuente" value="14" min="8" max="72">
    <input type="color" id="textInputColor" value="#000000" title="Color del texto">
    <div class="pdf-text-input-actions">
      <button class="btn-cancel" id="cancelTextBtn">Cancelar</button>
      <button class="btn-add" id="addTextBtn">Añadir</button>
    </div>
  `;
  document.body.appendChild(modal);
  
  const closeModal = () => modal.remove();
  
  modal.querySelector('#cancelTextBtn').onclick = closeModal;
  modal.querySelector('#addTextBtn').onclick = () => {
    const text = modal.querySelector('#textInputText').value.trim();
    const size = parseInt(modal.querySelector('#textInputSize').value) || 14;
    const color = modal.querySelector('#textInputColor').value;
    
    if (!text) {
      showToast('Escribe un texto');
      return;
    }
    
    // Ensure the elements array for current page exists
    if (!editorElements[editorCurrentPage]) {
      editorElements[editorCurrentPage] = [];
    }
    
    // DNI/NIE patterns
    const dniPatterns = [
      /\b\d{8}[A-Za-z]\b/g,           // DNI: 12345678A
      /\b[XYZ]\d{7}[A-Za-z]\b/g,      // NIE: X1234567A
      /\b\d{8}-[A-Za-z]\b/g,          // DNI con guión: 12345678-A
      /\b[XYZ]\d{7}-[A-Za-z]\b/g      // NIE con guión: X1234567-A
    ];
    
    // Check if text has multiple lines
    const lines = text.split(/\n|\r\n|\r/).map(l => l.trim()).filter(l => l);
    
    let startX = 50;
    let startY = 50;
    
    if (lines.length > 1) {
      // Multi-line mode: process each line
      let currentY = startY;
      let totalCreated = 0;
      
      lines.forEach(line => {
        let foundDni = null;
        let textWithoutDni = line;
        
        // Search for DNI/NIE in line
        for (const pattern of dniPatterns) {
          const match = line.match(pattern);
          if (match) {
            foundDni = match[0];
            textWithoutDni = line.replace(pattern, '').replace(/\s+/g, ' ').trim();
            break;
          }
        }
        
        if (foundDni && textWithoutDni) {
          // Create name text
          editorElements[editorCurrentPage].push({
            type: 'text',
            text: textWithoutDni,
            x: startX,
            y: currentY,
            size,
            color
          });
          
          // Create DNI text with name reference
          editorElements[editorCurrentPage].push({
            type: 'text',
            text: foundDni,
            x: startX,
            y: currentY + size + 3,
            size,
            color,
            name: textWithoutDni  // Store name for tooltip
          });
          
          currentY += (size * 2) + 15; // Space between pairs
          totalCreated += 2;
        } else if (line) {
          // No DNI found, add as single text
          editorElements[editorCurrentPage].push({
            type: 'text',
            text: line,
            x: startX,
            y: currentY,
            size,
            color
          });
          currentY += size + 10;
          totalCreated++;
        }
      });
      
      showToast(`${totalCreated} textos creados (${lines.length} líneas)`);
    } else {
      // Single line mode
      let foundDni = null;
      let textWithoutDni = text;
      
      for (const pattern of dniPatterns) {
        const match = text.match(pattern);
        if (match) {
          foundDni = match[0];
          textWithoutDni = text.replace(pattern, '').replace(/\s+/g, ' ').trim();
          break;
        }
      }
      
      if (foundDni && textWithoutDni) {
        // Create two separate text elements
        editorElements[editorCurrentPage].push({
          type: 'text',
          text: textWithoutDni,
          x: startX,
          y: startY,
          size,
          color
        });
        
        editorElements[editorCurrentPage].push({
          type: 'text',
          text: foundDni,
          x: startX,
          y: startY + size + 3,
          size,
          color,
          name: textWithoutDni  // Store name for tooltip
        });
        
        showToast('Texto separado: Nombre + DNI/NIE');
      } else {
        // Single text element
        editorElements[editorCurrentPage].push({
          type: 'text',
          text,
          x: startX,
          y: startY,
          size,
          color
        });
      }
    }
    
    closeModal();
    renderEditorPage();
  };
}

function addImageToPdf() {
  if (!editorPdfDoc) {
    showToast('Primero carga un PDF');
    return;
  }
  
  // Ensure the elements array for current page exists
  if (!editorElements[editorCurrentPage]) {
    editorElements[editorCurrentPage] = [];
  }
  
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        // Scale image to fit
        let width = img.width;
        let height = img.height;
        const maxSize = 150;
        if (width > maxSize || height > maxSize) {
          const ratio = Math.min(maxSize / width, maxSize / height);
          width *= ratio;
          height *= ratio;
        }
        
        editorElements[editorCurrentPage].push({
          type: 'image',
          src: ev.target.result,
          x: 50,
          y: 50,
          width,
          height
        });
        renderEditorPage();
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

async function addSignatureToPdf() {
  if (!editorPdfDoc) {
    showToast('Primero carga un PDF');
    return;
  }
  
  // Ensure the elements array for current page exists
  if (!editorElements[editorCurrentPage]) {
    editorElements[editorCurrentPage] = [];
  }
  
  // Open signature search modal
  $('signaturesModal').classList.add('show');
  resetSignatureState();
  
  // Override the download function temporarily
  window.selectSignatureForEditor = (url, name) => {
    const img = new Image();
    img.onload = () => {
      let width = img.width;
      let height = img.height;
      const maxSize = 120;
      if (width > maxSize || height > maxSize) {
        const ratio = Math.min(maxSize / width, maxSize / height);
        width *= ratio;
        height *= ratio;
      }
      
      // Ensure the page array exists
      if (!editorElements[editorCurrentPage]) {
        editorElements[editorCurrentPage] = [];
      }
      
      editorElements[editorCurrentPage].push({
        type: 'signature',
        src: url,
        x: 50,
        y: 50,
        width,
        height,
        name
      });
      
      $('signaturesModal').classList.remove('show');
      renderEditorPage();
      showToast('Firma añadida');
    };
    img.src = url;
  };
}

function openFullPdfEditor() {
  // Open the full-screen PDF editor in a new tab
  chrome.tabs.create({
    url: chrome.runtime.getURL('pdf-editor-full.html')
  });
}

function clearPdfEditor() {
  if (!editorPdfDoc) return;
  
  if (confirm('¿Eliminar todos los elementos añadidos?')) {
    for (let i = 1; i <= editorTotalPages; i++) {
      editorElements[i] = [];
    }
    renderEditorPage();
  }
}

function navigateEditorPage(delta) {
  const newPage = editorCurrentPage + delta;
  if (newPage >= 1 && newPage <= editorTotalPages) {
    editorCurrentPage = newPage;
    renderEditorPage();
  }
}

async function saveEditedPdf() {
  if (!editorPdfDoc) return;
  
  const btn = $('btnSavePdf');
  btn.disabled = true;
  btn.querySelector('.btn-text').textContent = 'Guardando...';
  btn.querySelector('.btn-loader').style.display = 'inline-block';
  
  try {
    // Get PDFLib from window
    const pdfLib = window.PDFLib;
    const { PDFDocument, rgb, StandardFonts } = pdfLib;
    
    // Load fonts
    const helveticaFont = await editorPdfDoc.embedFont(StandardFonts.Helvetica);
    
    // Process each page
    for (let pageNum = 1; pageNum <= editorTotalPages; pageNum++) {
      const page = editorPdfDoc.getPage(pageNum - 1);
      const { width, height } = page.getSize();
      const elements = editorElements[pageNum] || [];
      
      for (const el of elements) {
        // Convert from display coordinates to PDF coordinates
        const pdfX = el.x;
        const pdfY = height - el.y - (el.size || 20); // PDF Y is from bottom
        
        if (el.type === 'text') {
          // Draw text
          const color = hexToRgb(el.color || '#000000');
          page.drawText(el.text, {
            x: pdfX,
            y: pdfY,
            size: el.size || 14,
            font: helveticaFont,
            color: rgb(color.r / 255, color.g / 255, color.b / 255)
          });
        } else if (el.type === 'image' || el.type === 'signature') {
          // Embed image
          try {
            const imageBytes = await fetch(el.src).then(r => r.arrayBuffer());
            let image;
            
            if (el.src.includes('image/png')) {
              image = await editorPdfDoc.embedPng(imageBytes);
            } else {
              image = await editorPdfDoc.embedJpg(imageBytes);
            }
            
            page.drawImage(image, {
              x: pdfX,
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
    
    // Save and download
    const pdfBytes = await editorPdfDoc.save();
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'documento-editado.pdf';
    a.click();
    URL.revokeObjectURL(url);
    
    showToast('✅ PDF guardado correctamente');
    
    // Reset editor
    editorPdfDoc = await PDFDocument.load(editorPdfBytes);
    for (let i = 1; i <= editorTotalPages; i++) {
      editorElements[i] = [];
    }
    renderEditorPage();
    
  } catch (err) {
    console.error('Save error:', err);
    showToast('Error al guardar: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.querySelector('.btn-text').textContent = 'Guardar PDF →';
    btn.querySelector('.btn-loader').style.display = 'none';
  }
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
// SIGNATURES MANAGER
// ============================================

// Signature state
let signatureSearchTerm = '';
let signatureFile = null;
let signaturePreviewUrl = null;

// Setup signature listeners
function setupSignatureListeners() {
  // Open signatures modal - fullscreen in sidepanel
  $('btnSignatures').addEventListener('click', () => {
    // Show modal in fullscreen mode
    $('signaturesModal').classList.add('show', 'fullscreen');
    
    // Hide header, calendar and days list
    document.querySelector('.header').style.display = 'none';
    document.querySelector('.days-section').style.display = 'none';
    document.querySelector('.mini-calendar').style.display = 'none';
    
    $('signatureSearchInput').focus();
    // Reset state
    resetSignatureState();
  });

  // Close signatures modal
  $('closeSignaturesModal').addEventListener('click', closeSignaturesModal);
  
  // Close on click outside
  $('signaturesModal').addEventListener('click', (e) => {
    if (e.target === $('signaturesModal')) closeSignaturesModal();
  });

  // Search button
  $('btnSearchSignature').addEventListener('click', searchSignatures);

  // View all signatures button
  $('btnViewAllSignatures').addEventListener('click', loadAllSignatures);

  // Preview all signatures button
  $('btnPreviewSignatures').addEventListener('click', previewAllSignatures);

  // Dropzone click
  $('signatureDropzone').addEventListener('click', () => {
    $('signatureFileInput').click();
  });

  // File input change
  $('signatureFileInput').addEventListener('change', handleSignatureFileSelect);

  // Drag and drop
  $('signatureDropzone').addEventListener('dragover', (e) => {
    e.preventDefault();
    $('signatureDropzone').classList.add('drag-over');
  });

  $('signatureDropzone').addEventListener('dragleave', () => {
    $('signatureDropzone').classList.remove('drag-over');
  });

  $('signatureDropzone').addEventListener('drop', (e) => {
    e.preventDefault();
    $('signatureDropzone').classList.remove('drag-over');
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleSignatureFile(files[0]);
    }
  });

  // Clear signature preview
  $('btnClearSignature').addEventListener('click', () => {
    clearSignaturePreview();
  });

  // Upload signature
  $('btnUploadSignature').addEventListener('click', uploadSignature);

  // Bulk upload toggle
  $('btnToggleBulk').addEventListener('click', () => {
    const content = $('signaturesBulkContent');
    const isVisible = content.style.display !== 'none';
    content.style.display = isVisible ? 'none' : 'block';
  });

  // Bulk dropzone click
  $('bulkDropzone').addEventListener('click', () => {
    $('bulkFileInput').click();
  });

  // Bulk file input change
  $('bulkFileInput').addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleBulkUpload(e.target.files);
    }
  });

  // Bulk drag and drop
  $('bulkDropzone').addEventListener('dragover', (e) => {
    e.preventDefault();
    $('bulkDropzone').classList.add('drag-over');
  });

  $('bulkDropzone').addEventListener('dragleave', () => {
    $('bulkDropzone').classList.remove('drag-over');
  });

  $('bulkDropzone').addEventListener('drop', (e) => {
    e.preventDefault();
    $('bulkDropzone').classList.remove('drag-over');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleBulkUpload(e.dataTransfer.files);
    }
  });
}

function closeSignaturesModal() {
  $('signaturesModal').classList.remove('show', 'fullscreen');
  
  // Restore header, calendar and days list
  document.querySelector('.header').style.display = '';
  document.querySelector('.days-section').style.display = '';
  const miniCal = document.querySelector('.mini-calendar');
  if (miniCal) {
    miniCal.style.display = '';
  }
  
  resetSignatureState();
}

function resetSignatureState() {
  signatureSearchTerm = '';
  signatureFile = null;
  signaturePreviewUrl = null;
  $('signatureSearchInput').value = '';
  $('signaturesResults').innerHTML = `
    <div class="signatures-empty">
      <div class="signatures-empty-icon">🔍</div>
      <div class="signatures-empty-text">Pega nombres y pulsa buscar</div>
    </div>
  `;
  $('signaturesUploadSection').style.display = 'none';
  $('signaturePreviewArea').style.display = 'none';
  $('newSignatureName').value = '';
}

// Helper function to remove DNI/NIE from a string
// DNI format: 8 digits + 1 letter (e.g., 12345678A)
// NIE format: X/Y/Z + 7 digits + 1 letter (e.g., X1234567A)
function removeDniNie(text) {
  // Remove DNI pattern: 8 digits followed by a letter
  // Remove NIE pattern: X, Y, or Z followed by 7 digits and a letter
  return text
    .replace(/\s*\d{8}[A-Za-z]\s*/gi, ' ')  // DNI: 8 digits + letter
    .replace(/\s*[XYZ]\d{7}[A-Za-z]\s*/gi, ' ')  // NIE: X/Y/Z + 7 digits + letter
    .replace(/\s+/g, ' ')  // Normalize multiple spaces to single space
    .trim();
}

// Search signatures in Supabase (one name per line - commas are part of the name)
async function searchSignatures() {
  const searchInput = $('signatureSearchInput').value.trim();

  if (!searchInput) {
    showToast('Introduce un nombre para buscar');
    return;
  }

  // Split ONLY by newlines (Enter) - commas can be part of the name!
  // Example: "GARCIA, JUAN" is ONE complete name, not two names
  // Also remove DNI/NIE from each term automatically
  const searchTerms = searchInput.split('\n')
    .map(term => removeDniNie(term.trim()))
    .filter(term => term.length > 0);

  if (searchTerms.length === 0) {
    showToast('Introduce un nombre para buscar');
    return;
  }

  signatureSearchTerm = searchInput;

  // Show loading
  $('signaturesResults').innerHTML = '<div class="signatures-loading"></div>';

  try {
    let allSignatures = [];
    const foundNames = [];

    // Search for each term
    for (const term of searchTerms) {
      // Query signatures table - search for exact or partial match
      const query = `?select=*&name=ilike.*${encodeURIComponent(term)}*&order=name.asc`;
      const url = `${SUPABASE_URL}/rest/v1/signatures${query}`;

      const res = await fetch(url, {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${session.access_token}`
        }
      });

      if (res.ok) {
        const signatures = await res.json();
        if (signatures && signatures.length > 0) {
          // Add to results, avoiding duplicates by id
          signatures.forEach(sig => {
            if (!allSignatures.find(s => s.id === sig.id)) {
              allSignatures.push(sig);
              // Store in uppercase for comparison
              foundNames.push(sig.name.toUpperCase());
            }
          });
        }
      }
    }

    // Sort alphabetically by name
    allSignatures.sort((a, b) => a.name.localeCompare(b.name));

    // Render with missing names highlighted in red
    renderSignatureResultsWithMissing(allSignatures, searchTerms, foundNames);

  } catch (err) {
    console.error('Search error:', err);
    // Show upload section on error (table might not exist)
    showSignaturesUploadSection(searchTerms.join(', '));
  }
}

// Render signatures with missing names in red (for sidepanel)
function renderSignatureResultsWithMissing(signatures, searchedTerms, foundNames) {
  // Determine which searched terms were NOT found
  const normalizedFoundNames = foundNames.map(n => n.toUpperCase());
  const missingNames = searchedTerms.filter(term => {
    // Normalize term to uppercase for comparison
    const normalizedTerm = term.toUpperCase();
    // Check if term matches any found name (partial match)
    return !normalizedFoundNames.some(found => found.includes(normalizedTerm) || normalizedTerm.includes(found));
  });
  
  let html = '';
  
  // Show found signatures
  if (signatures.length > 0) {
    html += `<div class="signature-found-header">✓ Encontradas (${signatures.length})</div>`;
    signatures.forEach(sig => {
      // Display name in uppercase
      const displayName = sig.name.toUpperCase();
      html += `
        <div class="signature-result-item signature-found" data-id="${sig.id}" data-url="${sig.image_url}" data-name="${esc(displayName)}" title="Clic para ${window.selectSignatureForEditor ? 'seleccionar' : 'descargar'}">
          <span class="signature-result-name">${esc(displayName)}</span>
          <div class="signature-actions">
            <button class="signature-delete-btn" data-id="${sig.id}" data-name="${esc(displayName)}" title="Eliminar firma">🗑️</button>
            <svg class="signature-download-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
          </div>
        </div>
      `;
    });
  }
  
  // Show missing names in red with upload option
  if (missingNames.length > 0) {
    html += `<div class="signature-missing-header">⚠ No encontradas (${missingNames.length})</div>`;
    missingNames.forEach(name => {
      // Display in uppercase
      const displayName = name.toUpperCase();
      html += `
        <div class="signature-result-item signature-missing">
          <span class="signature-missing-name">${esc(displayName)}</span>
          <button class="signature-upload-btn-sidepanel" data-name="${esc(displayName)}">📤 Subir</button>
        </div>
      `;
    });
  }
  
  // If nothing found at all
  if (signatures.length === 0 && missingNames.length === 0) {
    showSignaturesUploadSection(searchedTerms.join(', '));
    return;
  }
  
  $('signaturesResults').innerHTML = html;
  $('signaturesUploadSection').style.display = 'none';

  // Add click handlers for found signatures
  document.querySelectorAll('.signature-result-item.signature-found').forEach(item => {
    item.addEventListener('click', (e) => {
      // Don't trigger if clicking delete button
      if (e.target.classList.contains('signature-delete-btn')) return;
      
      if (window.selectSignatureForEditor) {
        // Called from PDF editor
        window.selectSignatureForEditor(item.dataset.url, item.dataset.name);
      } else {
        // Normal download
        downloadSignature(item.dataset.url, item.dataset.name);
      }
    });
  });
  
  // Add click handlers for delete buttons
  document.querySelectorAll('.signature-delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm('¿Eliminar la firma de "' + btn.dataset.name + '"?')) {
        deleteSignatureFromSidepanel(btn.dataset.id, btn.dataset.name);
      }
    });
  });
  
  // Add click handlers for missing signatures upload button
  document.querySelectorAll('.signature-upload-btn-sidepanel').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      quickUploadMissingSignature(btn.dataset.name);
    });
  });
}

// Delete a signature from sidepanel
async function deleteSignatureFromSidepanel(id, name) {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/signatures?id=eq.${id}`, {
      method: 'DELETE',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${session.access_token}`
      }
    });
    
    if (!response.ok) {
      const errText = await response.text();
      console.error('Delete error:', errText);
      throw new Error('Error al eliminar: ' + response.status);
    }
    
    showToast('✓ Firma eliminada: ' + name);
    
    // Re-run search to update results
    searchSignatures();
    
  } catch (err) {
    console.error('Delete error:', err);
    showToast('Error: ' + err.message);
  }
}

// Quick upload a missing signature from sidepanel
async function quickUploadMissingSignature(name) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    showToast('Subiendo firma de ' + name + '...');
    
    try {
      // Convert to base64
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      
      // Upload to Supabase
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
      const response = await fetch(`${SUPABASE_URL}/rest/v1/signatures`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({
          id,
          name: name.toUpperCase(),
          image_url: base64,
          user_id: currentUser.id,
          user_name: currentUser.name
        })
      });
      
      if (!response.ok) {
        const errText = await response.text();
        console.error('Upload error:', errText);
        throw new Error('Error al subir firma');
      }
      
      showToast('✓ Firma subida: ' + name);
      
      // Re-run search to update results
      searchSignatures();
      
    } catch (err) {
      console.error('Upload error:', err);
      showToast('Error: ' + err.message);
    }
  };
  
  input.click();
}

function renderSignatureResults(signatures, isAlphabetical = false) {
  let html = '';
  let currentLetter = '';
  
  signatures.forEach(sig => {
    // Display name in uppercase
    const displayName = sig.name.toUpperCase();
    
    // Add letter separator for alphabetical view
    if (isAlphabetical) {
      const firstLetter = displayName.charAt(0);
      if (firstLetter !== currentLetter) {
        currentLetter = firstLetter;
        html += `<div class="signature-letter-sep">${currentLetter}</div>`;
      }
    }
    
    // Simple item: just name, clickable to download or select for editor
    html += `
      <div class="signature-result-item" data-id="${sig.id}" data-url="${sig.image_url}" data-name="${esc(displayName)}" title="Clic para ${window.selectSignatureForEditor ? 'seleccionar' : 'descargar'}">
        <span class="signature-result-name">${esc(displayName)}</span>
        <svg class="signature-download-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="7 10 12 15 17 10"></polyline>
          <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
      </div>
    `;
  });

  $('signaturesResults').innerHTML = html;
  $('signaturesUploadSection').style.display = 'none';

  // Add click handlers - click anywhere on item to download or select for editor
  document.querySelectorAll('.signature-result-item').forEach(item => {
    item.addEventListener('click', () => {
      if (window.selectSignatureForEditor) {
        // Called from PDF editor
        window.selectSignatureForEditor(item.dataset.url, item.dataset.name);
      } else {
        // Normal download
        downloadSignature(item.dataset.url, item.dataset.name);
      }
    });
  });
}

// Load all signatures sorted alphabetically
async function loadAllSignatures() {
  // Show loading
  $('signaturesResults').innerHTML = '<div class="signatures-loading"></div>';

  try {
    // Query all signatures ordered by name
    const query = `?select=*&order=name.asc`;
    const url = `${SUPABASE_URL}/rest/v1/signatures${query}`;
    
    const res = await fetch(url, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${session.access_token}`
      }
    });

    if (!res.ok) {
      if (res.status === 404) {
        $('signaturesResults').innerHTML = `
          <div class="signatures-empty">
            <div class="signatures-empty-icon">📭</div>
            <div class="signatures-empty-text">No hay firmas guardadas</div>
          </div>
        `;
        $('signaturesUploadSection').style.display = 'block';
        return;
      }
      throw new Error('Error al cargar firmas');
    }

    const signatures = await res.json();

    if (signatures && signatures.length > 0) {
      renderSignatureResults(signatures, true); // true = alphabetical view with separators
    } else {
      $('signaturesResults').innerHTML = `
        <div class="signatures-empty">
          <div class="signatures-empty-icon">📭</div>
          <div class="signatures-empty-text">No hay firmas guardadas</div>
        </div>
      `;
      $('signaturesUploadSection').style.display = 'block';
    }

  } catch (err) {
    console.error('Load all error:', err);
    $('signaturesResults').innerHTML = `
      <div class="signatures-empty">
        <div class="signatures-empty-icon">⚠️</div>
        <div class="signatures-empty-text">Error al cargar firmas</div>
      </div>
    `;
    $('signaturesUploadSection').style.display = 'block';
  }
}

// Preview all signatures with images in a grid
async function previewAllSignatures() {
  // Show loading
  $('signaturesResults').innerHTML = '<div class="signatures-loading"></div>';
  $('signaturesUploadSection').style.display = 'none';

  try {
    // Query all signatures ordered by name
    const query = `?select=*&order=name.asc`;
    const url = `${SUPABASE_URL}/rest/v1/signatures${query}`;

    const res = await fetch(url, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${session.access_token}`
      }
    });

    if (!res.ok) {
      if (res.status === 404) {
        $('signaturesResults').innerHTML = `
          <div class="signatures-empty">
            <div class="signatures-empty-icon">📭</div>
            <div class="signatures-empty-text">No hay firmas guardadas</div>
          </div>
        `;
        return;
      }
      throw new Error('Error al cargar firmas');
    }

    const signatures = await res.json();

    if (!signatures || signatures.length === 0) {
      $('signaturesResults').innerHTML = `
        <div class="signatures-empty">
          <div class="signatures-empty-icon">📭</div>
          <div class="signatures-empty-text">No hay firmas guardadas</div>
        </div>
      `;
      return;
    }

    // Render signatures in preview grid
    let html = `
      <div class="signatures-preview-header">
        <span>📷 Vista previa de firmas (${signatures.length})</span>
        <button class="btn-close-preview" id="btnClosePreview" title="Cerrar vista previa">✕</button>
      </div>
      <div class="signatures-preview-grid">
    `;

    signatures.forEach(sig => {
      const displayName = sig.name || 'Sin nombre';
      html += `
        <div class="signature-preview-card" data-id="${sig.id}" data-name="${esc(displayName)}">
          <div class="signature-preview-image-container">
            <img src="${sig.image_url}" alt="${esc(displayName)}" class="signature-preview-image" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 50%22><text x=%2250%%22 y=%2250%%22 text-anchor=%22middle%22 fill=%22%23999%22>Sin imagen</text></svg>'">
          </div>
          <div class="signature-preview-name">${esc(displayName)}</div>
          <button class="signature-preview-delete" data-id="${sig.id}" data-name="${esc(displayName)}" title="Eliminar firma">🗑️</button>
        </div>
      `;
    });

    html += '</div>';
    $('signaturesResults').innerHTML = html;

    // Add click handler for close button
    $('btnClosePreview').addEventListener('click', () => {
      $('signaturesResults').innerHTML = `
        <div class="signatures-empty">
          <div class="signatures-empty-icon">🔍</div>
          <div class="signatures-empty-text">Busca una firma o pulsa el botón de lista</div>
        </div>
      `;
    });

    // Add click handlers for delete buttons
    document.querySelectorAll('.signature-preview-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const name = btn.dataset.name;
        if (confirm(`¿Eliminar la firma de "${name}"?`)) {
          try {
            await deleteSignatureFromPreview(id, name);
            // Remove the card from DOM
            const card = btn.closest('.signature-preview-card');
            if (card) {
              card.style.opacity = '0';
              card.style.transform = 'scale(0.8)';
              setTimeout(() => {
                card.remove();
                // Update count
                const header = document.querySelector('.signatures-preview-header span');
                if (header) {
                  const remaining = document.querySelectorAll('.signature-preview-card').length;
                  header.textContent = `📷 Vista previa de firmas (${remaining})`;
                }
              }, 300);
            }
          } catch (err) {
            showToast('Error al eliminar: ' + err.message);
          }
        }
      });
    });

  } catch (err) {
    console.error('Preview error:', err);
    $('signaturesResults').innerHTML = `
      <div class="signatures-empty">
        <div class="signatures-empty-icon">⚠️</div>
        <div class="signatures-empty-text">Error al cargar firmas</div>
      </div>
    `;
  }
}

// Delete signature from preview mode
async function deleteSignatureFromPreview(id, name) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/signatures?id=eq.${id}`, {
    method: 'DELETE',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${session.access_token}`,
      'Prefer': 'return=minimal'
    }
  });

  if (!response.ok) {
    throw new Error('Error al eliminar');
  }

  showToast(`Firma de "${name}" eliminada`);
}

function showSignaturesUploadSection(searchTerm) {
  $('signaturesResults').innerHTML = `
    <div class="signatures-empty">
      <div class="signatures-empty-icon">😕</div>
      <div class="signatures-empty-text">No se encontró "${esc(searchTerm)}"</div>
    </div>
  `;
  $('signaturesUploadSection').style.display = 'block';
  $('newSignatureName').value = searchTerm;
  $('signaturePreviewArea').style.display = 'none';
  signatureFile = null;
  signaturePreviewUrl = null;
}

function handleSignatureFileSelect(e) {
  const file = e.target.files[0];
  if (file) handleSignatureFile(file);
}

function handleSignatureFile(file) {
  // Check if file is an image (handle undefined type)
  const fileType = file.type || '';
  const fileName = file.name || '';
  const isImage = fileType.startsWith('image/') || 
                  /\.(png|jpg|jpeg|gif|webp|bmp)$/i.test(fileName);
  
  if (!isImage) {
    showToast('Por favor, selecciona una imagen');
    return;
  }

  signatureFile = file;

  // Create preview
  const reader = new FileReader();
  reader.onload = (e) => {
    signaturePreviewUrl = e.target.result;
    $('signaturePreviewImg').src = signaturePreviewUrl;
    $('signaturePreviewArea').style.display = 'block';
    $('signatureDropzone').style.display = 'none';
  };
  reader.readAsDataURL(file);
}

function clearSignaturePreview() {
  signatureFile = null;
  signaturePreviewUrl = null;
  $('signaturePreviewArea').style.display = 'none';
  $('signatureDropzone').style.display = 'block';
  $('signatureFileInput').value = '';
}

// Upload signature to Supabase
async function uploadSignature() {
  if (!signatureFile) {
    showToast('Selecciona una imagen de firma');
    return;
  }

  const name = $('newSignatureName').value.trim();
  if (!name) {
    showToast('Introduce un nombre para la firma');
    return;
  }

  const btn = $('btnUploadSignature');
  btn.disabled = true;
  btn.querySelector('.btn-text').textContent = 'Subiendo...';
  btn.querySelector('.btn-loader').style.display = 'inline-block';

  try {
    // Convert image to base64
    const base64Image = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(signatureFile);
    });

    console.log('Subiendo firma:', name);
    console.log('User ID:', currentUser?.id);

    // Insert into signatures table
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
    
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/signatures`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        id,
        name: name.toUpperCase(),
        image_url: base64Image,
        user_id: currentUser.id,
        user_name: currentUser.name
      })
    });

    console.log('Response status:', insertRes.status);
    
    if (!insertRes.ok) {
      const errText = await insertRes.text();
      console.error('Insert error:', errText);
      
      if (insertRes.status === 404) {
        throw new Error('La tabla "signatures" no existe. Ejecuta el SQL en Supabase.');
      }
      if (errText.includes('permission denied') || errText.includes('policy')) {
        throw new Error('Error de permisos. Verifica las políticas RLS en Supabase.');
      }
      throw new Error('Error al guardar: ' + errText);
    }

    const result = await insertRes.json();
    console.log('Firma guardada:', result);

    showToast('✅ Firma guardada correctamente');
    
    // Reset and close
    resetSignatureState();
    closeSignaturesModal();

  } catch (err) {
    console.error('Upload error:', err);
    showToast('Error: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.querySelector('.btn-text').textContent = 'Guardar Firma';
    btn.querySelector('.btn-loader').style.display = 'none';
  }
}

// Download signature
async function downloadSignature(url, name) {
  try {
    showToast('Descargando firma...');
    
    const res = await fetch(url);
    const blob = await res.blob();
    
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `firma-${name.replace(/\s+/g, '-')}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(downloadUrl);
    
    showToast('✅ Firma descargada');
  } catch (err) {
    console.error('Download error:', err);
    showToast('Error al descargar la firma');
  }
}

// Delete signature
async function deleteSignature(id) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/signatures?id=eq.${id}`, {
      method: 'DELETE',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${session.access_token}`,
        'Prefer': 'return=representation'
      }
    });

    if (!res.ok) throw new Error('Error al eliminar');

    showToast('Firma eliminada');
    searchSignatures();
  } catch (err) {
    console.error('Delete error:', err);
    showToast('Error al eliminar la firma');
  }
}

// ============================================
// BULK UPLOAD SIGNATURES
// ============================================

async function handleBulkUpload(files) {
  if (!session || !currentUser) {
    showToast('Debes iniciar sesión para subir firmas');
    return;
  }

  const totalFiles = files.length;
  if (totalFiles === 0) return;

  // Extract file names (uppercase, without extension)
  const fileData = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const fileName = file.name.replace(/\.[^/.]+$/, '').toUpperCase().trim();
    fileData.push({ file, fileName, base64: null });
  }

  // Check for existing signatures with same names
  showToast('Verificando firmas existentes...');
  
  const existingSignatures = await checkExistingSignatures(fileData.map(f => f.fileName));
  
  // If there are duplicates, ask user what to do
  let actionForDuplicates = 'ask'; // 'ask', 'replace', 'keep', 'skip'
  const duplicates = fileData.filter(f => existingSignatures[f.fileName]);
  
  if (duplicates.length > 0) {
    actionForDuplicates = await askDuplicateAction(duplicates, existingSignatures);
    if (actionForDuplicates === 'cancel') {
      showToast('Carga cancelada');
      return;
    }
  }

  // Show progress UI
  $('bulkProgress').style.display = 'block';
  $('bulkResults').style.display = 'block';
  $('bulkResults').innerHTML = '';
  $('bulkProgressFill').style.width = '0%';
  $('bulkProgressText').textContent = `0 / ${totalFiles}`;

  let successCount = 0;
  let errorCount = 0;
  let skippedCount = 0;
  let replacedCount = 0;

  for (let i = 0; i < fileData.length; i++) {
    const { file, fileName } = fileData[i];
    const existing = existingSignatures[fileName];
    
    // Update progress
    const progress = ((i + 1) / totalFiles) * 100;
    $('bulkProgressFill').style.width = `${progress}%`;
    $('bulkProgressText').textContent = `${i + 1} / ${totalFiles}`;

    // Handle duplicates based on user choice
    if (existing) {
      if (actionForDuplicates === 'skip') {
        skippedCount++;
        $('bulkResults').innerHTML += `
          <div class="bulk-result-item skipped">
            <span class="bulk-result-icon">⊘</span>
            <span class="bulk-result-name">${esc(fileName)} (ya existe)</span>
          </div>
        `;
        continue;
      } else if (actionForDuplicates === 'keep') {
        skippedCount++;
        $('bulkResults').innerHTML += `
          <div class="bulk-result-item skipped">
            <span class="bulk-result-icon">→</span>
            <span class="bulk-result-name">${esc(fileName)} (mantenida)</span>
          </div>
        `;
        continue;
      } else if (actionForDuplicates === 'replace') {
        // Will replace - delete old first
        try {
          await fetch(`${SUPABASE_URL}/rest/v1/signatures?id=eq.${existing.id}`, {
            method: 'DELETE',
            headers: {
              'apikey': SUPABASE_KEY,
              'Authorization': `Bearer ${session.access_token}`
            }
          });
        } catch (err) {
          console.error('Error deleting old signature:', err);
        }
      }
    }

    try {
      // Convert to base64
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      // Generate unique ID
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2);

      // Upload to Supabase
      const response = await fetch(`${SUPABASE_URL}/rest/v1/signatures`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({
          id,
          name: fileName.toUpperCase(),
          image_url: base64,
          user_id: currentUser.id,
          user_name: currentUser.name
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error('Upload error for', fileName, ':', errText);
        throw new Error('Error al subir');
      }

      successCount++;
      if (existing && actionForDuplicates === 'replace') {
        replacedCount++;
      }
      
      // Add to results display
      $('bulkResults').innerHTML += `
        <div class="bulk-result-item success">
          <span class="bulk-result-icon">✓</span>
          <span class="bulk-result-name">${esc(fileName)}${existing && actionForDuplicates === 'replace' ? ' (reemplazada)' : ''}</span>
        </div>
      `;

    } catch (err) {
      errorCount++;
      
      // Add to results display
      $('bulkResults').innerHTML += `
        <div class="bulk-result-item error">
          <span class="bulk-result-icon">✗</span>
          <span class="bulk-result-name">${esc(fileName)}</span>
        </div>
      `;
    }

    // Small delay to avoid rate limiting
    if (i < fileData.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  // Final summary
  let summaryMsg = `✓ ${successCount} subidas`;
  if (replacedCount > 0) summaryMsg += `, ${replacedCount} reemplazadas`;
  if (skippedCount > 0) summaryMsg += `, ${skippedCount} omitidas`;
  if (errorCount > 0) summaryMsg += `, ${errorCount} errores`;
  
  showToast(summaryMsg);
  $('bulkProgressText').textContent = summaryMsg;

  // Clear file input for next batch
  $('bulkFileInput').value = '';
}

// Check if signatures with given names already exist
async function checkExistingSignatures(names) {
  const existing = {};
  
  if (!session) return existing;
  
  try {
    // Query all signatures to check for duplicates (case-insensitive)
    const response = await fetch(`${SUPABASE_URL}/rest/v1/signatures?select=id,name`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${session.access_token}`
      }
    });
    
    if (response.ok) {
      const allSigs = await response.json();
      
      // Create a map of uppercase names to signature info
      allSigs.forEach(sig => {
        const upperName = sig.name.toUpperCase();
        existing[upperName] = sig;
      });
    }
  } catch (err) {
    console.error('Error checking existing signatures:', err);
  }
  
  return existing;
}

// Show dialog asking what to do with duplicates
async function askDuplicateAction(duplicates, existingSignatures) {
  return new Promise((resolve) => {
    // Create modal HTML
    const modalHtml = `
      <div class="bulk-duplicate-modal" id="duplicateModal">
        <div class="bulk-duplicate-content">
          <div class="bulk-duplicate-header">
            <h3>⚠️ Firmas duplicadas encontradas</h3>
          </div>
          <div class="bulk-duplicate-body">
            <p>Se encontraron <strong>${duplicates.length}</strong> firma(s) que ya existen:</p>
            <div class="bulk-duplicate-list">
              ${duplicates.slice(0, 5).map(d => `
                <div class="bulk-duplicate-item">
                  <span class="bulk-duplicate-name">${esc(d.fileName)}</span>
                  <span class="bulk-duplicate-status">ya existe</span>
                </div>
              `).join('')}
              ${duplicates.length > 5 ? `<div class="bulk-duplicate-more">...y ${duplicates.length - 5} más</div>` : ''}
            </div>
            <p class="bulk-duplicate-question">¿Qué deseas hacer con los duplicados?</p>
          </div>
          <div class="bulk-duplicate-actions">
            <button class="bulk-duplicate-btn replace" data-action="replace">
              🔄 Reemplazar todas
            </button>
            <button class="bulk-duplicate-btn keep" data-action="keep">
              ✓ Mantener existentes
            </button>
            <button class="bulk-duplicate-btn skip" data-action="skip">
              ⊘ Saltar duplicados
            </button>
            <button class="bulk-duplicate-btn cancel" data-action="cancel">
              ✕ Cancelar todo
            </button>
          </div>
        </div>
      </div>
    `;
    
    // Add modal to page
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    const modal = document.getElementById('duplicateModal');
    
    // Handle button clicks
    modal.querySelectorAll('.bulk-duplicate-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        modal.remove();
        resolve(action);
      });
    });
  });
}
