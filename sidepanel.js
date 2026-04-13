// ============================================
// AGENDA STAFF v5.17.5 - MULTI-WORD TO PDF
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
let wordFiles = [];

// PDF Editor state
let editorPdfBytes = null;
let editorPdfDoc = null;
let editorCurrentPage = 1;
let editorTotalPages = 0;
let editorElements = {}; // Elements per page: { pageNum: [elements] }
let editorScale = 1;
let editorCanvas = null;
let selectedElement = null;

// Processes state
let processes = [];
let processMonthFilter = 'all';
let processDelegationFilter = 'all';
let processTabFilter = 'active'; // 'active' or 'finalized'
let processPositionFilter = 'all';
let processCompactView = false;
let collapsedProcesses = new Set(); // IDs of individually collapsed processes

const DELEGATIONS = {
  'Madrid': ['Madrid'],
  'Valencia': ['Alicante', 'Castellón', 'Valencia'],
  'Barcelona': ['Barcelona', 'Girona', 'Lleida', 'Tarragona'],
  'Sevilla': ['Almería', 'Cádiz', 'Córdoba', 'Granada', 'Huelva', 'Jaén', 'Málaga', 'Sevilla'],
  'Nacional': [] // All other provinces
};

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
  console.log('AGENDA STAFF v5.10.0 iniciado...');
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
  
  // Processes Manager
  setupProcessesListeners();
  
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
  
  // Tab switching
  document.querySelectorAll('.pdf-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.pdf-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.pdf-tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const tabId = tab.dataset.tab + 'Tab';
      $(tabId).classList.add('active');
    });
  });
  
  // Tab 1: Image to PDF
  $('pdfDropzone').addEventListener('click', () => $('pdfFileInput').click());
  $('pdfFileInput').addEventListener('change', handlePdfFileSelect);
  $('pdfDropzone').addEventListener('dragover', handlePdfDragOver);
  $('pdfDropzone').addEventListener('dragleave', handlePdfDragLeave);
  $('pdfDropzone').addEventListener('drop', handlePdfDrop);
  $('pdfClearBtn').addEventListener('click', clearPdfFiles);
  $('btnPortrait').addEventListener('click', () => selectOrientation('portrait'));
  $('btnLandscape').addEventListener('click', () => selectOrientation('landscape'));
  $('btnConvertPdf').addEventListener('click', convertToPdf);
  
  // Tab 2: Word to PDF
  $('wordDropzone').addEventListener('click', () => $('wordFileInput').click());
  $('wordFileInput').addEventListener('change', handleWordFileSelect);
  $('wordDropzone').addEventListener('dragover', handleWordDragOver);
  $('wordDropzone').addEventListener('dragleave', handleWordDragLeave);
  $('wordDropzone').addEventListener('drop', handleWordDrop);
  $('wordClearBtn').addEventListener('click', clearWordFile);
  $('btnWordToPdf').addEventListener('click', convertWordToPdf);
  
  // Tab 3: PDF Editor
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
  
  // Tab 4: Merge PDFs
  $('mergeDropzone').addEventListener('click', () => $('mergeFileInput').click());
  $('mergeFileInput').addEventListener('change', handleMergeFileSelect);
  $('mergeDropzone').addEventListener('dragover', handleMergeDragOver);
  $('mergeDropzone').addEventListener('dragleave', handleMergeDragLeave);
  $('mergeDropzone').addEventListener('drop', handleMergeDrop);
  $('mergeClearBtn').addEventListener('click', clearMergeFiles);
  $('btnMergePdf').addEventListener('click', mergePdfsAction);
  
  // Tab 5: Split PDF
  $('splitDropzone').addEventListener('click', () => $('splitFileInput').click());
  $('splitFileInput').addEventListener('change', handleSplitFileSelect);
  $('splitDropzone').addEventListener('dragover', handleSplitDragOver);
  $('splitDropzone').addEventListener('dragleave', handleSplitDragLeave);
  $('splitDropzone').addEventListener('drop', handleSplitDrop);
  $('splitClearBtn').addEventListener('click', clearSplitFile);
  $('btnSplitPdf').addEventListener('click', splitPdfAction);
}

function openPdfModal() {
  $('pdfModal').classList.add('show');
}

function closePdfModal() {
  $('pdfModal').classList.remove('show');
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
    
    let clipboardSuccess = false;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ]);
      clipboardSuccess = true;
    } catch (clipErr) {
      console.log('Clipboard no disponible:', clipErr.message);
    }
    
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
    
    showToast(clipboardSuccess ? '✅ Captura copiada y descargada' : '✅ Captura descargada');
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
  const files = Array.from(e.dataTransfer.files).filter(f => {
    const ext = f.name.split('.').pop().toLowerCase();
    return ['docx', 'doc'].includes(ext);
  });
  if (files.length > 0) {
    addWordFiles(files);
  }
}

function handleWordFileSelect(e) {
  const files = Array.from(e.target.files);
  if (files.length > 0) {
    addWordFiles(files);
  }
}

async function addWordFiles(files) {
  for (const file of files) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['docx', 'doc'].includes(ext)) {
      showToast(`${file.name} no es un archivo Word válido`);
      continue;
    }
    
    const arrayBuffer = await file.arrayBuffer();
    wordFiles.push({ name: file.name, data: arrayBuffer });
  }
  renderWordPreview();
}

function renderWordPreview() {
  if (wordFiles.length === 0) {
    $('wordPreviewArea').style.display = 'none';
    $('wordDropzone').style.display = 'flex';
    return;
  }
  
  $('wordPreviewArea').style.display = 'block';
  $('wordDropzone').style.display = 'none';
  $('wordPreviewList').innerHTML = wordFiles.map((file, i) => `
    <div class="pdf-preview-item" data-index="${i}">
      <span class="pdf-icon">📝</span>
      <span class="pdf-preview-name">${file.name}</span>
      <button class="pdf-remove-btn" data-index="${i}">✕</button>
    </div>
  `).join('');
  
  document.querySelectorAll('#wordPreviewList .pdf-remove-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const index = parseInt(e.target.dataset.index);
      wordFiles.splice(index, 1);
      renderWordPreview();
    });
  });
}

