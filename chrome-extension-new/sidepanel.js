// ============================================
// CALENDARIO COLABORATIVO
// ============================================

const SUPABASE_URL = 'https://iugutcsukxkxlgpkmzxt.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1Z3V0Y3N1a3hreGxncGttenh0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzc5OTExMjksImV4cCI6MjA1MzU2NzEyOX0.PpolAzqqXNBOhRlUVzplqkKeGQxzfed4gH377CidVJE';

// State
let events = {};
let collapsed = new Set();
let editingId = null;
let dragId = null;
let dragDate = null;
let calDate = new Date();

// DOM
const $ = id => document.getElementById(id);
const daysList = $('daysList');
const modalOverlay = $('modalOverlay');
const toast = $('toast');

// Supabase REST API
async function api(method, body, query = '') {
  const url = `${SUPABASE_URL}/rest/v1/calendar_events${query}`;
  const opts = {
    method,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    }
  };
  if (body) opts.body = JSON.stringify(body);
  
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(await res.text());
  if (method === 'DELETE') return {};
  return res.json();
}

// Init
document.addEventListener('DOMContentLoaded', () => {
  console.log('Init...');
  loadEvents();
  setupListeners();
});

// Event Listeners - using event delegation
function setupListeners() {
  // Add event button
  $('btnAddEvent').addEventListener('click', () => openModal());
  
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
  
  // Event delegation for days list
  daysList.addEventListener('click', handleDaysClick);
  
  // Drag events
  daysList.addEventListener('dragstart', handleDragStart);
  daysList.addEventListener('dragend', handleDragEnd);
  daysList.addEventListener('dragover', handleDragOver);
  daysList.addEventListener('dragleave', handleDragLeave);
  daysList.addEventListener('drop', handleDrop);
}