function clearWordFile() {
  wordFiles = [];
  $('wordPreviewArea').style.display = 'none';
  $('wordDropzone').style.display = 'flex';
  $('wordFileInput').value = '';
}

async function convertWordToPdf() {
  if (wordFiles.length === 0) {
    showToast('Selecciona al menos un archivo Word');
    return;
  }
  
  const btn = $('btnWordToPdf');
  btn.disabled = true;
  
  const totalFiles = wordFiles.length;
  let successCount = 0;
  let errorCount = 0;
  
  try {
    // Check if mammoth is available
    const mammothLib = window.mammoth;
    if (!mammothLib) {
      throw new Error('La librería mammoth no está cargada. Recarga la extensión.');
    }
    
    // Check if jsPDF is available
    if (typeof window.jspdf === 'undefined') {
      throw new Error('La librería jsPDF no está cargada. Recarga la extensión.');
    }
    
    const { jsPDF } = window.jspdf;
    
    for (let i = 0; i < wordFiles.length; i++) {
      const wordFile = wordFiles[i];
      btn.querySelector('.btn-text').textContent = `Convirtiendo ${i + 1}/${totalFiles}...`;
      
      try {
        // Convert Word to HTML
        const result = await mammothLib.convertToHtml({ arrayBuffer: wordFile.data });
        const html = result.value;
        
        // Create PDF
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
        
        for (let j = 0; j < lines.length; j++) {
          if (y > pageHeight - 20) {
            doc.addPage();
            y = 20;
          }
          doc.text(lines[j], 15, y);
          y += 7;
        }
        
        document.body.removeChild(tempDiv);
        
        // Download PDF
        const fileName = wordFile.name.replace(/\.(docx|doc)$/i, '.pdf');
        doc.save(fileName);
        
        successCount++;
        
        // Small delay between downloads to prevent browser blocking
        if (i < wordFiles.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
        
      } catch (fileErr) {
        console.error(`Error converting ${wordFile.name}:`, fileErr);
        errorCount++;
      }
    }
    
    // Show result
    if (successCount === totalFiles) {
      showToast(`✅ ${successCount} PDFs creados correctamente`);
    } else if (successCount > 0) {
      showToast(`✅ ${successCount} convertidos, ❌ ${errorCount} errores`);
    } else {
      showToast('❌ Error al convertir los archivos');
    }
    
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
    
    // Show UI
    $('pdfEditorUpload').style.display = 'none';
    $('pdfEditorNav').style.display = 'flex';
    $('btnSavePdf').style.display = 'flex';
    
    showToast(`PDF cargado: ${editorTotalPages} páginas`);
    
  } catch (err) {
    console.error('Error loading PDF:', err);
    showToast('Error al cargar el PDF');
  }
}

async function renderEditorPage() {
  if (!editorPdfDoc) return;
  
  const container = $('pdfEditorPages');
  container.innerHTML = '';
  
  // Get page dimensions
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
  if (typeof pdfjsLib !== 'undefined') {
    try {
      const pdfJsDoc = await pdfjsLib.getDocument(editorPdfBytes).promise;
      const pdfJsPage = await pdfJsDoc.getPage(editorCurrentPage);
      const viewport = pdfJsPage.getViewport({ scale: editorScale });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await pdfJsPage.render({ canvasContext: ctx, viewport }).promise;
    } catch (e) {
      console.log('pdf.js render failed, using placeholder');
      drawPlaceholder(ctx, canvas.width, canvas.height);
    }
  } else {
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
  container.appendChild(canvasContainer);
  
  // Update page info
  $('currentPageNum').textContent = editorCurrentPage;
  $('totalPages').textContent = editorTotalPages;
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
    div.textContent = el.text;
    div.style.fontSize = (el.size || 14) * editorScale + 'px';
    div.style.color = el.color || '#000';
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
    editorElements[editorCurrentPage].splice(idx, 1);
    renderEditorPage();
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
    <textarea id="textInputText" placeholder="Escribe el texto..."></textarea>
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
    
    editorElements[editorCurrentPage].push({
      type: 'text',
      text,
      x: 50,
      y: 50,
      size,
      color
    });
    
    closeModal();
    renderEditorPage();
  };
}

function addImageToPdf() {
  if (!editorPdfDoc) {
    showToast('Primero carga un PDF');
    return;
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

// Bulk upload state
let bulkFiles = []; // Array of { file, name (UPPERCASE), base64, status: 'new'|'replace'|'skip', existingId? }

// Setup signature listeners
function setupSignatureListeners() {
  // Open signatures modal
  $('btnSignatures').addEventListener('click', () => {
    $('signaturesModal').classList.add('show');
    $('signatureSearchInput').focus();
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

  // Single upload - Dropzone click
  $('signatureDropzone').addEventListener('click', () => {
    $('signatureFileInput').click();
  });

  // Single upload - File input change
  $('signatureFileInput').addEventListener('change', handleSignatureFileSelect);

  // Single upload - Drag and drop
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
    if (files.length > 0) handleSignatureFile(files[0]);
  });

  // Clear single signature preview
  $('btnClearSignature').addEventListener('click', clearSignaturePreview);

  // Upload single signature
  $('btnUploadSignature').addEventListener('click', uploadSignature);

  // === BULK UPLOAD ===
  // Bulk dropzone click
  $('bulkDropzone').addEventListener('click', () => {
    $('bulkFileInput').click();
  });

  // Bulk file input change
  $('bulkFileInput').addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleBulkFiles(Array.from(e.target.files));
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
    if (e.dataTransfer.files.length > 0) handleBulkFiles(Array.from(e.dataTransfer.files));
  });

  // Bulk upload button
  $('btnBulkUpload').addEventListener('click', executeBulkUpload);
}

function closeSignaturesModal() {
  $('signaturesModal').classList.remove('show');
  // Remove preview overlay if exists
  const overlay = document.querySelector('.sig-preview-overlay');
  if (overlay) overlay.remove();
  resetSignatureState();
}

function resetSignatureState() {
  signatureSearchTerm = '';
  signatureFile = null;
  signaturePreviewUrl = null;
  bulkFiles = [];
  $('signatureSearchInput').value = '';
  $('signaturesResults').innerHTML = `
    <div class="signatures-empty">
      <div class="signatures-empty-icon">🔍</div>
      <div class="signatures-empty-text">Pega nombres y pulsa buscar</div>
    </div>
  `;
  $('signaturesUploadSection').style.display = 'none';
  $('signaturePreviewArea').style.display = 'none';
  $('signatureDropzone').style.display = '';
  $('newSignatureName').value = '';
  $('bulkFileInput').value = '';
  $('bulkList').innerHTML = '';
  $('bulkListContainer').style.display = 'none';
  $('bulkCount').textContent = '';
  $('bulkDropzone').style.display = '';
}

// Search signatures in Supabase (supports multiple names, one per line)
async function searchSignatures() {
  const searchInput = $('signatureSearchInput').value.trim();
  
  if (!searchInput) {
    showToast('Introduce un nombre para buscar');
    return;
  }

  const searchTerms = searchInput.split('\n')
    .map(term => term.trim().toLowerCase())
    .filter(term => term.length > 0);
  
  if (searchTerms.length === 0) {
    showToast('Introduce un nombre para buscar');
    return;
  }

  signatureSearchTerm = searchInput;
  $('signaturesResults').innerHTML = '<div class="signatures-loading"></div>';

  try {
    let allSignatures = [];
    
    for (const term of searchTerms) {
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
          signatures.forEach(sig => {
            if (!allSignatures.find(s => s.id === sig.id)) {
              allSignatures.push(sig);
            }
          });
        }
      }
    }

    if (allSignatures.length > 0) {
      allSignatures.sort((a, b) => a.name.localeCompare(b.name));
      renderSignatureResults(allSignatures);
    } else {
      showSignaturesUploadSection(searchTerms.join(', '));
    }

  } catch (err) {
    console.error('Search error:', err);
    showSignaturesUploadSection(searchTerms.join(', '));
  }
}

// Render signatures with thumbnail, preview, download, delete buttons
function renderSignatureResults(signatures, isAlphabetical = false) {
  let html = '';
  let currentLetter = '';
  
  signatures.forEach(sig => {
    if (isAlphabetical) {
      const firstLetter = sig.name.charAt(0).toUpperCase();
      if (firstLetter !== currentLetter) {
        currentLetter = firstLetter;
        html += `<div class="signature-letter-sep">${currentLetter}</div>`;
      }
    }
    
    const thumbSrc = sig.image_url || '';
    html += `
      <div class="signature-result-item" data-id="${sig.id}" data-url="${esc(sig.image_url)}" data-name="${esc(sig.name)}">
        <img class="signature-result-thumb" src="${thumbSrc}" alt="${esc(sig.name)}" onerror="this.style.display='none'">
        <div class="signature-result-info">
          <span class="signature-result-name">${esc(sig.name)}</span>
          <span class="signature-result-date">${sig.created_at ? new Date(sig.created_at).toLocaleDateString('es-ES') : ''}</span>
        </div>
        <div class="signature-result-actions">
          <button class="btn-download-signature" data-url="${esc(sig.image_url)}" data-name="${esc(sig.name)}" title="Descargar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
          </button>
          <button class="btn-delete-signature" data-id="${sig.id}" data-name="${esc(sig.name)}" title="Eliminar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      </div>
    `;
  });

  $('signaturesResults').innerHTML = html;
  $('signaturesUploadSection').style.display = 'none';

  // Add click handlers
  document.querySelectorAll('.signature-result-item').forEach(item => {
    // Click on item body (not buttons) = preview
    item.addEventListener('click', (e) => {
      if (e.target.closest('.signature-result-actions')) return;
      showSignaturePreview(item.dataset.url, item.dataset.name, item.dataset.id);
    });
  });

  // Download buttons
  document.querySelectorAll('.btn-download-signature').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      downloadSignature(btn.dataset.url, btn.dataset.name);
    });
  });

  // Delete buttons
  document.querySelectorAll('.btn-delete-signature').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`¿Eliminar la firma "${btn.dataset.name}"?`)) {
        deleteSignature(btn.dataset.id);
      }
    });
  });
}