// Handle clicks in days list
function handleDaysClick(e) {
  const dayHeader = e.target.closest('.day-header');
  if (dayHeader) {
    // Toggle collapse
    const dayRow = dayHeader.closest('.day-row');
    const dateKey = dayRow.dataset.date;
    if (collapsed.has(dateKey)) {
      collapsed.delete(dateKey);
    } else {
      collapsed.add(dateKey);
    }
    renderDays();
    return;
  }
  
  const editBtn = e.target.closest('.btn-edit');
  if (editBtn) {
    const evtId = editBtn.dataset.id;
    openModal(evtId);
    return;
  }
  
  const delBtn = e.target.closest('.btn-del');
  if (delBtn) {
    const evtId = delBtn.dataset.id;
    deleteEvent(evtId);
    return;
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
    
    // Update local
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
  
  for (let i = 0; i < 7; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() + i);
    const key = fmtDate(date);
    const list = events[key] || [];
    const isToday = i === 0;
    const isCol = collapsed.has(key);
    
    html += `
      <div class="day-row ${isToday ? 'today' : ''} ${isCol ? 'collapsed' : ''}" data-date="${key}">
        <div class="day-header">
          <div class="day-date">
            <div class="day-name">${isToday ? 'HOY' : dayNames[date.getDay()]}</div>
            <div class="day-num">${date.getDate()} ${monthNames[date.getMonth()]}</div>
          </div>
          <div class="day-info">
            <span class="day-count">${list.length} evento${list.length !== 1 ? 's' : ''}</span>
            <div class="day-dots">
              ${list.slice(0, 4).map(ev => `<span class="day-dot" style="background:${ev.color}"></span>`).join('')}
            </div>
          </div>
          <div class="day-toggle">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </div>
        </div>
        <div class="day-events">
          ${list.length > 0 ? list.map(ev => `
            <div class="event-row" draggable="true" data-id="${ev.id}" data-date="${ev.date}">
              <span class="event-color" style="background:${ev.color}"></span>
              <div class="event-content">
                <div class="event-title">${esc(ev.title)}</div>
                ${ev.time ? `<div class="event-time">${fmtTime(ev.time)}</div>` : ''}
              </div>
              <div class="event-btns">
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
              </div>
            </div>
          `).join('') : '<div class="no-events">Sin eventos</div>'}
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
  const start = first.getDay();
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
    html += `<div class="cal-day other" data-date="${key}">${d}
      <div class="cal-dots">${evts.slice(0, 3).map(e => `<span class="cal-dot" style="background:${e.color}"></span>`).join('')}</div>
    </div>`;
  }
  
  // Current month
  for (let d = 1; d <= days; d++) {
    const dt = new Date(year, month, d);
    const key = fmtDate(dt);
    const evts = events[key] || [];
    const isToday = dt.getTime() === today.getTime();
    html += `<div class="cal-day ${isToday ? 'today' : ''}" data-date="${key}">${d}
      <div class="cal-dots">${evts.slice(0, 3).map(e => `<span class="cal-dot" style="background:${e.color}"></span>`).join('')}</div>
    </div>`;
  }
  
  // Next month
  const rem = 42 - (start + days);
  for (let d = 1; d <= rem; d++) {
    const dt = new Date(year, month + 1, d);
    const key = fmtDate(dt);
    const evts = events[key] || [];
    html += `<div class="cal-day other" data-date="${key}">${d}
      <div class="cal-dots">${evts.slice(0, 3).map(e => `<span class="cal-dot" style="background:${e.color}"></span>`).join('')}</div>
    </div>`;
  }
  
  $('calGrid').innerHTML = html;
  
  // Click on calendar day
  $('calGrid').querySelectorAll('.cal-day').forEach(el => {
    el.addEventListener('click', () => {
      openModal(null, el.dataset.date);
    });
  });
}

// Modal
function openModal(id = null, date = null) {
  editingId = id;
  
  if (id) {
    // Find event
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
      
      const radio = document.querySelector(`input[name="color"][value="${evt.color}"]`);
      if (radio) radio.checked = true;
    }
  } else {
    $('modalTitle').textContent = 'Nuevo Evento';
    $('inputTitle').value = '';
    $('inputDate').value = date || fmtDate(new Date());
    $('inputTime').value = '';
    $('inputDesc').value = '';
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
  
  if (!title || !date) {
    showToast('Título y fecha requeridos');
    return;
  }
  
  try {
    setStatus('sync', 'Guardando...');
    
    if (editingId) {
      // Update
      let oldDate = null;
      for (const d in events) {
        if (events[d].find(e => e.id === editingId)) { oldDate = d; break; }
      }
      
      await api('PATCH', { title, date, time: time || null, description: desc || null, color }, `?id=eq.${editingId}`);
      
      // Update local
      if (oldDate) {
        events[oldDate] = events[oldDate].filter(e => e.id !== editingId);
        if (events[oldDate].length === 0) delete events[oldDate];
      }
      if (!events[date]) events[date] = [];
      events[date].push({ id: editingId, title, date, time, description: desc, color });
      
      showToast('Evento actualizado');
    } else {
      // Create
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
      await api('POST', { id, title, date, time: time || null, description: desc || null, color });
      
      if (!events[date]) events[date] = [];
      events[date].push({ id, title, date, time, description: desc, color });
      
      showToast('Evento creado');
    }
    
    setStatus('ok', 'Sincronizado');
    closeModal();
    renderDays();
    renderCal();
    
  } catch (err) {
    console.error(err);
    setStatus('err', 'Error');
    showToast('Error al guardar');
  }
}

// Delete
async function deleteEvent(id) {
  if (!confirm('¿Eliminar este evento?')) return;
  
  try {
    setStatus('sync', 'Eliminando...');
    
    await api('DELETE', null, `?id=eq.${id}`);
    
    // Update local
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
  try {
    setStatus('sync', 'Cargando...');
    
    const data = await api('GET', null, '?select=*&order=date.asc&order=time.asc');
    
    events = {};
    if (data && data.length > 0) {
      data.forEach(ev => {
        if (!events[ev.date]) events[ev.date] = [];
        events[ev.date].push({
          id: ev.id,
          title: ev.title,
          date: ev.date,
          time: ev.time,
          description: ev.description,
          color: ev.color
        });
      });
    }
    
    setStatus('ok', 'Sincronizado');
    renderDays();
    renderCal();
    
  } catch (err) {
    console.error(err);
    setStatus('err', 'Error');
    showToast('Error de conexión');
  }
}

// Helpers
function setStatus(type, text) {
  const dot = $('statusDot');
  dot.className = 'status-dot';
  if (type === 'sync') dot.classList.add('sync');
  if (type === 'err') dot.classList.add('err');
  $('statusText').textContent = text;
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
setInterval(loadEvents, 30000);