// Show signature in a preview overlay
function showSignaturePreview(url, name, id) {
  // Remove existing overlay if any
  const existing = document.querySelector('.sig-preview-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'sig-preview-overlay';
  overlay.innerHTML = `
    <div class="sig-preview-card">
      <img src="${url}" alt="${esc(name)}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%2240%22><text y=%2225%22 font-size=%2214%22 fill=%22%23999%22>Error</text></svg>'">
      <div class="sig-preview-name">${esc(name)}</div>
      <div class="sig-preview-actions">
        ${window.selectSignatureForEditor ? `
          <button class="sig-btn-preview-select" id="sigPreviewSelect">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
            Seleccionar
          </button>
        ` : ''}
        <button class="sig-btn-preview-download" id="sigPreviewDownload">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          Descargar
        </button>
        <button class="sig-btn-preview-delete" id="sigPreviewDelete">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          Eliminar
        </button>
        <button class="sig-btn-preview-close" id="sigPreviewClose">Cerrar</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Close
  overlay.querySelector('#sigPreviewClose').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  // Download
  overlay.querySelector('#sigPreviewDownload').addEventListener('click', () => {
    downloadSignature(url, name);
  });

  // Delete
  overlay.querySelector('#sigPreviewDelete').addEventListener('click', async () => {
    if (confirm(`¿Eliminar la firma "${name}"?`)) {
      await deleteSignature(id);
      overlay.remove();
    }
  });

  // Select for editor
  const selectBtn = overlay.querySelector('#sigPreviewSelect');
  if (selectBtn) {
    selectBtn.addEventListener('click', () => {
      window.selectSignatureForEditor(url, name);
      overlay.remove();
    });
  }
}

// Load all signatures sorted alphabetically
async function loadAllSignatures() {
  $('signaturesResults').innerHTML = '<div class="signatures-loading"></div>';

  try {
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
      renderSignatureResults(signatures, true);
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
  $('signatureDropzone').style.display = '';
  signatureFile = null;
  signaturePreviewUrl = null;
}

function handleSignatureFileSelect(e) {
  const file = e.target.files[0];
  if (file) handleSignatureFile(file);
}

function handleSignatureFile(file) {
  const fileType = file.type || '';
  const fileName = file.name || '';
  const isImage = fileType.startsWith('image/') || 
                  /\.(png|jpg|jpeg|gif|webp|bmp)$/i.test(fileName);
  
  if (!isImage) {
    showToast('Por favor, selecciona una imagen');
    return;
  }

  signatureFile = file;

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
  $('signatureDropzone').style.display = '';
  $('signatureFileInput').value = '';
}

// Upload single signature to Supabase
async function uploadSignature() {
  if (!signatureFile) {
    showToast('Selecciona una imagen de firma');
    return;
  }

  let name = $('newSignatureName').value.trim();
  if (!name) {
    showToast('Introduce un nombre para la firma');
    return;
  }
  name = name.toUpperCase(); // Store in uppercase

  const btn = $('btnUploadSignature');
  btn.disabled = true;
  btn.querySelector('.btn-text').textContent = 'Subiendo...';
  btn.querySelector('.btn-loader').style.display = 'inline-block';

  try {
    const base64Image = await fileToBase64(signatureFile);
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
        name: name.toLowerCase(),
        image_url: base64Image,
        user_id: currentUser.id,
        user_name: currentUser.name
      })
    });
    
    if (!insertRes.ok) {
      const errText = await insertRes.text();
      if (insertRes.status === 404) throw new Error('La tabla "signatures" no existe.');
      if (errText.includes('permission denied') || errText.includes('policy')) throw new Error('Error de permisos.');
      throw new Error('Error al guardar: ' + errText);
    }

    showToast('Firma guardada correctamente');
    resetSignatureState();
    
    // Reload to show the new signature
    searchSignatures();

  } catch (err) {
    console.error('Upload error:', err);
    showToast('Error: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.querySelector('.btn-text').textContent = 'Guardar Firma';
    btn.querySelector('.btn-loader').style.display = 'none';
  }
}

// ============================================
// BULK UPLOAD
// ============================================

// Convert File to base64 data URL
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Extract name from filename (remove extension, UPPERCASE)
function getSignatureNameFromFile(fileName) {
  return fileName.replace(/\.[^.]+$/, '').toUpperCase();
}

// Handle multiple files for bulk upload
async function handleBulkFiles(files) {
  // Filter only images
  const imageFiles = files.filter(f => {
    const t = f.type || '';
    const n = f.name || '';
    return t.startsWith('image/') || /\.(png|jpg|jpeg|gif|webp|bmp)$/i.test(n);
  });

  if (imageFiles.length === 0) {
    showToast('No se encontraron imágenes válidas');
    return;
  }

  // Read all files as base64
  const fileDataList = [];
  for (const f of imageFiles) {
    const base64 = await fileToBase64(f);
    fileDataList.push({
      file: f,
      name: getSignatureNameFromFile(f.name),
      base64: base64
    });
  }

  // Check for duplicates in Supabase
  try {
    // Get all existing signature names
    const res = await fetch(`${SUPABASE_URL}/rest/v1/signatures?select=id,name`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${session.access_token}`
      }
    });

    const existingSigs = res.ok ? await res.json() : [];
    const existingMap = {};
    existingSigs.forEach(s => {
      existingMap[s.name.toUpperCase()] = s.id;
    });

    bulkFiles = fileDataList.map(fd => {
      const upperName = fd.name;
      const matchKey = Object.keys(existingMap).find(k => k === upperName);
      if (matchKey) {
        return {
          ...fd,
          status: 'skip', // default: keep existing
          existingId: existingMap[matchKey],
          existingName: matchKey
        };
      }
      return { ...fd, status: 'new' };
    });

    renderBulkList();

  } catch (err) {
    console.error('Error checking duplicates:', err);
    // If we can't check, mark all as new
    bulkFiles = fileDataList.map(fd => ({ ...fd, status: 'new' }));
    renderBulkList();
  }
}

// Render bulk upload list
function renderBulkList() {
  const list = $('bulkList');
  const container = $('bulkListContainer');

  if (bulkFiles.length === 0) {
    container.style.display = 'none';
    $('bulkCount').textContent = '';
    $('bulkDropzone').style.display = '';
    return;
  }

  container.style.display = 'block';
  $('bulkDropzone').style.display = 'none';

  const newCount = bulkFiles.filter(f => f.status === 'new').length;
  const replaceCount = bulkFiles.filter(f => f.status === 'replace').length;
  const skipCount = bulkFiles.filter(f => f.status === 'skip').length;
  
  $('bulkCount').textContent = `${bulkFiles.length} archivo(s) · ${newCount} nuevas · ${skipCount} conservadas · ${replaceCount} sustituir`;

  list.innerHTML = bulkFiles.map((f, i) => {
    let statusClass = 'dup-new';
    let statusText = 'Nueva';
    let toggleText = '';
    
    if (f.status === 'skip') {
      statusClass = 'dup-skip';
      statusText = 'Conservar existente';
      toggleText = 'Sustituir';
    } else if (f.status === 'replace') {
      statusClass = 'dup-exists';
      statusText = 'Sustituir existente';
      toggleText = 'Conservar';
    }
    
    const hasDup = f.status === 'skip' || f.status === 'replace';
    
    return `
      <div class="signatures-bulk-item ${statusClass}">
        <img class="signatures-bulk-thumb" src="${f.base64}" alt="">
        <span class="signatures-bulk-name" title="${esc(f.name)}">${esc(f.name)}</span>
        <span class="signatures-bulk-status ${statusClass === 'dup-new' ? 'is-new' : statusClass === 'dup-exists' ? 'is-replace' : 'is-skip'}">${statusText}</span>
        ${hasDup ? `<button class="signatures-bulk-toggle" data-idx="${i}">${toggleText}</button>` : ''}
      </div>
    `;
  }).join('');

  // Toggle buttons for duplicates
  list.querySelectorAll('.signatures-bulk-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      const item = bulkFiles[idx];
      if (item.status === 'skip') {
        item.status = 'replace';
      } else if (item.status === 'replace') {
        item.status = 'skip';
      }
      renderBulkList();
    });
  });

  // Enable upload button if there's something to upload
  const hasUploadable = bulkFiles.some(f => f.status === 'new' || f.status === 'replace');
  $('btnBulkUpload').disabled = !hasUploadable;
}

// Execute bulk upload
async function executeBulkUpload() {
  const toUpload = bulkFiles.filter(f => f.status === 'new' || f.status === 'replace');
  if (toUpload.length === 0) {
    showToast('No hay firmas para subir');
    return;
  }

  const btn = $('btnBulkUpload');
  btn.disabled = true;
  btn.querySelector('.btn-text').textContent = `Subiendo 0/${toUpload.length}...`;
  btn.querySelector('.btn-loader').style.display = 'inline-block';

  let success = 0;
  let failed = 0;

  for (let i = 0; i < toUpload.length; i++) {
    const f = toUpload[i];
    btn.querySelector('.btn-text').textContent = `Subiendo ${i + 1}/${toUpload.length}...`;

    try {
      if (f.status === 'replace' && f.existingId) {
        // Delete existing, then insert new
        await fetch(`${SUPABASE_URL}/rest/v1/signatures?id=eq.${f.existingId}`, {
          method: 'DELETE',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${session.access_token}`
          }
        });
      }

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
          name: f.name.toLowerCase(), // Store lowercase for search, display uppercase
          image_url: f.base64,
          user_id: currentUser.id,
          user_name: currentUser.name
        })
      });

      if (insertRes.ok) {
        success++;
      } else {
        failed++;
        console.error('Bulk insert error:', await insertRes.text());
      }
    } catch (err) {
      failed++;
      console.error('Bulk upload error for', f.name, err);
    }

    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 100));
  }

  btn.querySelector('.btn-text').textContent = 'Subir firmas';
  btn.querySelector('.btn-loader').style.display = 'none';

  if (failed === 0) {
    showToast(`${success} firma(s) guardada(s) correctamente`);
  } else {
    showToast(`${success} OK, ${failed} con error`);
  }

  // Reset bulk state and reload results
  bulkFiles = [];
  renderBulkList();
  loadAllSignatures();
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
    
    showToast('Firma descargada');
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
    // Reload current view
    loadAllSignatures();
  } catch (err) {
    console.error('Delete error:', err);
    showToast('Error al eliminar la firma');
  }
}

// ============================================
// PROCESSES MODULE
// ============================================

function setupProcessesListeners() {
  $('btnCandidates').addEventListener('click', openProcessesModal);
  $('closeProcessesModal').addEventListener('click', closeProcessesModal);
  $('processForm').addEventListener('submit', handleCreateProcess);
  $('processesList').addEventListener('click', handleProcessActions);
  $('processMonthFilter').addEventListener('change', (e) => {
    processMonthFilter = e.target.value;
    renderProcesses();
    renderGlobalStats();
  });
  $('processDelegationFilter').addEventListener('change', (e) => {
    processDelegationFilter = e.target.value;
    renderProcesses();
    renderGlobalStats();
  });
  $('processPositionFilter').addEventListener('change', (e) => {
    processPositionFilter = e.target.value;
    renderProcesses();
    renderGlobalStats();
  });
  $('btnCompactView').addEventListener('click', () => {
    processCompactView = !processCompactView;
    $('btnCompactView').classList.toggle('active', processCompactView);
    if (processCompactView) collapsedProcesses.clear(); // Clear individual states
    renderProcesses();
  });
  document.querySelectorAll('.process-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.process-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      processTabFilter = tab.dataset.tab;
      renderProcesses();
      renderGlobalStats();
    });
  });
}

function openProcessesModal() {
  $('processesModal').classList.add('show');
  populateMonthFilter();
  loadProcesses();
}

function closeProcessesModal() {
  $('processesModal').classList.remove('show');
}

async function loadProcesses() {
  if (!session || !currentUser) return;
  
  try {
    const query = `?select=*&order=created_at.desc`;
    const data = await processesApi('GET', null, query);
    processes = data || [];
    renderProcesses();
    renderGlobalStats();
  } catch (err) {
    console.error('Error loading processes:', err);
    showToast('Error al cargar procesos');
  }
}

async function processesApi(method, body, query = '') {
  if (!session || !session.access_token) {
    const stored = await chrome.storage.local.get(['session']);
    if (stored.session && stored.session.access_token) {
      session = stored.session;
    } else {
      throw new Error('No hay sesión activa');
    }
  }
  
  const url = `${SUPABASE_URL}/rest/v1/recruitment_processes${query}`;
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
  
  const res = await fetch(url, opts);
  
  if (!res.ok) {
    const errText = await res.text();
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
      throw new Error('Sesión expirada');
    }
    throw new Error(errText || `Error ${res.status}`);
  }
  if (method === 'DELETE') return {};
  return res.json();
}

async function handleCreateProcess(e) {
  e.preventDefault();
  const name = $('processName').value.trim();
  if (!name) return;
  
  const btn = $('processForm').querySelector('.btn-add-process');
  btn.disabled = true;
  
  try {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
    const position = $('processPosition').value;
    const province = $('processProvince').value;
    if (!position) {
      showToast('Selecciona un puesto');
      btn.disabled = false;
      return;
    }
    if (!province) {
      showToast('Selecciona una provincia');
      btn.disabled = false;
      return;
    }
    
    const objetivoVal = parseInt($('processObjetivo').value) || 0;
    const newProc = {
      id,
      user_id: currentUser.id,
      user_name: currentUser.name,
      name,
      position,
      province,
      objetivo: Math.max(0, objetivoVal),
      added: 0,
      called: 0,
      interviewed: 0,
      selected: 0,
      added_erp: 0,
      called_erp: 0,
      interviewed_erp: 0,
      selected_erp: 0
    };
    
    await processesApi('POST', newProc);
    processes.unshift(newProc);
    
    $('processName').value = '';
    $('processPosition').value = '';
    $('processProvince').value = '';
    $('processObjetivo').value = '';
    renderProcesses();
    renderGlobalStats();
    showToast('Proceso creado');
  } catch (err) {
    console.error('Error creating process:', err);
    showToast('Error: ' + err.message);
  } finally {
    btn.disabled = false;
  }
}

async function handleProcessActions(e) {
  // Individual expand button
  const expandBtn = e.target.closest('.btn-process-expand');
  if (expandBtn) {
    const id = expandBtn.dataset.id;
    collapsedProcesses.delete(id);
    renderProcesses();
    return;
  }
  
  // Individual collapse button
  const collapseBtn = e.target.closest('.btn-process-collapse');
  if (collapseBtn) {
    const id = collapseBtn.dataset.id;
    collapsedProcesses.add(id);
    renderProcesses();
    return;
  }
  
  const counterBtn = e.target.closest('.btn-counter');
  if (counterBtn) {
    const id = counterBtn.dataset.id;
    const field = counterBtn.dataset.field;
    const delta = counterBtn.dataset.delta === '1' ? 1 : -1;
    await updateCounter(id, field, delta);
    return;
  }
  
  const counterValue = e.target.closest('.counter-value');
  if (counterValue) {
    const proc = processes.find(p => p.id === counterValue.dataset.id);
    if (!proc || proc.is_active === false) return;
    const field = counterValue.dataset.field;
    
    const wrapper = document.createElement('div');
    wrapper.className = 'counter-sum-wrapper';
    
    const plusIcon = document.createElement('span');
    plusIcon.className = 'counter-sum-icon';
    plusIcon.textContent = '+';
    
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.value = '';
    input.placeholder = '0';
    input.className = 'counter-sum-input';
    
    wrapper.appendChild(plusIcon);
    wrapper.appendChild(input);
    
    const saveValue = async () => {
      const addVal = Math.max(0, parseInt(input.value) || 0);
      if (addVal > 0) {
        await updateCounter(proc.id, field, addVal);
      } else {
        wrapper.replaceWith(counterValue);
      }
    };
    
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
      if (ev.key === 'Escape') { wrapper.replaceWith(counterValue); }
    });
    input.addEventListener('blur', saveValue);
    
    counterValue.replaceWith(wrapper);
    input.focus();
    return;
  }
  
  const delBtn = e.target.closest('.btn-process-del');
  if (delBtn) {
    deleteProcess(delBtn.dataset.id);
    return;
  }
  
  const editBtn = e.target.closest('.btn-process-edit');
  if (editBtn) {
    editProcessName(editBtn.dataset.id);
    return;
  }
  
  const finalizeBtn = e.target.closest('.btn-process-finalize');
  if (finalizeBtn) {
    finalizeProcess(finalizeBtn.dataset.id);
    return;
  }
}

async function updateCounter(id, field, delta) {
  const proc = processes.find(p => p.id === id);
  if (!proc || proc.is_active === false) return;
  
  const newVal = Math.max(0, (proc[field] || 0) + delta);
  
  try {
    await processesApi('PATCH', { [field]: newVal }, `?id=eq.${id}`);
    proc[field] = newVal;
    renderProcesses();
    renderGlobalStats();
  } catch (err) {
    console.error('Error updating counter:', err);
    showToast('Error al actualizar');
  }
}

async function deleteProcess(id) {
  const proc = processes.find(p => p.id === id);
  if (!proc) return;
  if (!confirm(`¿Eliminar "${proc.name}"?`)) return;
  
  try {
    await processesApi('DELETE', null, `?id=eq.${id}`);
    processes = processes.filter(p => p.id !== id);
    renderProcesses();
    renderGlobalStats();
    showToast('Proceso eliminado');
  } catch (err) {
    console.error('Error deleting:', err);
    showToast('Error al eliminar');
  }
}

async function editProcessName(id) {
  const proc = processes.find(p => p.id === id);
  if (!proc) return;
  
  const newName = prompt('Nuevo nombre del proceso:', proc.name);
  if (!newName || newName.trim() === '' || newName.trim() === proc.name) return;
  
  try {
    await processesApi('PATCH', { name: newName.trim() }, `?id=eq.${id}`);
    proc.name = newName.trim();
    renderProcesses();
    showToast('Nombre actualizado');
  } catch (err) {
    console.error('Error updating name:', err);
    showToast('Error al actualizar');
  }
}

function getDelegationForProvince(province) {
  if (!province) return 'Nacional';
  for (const [delegation, provinces] of Object.entries(DELEGATIONS)) {
    if (delegation === 'Nacional') continue;
    if (provinces.includes(province)) return delegation;
  }
  return 'Nacional';
}

function getFilteredProcesses() {
  let filtered = processes;

  // Filter by month
  if (processMonthFilter !== 'all') {
    filtered = filtered.filter(p => {
      if (!p.created_at) return false;
      const d = new Date(p.created_at);
      const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      return key === processMonthFilter;
    });
  }

  // Filter by delegation
  if (processDelegationFilter !== 'all') {
    filtered = filtered.filter(p => {
      const procDelegation = getDelegationForProvince(p.province);
      return procDelegation === processDelegationFilter;
    });
  }

  // Filter by position
  if (processPositionFilter !== 'all') {
    filtered = filtered.filter(p => p.position === processPositionFilter);
  }

  // Filter by tab (active vs finalized)
  if (processTabFilter === 'active') {
    filtered = filtered.filter(p => p.is_active !== false);
  } else {
    filtered = filtered.filter(p => p.is_active === false);
  }

  return filtered;
}

function populateMonthFilter() {
  const select = $('processMonthFilter');
  const months = new Map();
  processes.forEach(p => {
    if (!p.created_at) return;
    const d = new Date(p.created_at);
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    if (!months.has(key)) {
      const label = d.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
      months.set(key, label.charAt(0).toUpperCase() + label.slice(1));
    }
  });
  
  const currentVal = select.value;
  select.innerHTML = '<option value="all">Todos los meses</option>';
  
  const sortedKeys = [...months.keys()].sort().reverse();
  sortedKeys.forEach(key => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = months.get(key);
    select.appendChild(opt);
  });
  
  select.value = currentVal || 'all';
}

function renderGlobalStats() {
  const filtered = getFilteredProcesses();
  let totalAdded = 0, totalCalled = 0, totalInterviewed = 0, totalSelected = 0;
  let selectedOfertas = 0, selectedErp = 0;
  filtered.forEach(p => {
    const ao = p.added || 0, so = p.selected || 0;
    const ae = p.added_erp || 0, se = p.selected_erp || 0;
    totalAdded += ao + ae;
    totalCalled += (p.called || 0) + (p.called_erp || 0);
    totalInterviewed += (p.interviewed || 0) + (p.interviewed_erp || 0);
    totalSelected += so + se;
    selectedOfertas += so;
    selectedErp += se;
  });
  
  $('gsTotal').textContent = totalAdded;
  $('gsCalled').textContent = totalCalled;
  $('gsInterviewed').textContent = totalInterviewed;
  $('gsSelected').textContent = totalSelected;
  
  const rate = totalAdded > 0 ? Math.round((totalSelected / totalAdded) * 100) : 0;
  $('gsRate').textContent = rate + '%';
  
  $('gsSelOfertas').textContent = selectedOfertas;
  $('gsSelErp').textContent = selectedErp;
  
  const totalSelBalance = selectedOfertas + selectedErp;
  if (totalSelBalance > 0) {
    const pctOfertas = Math.round((selectedOfertas / totalSelBalance) * 100);
    const pctErp = Math.round((selectedErp / totalSelBalance) * 100);
    $('gsBalanceOfertas').style.width = pctOfertas + '%';
    $('gsBalanceErp').style.width = pctErp + '%';
    $('gsBalanceText').textContent = `Ofertas ${pctOfertas}% | ERP ${pctErp}%`;
  } else {
    $('gsBalanceOfertas').style.width = '50%';
    $('gsBalanceErp').style.width = '50%';
    $('gsBalanceText').textContent = 'Sin datos';
  }
}

function renderProcesses() {
  const list = $('processesList');
  const filtered = getFilteredProcesses();
  const isFinalizedTab = processTabFilter === 'finalized';
  
  if (filtered.length === 0) {
    const emptyMsg = isFinalizedTab
      ? 'No hay procesos finalizados'
      : (processMonthFilter === 'all' ? 'No hay procesos creados' : 'Sin procesos este mes');
    list.innerHTML = `
      <div class="processes-empty">
        <div class="processes-empty-icon">📊</div>
        <div class="processes-empty-text">${emptyMsg}</div>
        <div class="processes-empty-hint">Escribe un nombre y pulsa "Crear"</div>
      </div>
    `;
    return;
  }
  
  const fields = [
    { key: 'added', label: 'Base de Datos', icon: '📋', color: '#3b82f6' },
    { key: 'called', label: 'Citados', icon: '📞', color: '#f59e0b' },
    { key: 'interviewed', label: 'Entrevistados', icon: '🎤', color: '#8b5cf6' },
    { key: 'selected', label: 'Seleccionados', icon: '✅', color: '#10b981' }
  ];
  
  const fieldsErp = [
    { key: 'added_erp', label: 'Base de Datos', icon: '📋', color: '#3b82f6' },
    { key: 'called_erp', label: 'Citados', icon: '📞', color: '#f59e0b' },
    { key: 'interviewed_erp', label: 'Entrevistados', icon: '🎤', color: '#8b5cf6' },
    { key: 'selected_erp', label: 'Seleccionados', icon: '✅', color: '#10b981' }
  ];
  
  list.innerHTML = filtered.map(proc => {
    const total = (proc.added || 0) + (proc.added_erp || 0);
    const totalSel = (proc.selected || 0) + (proc.selected_erp || 0);
    const selOfertas = proc.selected || 0;
    const selErp = proc.selected_erp || 0;
    const rate = total > 0 ? Math.round((totalSel / total) * 100) : 0;
    const createdDate = proc.created_at ? new Date(proc.created_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : '';
    
    const isOwn = proc.user_id === currentUser.id;
    const creatorName = proc.user_name || 'Usuario';
    const position = proc.position || '';
    const province = proc.province || '';
    const isFinished = proc.is_active === false;
    const objetivo = proc.objetivo || 0;
    const objProgress = objetivo > 0 ? Math.min(100, Math.round((totalSel / objetivo) * 100)) : 0;
    const isCollapsed = processCompactView || collapsedProcesses.has(proc.id);
    const objEmoji = objetivo > 0 ? (objProgress >= 100 ? '🎯' : (objProgress >= 50 ? '📍' : '⏳')) : '';
    
    // Helper to render a counter row
    const renderCounter = (f) => {
      return isFinished ? `
                <div class="counter-row" style="border-left: 3px solid ${f.color}">
                  <div class="counter-info">
                    <span class="counter-icon">${f.icon}</span>
                    <span class="counter-label">${f.label}</span>
                  </div>
                  <div class="counter-controls counter-locked">
                    <span class="counter-value" data-id="${proc.id}" data-field="${f.key}">${proc[f.key] || 0}</span>
                  </div>
                </div>` : `
                <div class="counter-row" style="border-left: 3px solid ${f.color}">
                  <div class="counter-info">
                    <span class="counter-icon">${f.icon}</span>
                    <span class="counter-label">${f.label}</span>
                  </div>
                  <div class="counter-controls">
                    <button class="btn-counter" data-id="${proc.id}" data-field="${f.key}" data-delta="-1" title="Restar">−</button>
                    <span class="counter-value clickable" data-id="${proc.id}" data-field="${f.key}" title="Clic para sumar">${proc[f.key] || 0}</span>
                    <button class="btn-counter" data-id="${proc.id}" data-field="${f.key}" data-delta="1" title="Sumar">+</button>
                  </div>
                </div>`;
    };

    // Compact single-line
    if (isCollapsed) {
      const objColor = objetivo > 0 ? (objProgress >= 100 ? '#10b981' : (objProgress >= 68 ? '#eab308' : (objProgress >= 34 ? '#f97316' : '#ef4444'))) : 'var(--pri)';
      return `
        <div class="process-card ${isFinished ? 'is-finished' : ''} compact-single">
          <div class="process-card-compact-line" style="border-left-color: ${objColor}">
            <button class="btn-process-expand" data-id="${proc.id}" title="Desplegar">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="9 18 15 12 9 6"></polyline></svg>
            </button>
            <span class="compact-name">${esc(proc.name)}</span>
            <span class="compact-sep">/</span>
            <span class="compact-pos">${position ? esc(position) : '—'}</span>
            <span class="compact-sep">/</span>
            <span class="compact-loc">${province ? esc(province) : '—'}</span>
            <span class="compact-sep">/</span>
            ${objetivo > 0 ? `
              <span class="compact-obj ${objProgress >= 100 ? 'obj-reached' : ''}">${objEmoji} ${totalSel}/${objetivo}</span>
            ` : `<span class="compact-obj-none">Sin objetivo</span>`}
            <span class="compact-sep">/</span>
            <span class="compact-sel" title="Ofertas: ${selOfertas} | ERP: ${selErp}">✅ ${totalSel}</span>
            <div class="compact-line-actions">
              ${isFinished ? `<span class="process-finished-badge mini">🏁</span>` : ''}
              ${isOwn ? `<button class="btn-process-del btn-process-del-mini" data-id="${proc.id}" title="Eliminar">🗑</button>` : ''}
            </div>
          </div>
        </div>
      `;
    }

    // Expanded full card
    const objColorExpanded = objetivo > 0 ? (objProgress >= 100 ? '#10b981' : (objProgress >= 68 ? '#eab308' : (objProgress >= 34 ? '#f97316' : '#ef4444'))) : 'var(--bor)';
    return `
      <div class="process-card ${isFinished ? 'is-finished' : ''}" style="border-left: 3px solid ${objColorExpanded}">
        <div class="process-card-header">
          <div class="process-card-line-top">
            <button class="btn-process-collapse" data-id="${proc.id}" title="Comprimir">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="15 18 9 12 15 6"></polyline></svg>
            </button>
            <span class="process-card-name">${esc(proc.name)}</span>
            <span class="hdr-sep">/</span>
            <span class="process-card-date">${createdDate}</span>
            <span class="hdr-sep">/</span>
            ${province ? `<span class="process-card-province">${esc(province)}</span>` : ''}
            <span class="hdr-sep">/</span>
            <span class="process-card-creator">${esc(creatorName)}</span>
          </div>
          <div class="process-card-line-bottom">
            ${position ? `<span class="process-card-position">${esc(position)}</span>` : ''}
            <span class="hdr-sep">/</span>
            ${objetivo > 0 ? `<span class="process-card-objetivo" title="Objetivo: ${objetivo} seleccionados">${objetivo} objetivo</span>` : `<span class="process-card-objetivo-none">sin objetivo</span>`}
            <div class="process-card-actions-header">
              ${isOwn && !isFinished ? `<button class="btn-process-finalize" data-id="${proc.id}" title="Finalizar">Finalizar</button>` : ''}
              ${isFinished ? `<span class="process-finished-badge">Finalizado</span>` : ''}
              ${isOwn ? `<button class="btn-process-edit" data-id="${proc.id}" title="Editar">✏️</button>
              <button class="btn-process-del" data-id="${proc.id}" title="Eliminar">🗑</button>` : ''}
            </div>
          </div>
        </div>
        <div class="process-channels ${isFinished ? 'finished' : ''}">
          <div class="process-channel">
            <div class="channel-header">🌐 Ofertas de Empleo</div>
            <div class="channel-counters">
              ${fields.map(f => renderCounter(f)).join('')}
            </div>
            <div class="channel-rate">
              <div class="process-rate-bar"><div class="process-rate-fill" style="width:${(proc.added || 0) > 0 ? Math.round(((proc.selected || 0) / (proc.added || 0)) * 100) : 0}%"></div></div>
              <span class="process-rate-text">${(proc.added || 0) > 0 ? Math.round(((proc.selected || 0) / (proc.added || 0)) * 100) : 0}%</span>
            </div>
          </div>
          <div class="channel-divider"></div>
          <div class="process-channel">
            <div class="channel-header">🏢 ERP Interna</div>
            <div class="channel-counters">
              ${fieldsErp.map(f => renderCounter(f)).join('')}
            </div>
            <div class="channel-rate">
              <div class="process-rate-bar"><div class="process-rate-fill" style="width:${(proc.added_erp || 0) > 0 ? Math.round(((proc.selected_erp || 0) / (proc.added_erp || 0)) * 100) : 0}%"></div></div>
              <span class="process-rate-text">${(proc.added_erp || 0) > 0 ? Math.round(((proc.selected_erp || 0) / (proc.added_erp || 0)) * 100) : 0}%</span>
            </div>
          </div>
        </div>
        <div class="process-card-footer">
          ${objetivo > 0 ? `
            <div class="objetivo-section">
              <span class="objetivo-label">🎯 Objetivo: ${objetivo}</span>
              <div class="objetivo-bar"><div class="objetivo-fill" style="width:${objProgress}%"></div></div>
              <span class="objetivo-progress">${totalSel}/${objetivo} (${objProgress}%)</span>
            </div>
          ` : ''}
          <span class="footer-total">Total BD: ${total} | Selec. 🌐 ${selOfertas} / 🏢 ${selErp} = ${totalSel}</span>
          <div class="process-rate">
            <div class="process-rate-bar">
              <div class="process-rate-fill" style="width:${rate}%"></div>
            </div>
            <span class="process-rate-text">Conversión: ${rate}%</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function finalizeProcess(id) {
  const proc = processes.find(p => p.id === id);
  if (!proc) return;
  if (!confirm(`¿Finalizar "${proc.name}"? Los contadores quedarán bloqueados.`)) return;
  
  try {
    await processesApi('PATCH', { is_active: false }, `?id=eq.${id}`);
    proc.is_active = false;
    renderProcesses();
    renderGlobalStats();
    showToast('Proceso finalizado');
  } catch (err) {
    console.error('Error finalizing:', err);
    showToast('Error al finalizar');
  }
}
