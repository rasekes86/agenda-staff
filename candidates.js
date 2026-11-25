const API_BASE = 'https://jobtoday-candidatos.rasekes.chatgpt.site';
const PROVINCES = [
  ['01','Álava'],['02','Albacete'],['03','Alicante'],['04','Almería'],['05','Ávila'],['06','Badajoz'],['07','Illes Balears'],['08','Barcelona'],['09','Burgos'],['10','Cáceres'],['11','Cádiz'],['12','Castellón'],['13','Ciudad Real'],['14','Córdoba'],['15','A Coruña'],['16','Cuenca'],['17','Girona'],['18','Granada'],['19','Guadalajara'],['20','Gipuzkoa'],['21','Huelva'],['22','Huesca'],['23','Jaén'],['24','León'],['25','Lleida'],['26','La Rioja'],['27','Lugo'],['28','Madrid'],['29','Málaga'],['30','Murcia'],['31','Navarra'],['32','Ourense'],['33','Asturias'],['34','Palencia'],['35','Las Palmas'],['36','Pontevedra'],['37','Salamanca'],['38','Santa Cruz de Tenerife'],['39','Cantabria'],['40','Segovia'],['41','Sevilla'],['42','Soria'],['43','Tarragona'],['44','Teruel'],['45','Toledo'],['46','Valencia'],['47','Valladolid'],['48','Bizkaia'],['49','Zamora'],['50','Zaragoza'],['51','Ceuta'],['52','Melilla']
];
const state = { token: null, page: 1, total: 0, pages: 1, candidates: [], busy: false };
let activeCvObjectUrl = null;
const $ = (id) => document.getElementById(id);

function setStatus(message, kind = '') {
  $('status').textContent = message;
  $('status').className = `status${kind ? ` ${kind}` : ''}`;
}

async function loadSession() {
  const stored = await chrome.storage.local.get(['session', 'user']);
  const token = stored.session?.access_token;
  if (!token || !stored.user) {
    $('account').textContent = 'Sesión de Agenda Staff no encontrada';
    setStatus('Abre el panel de Agenda Staff, inicia sesión y vuelve a abrir el buscador.', 'error');
    $('searchButton').disabled = true;
    return false;
  }
  state.token = token;
  $('account').textContent = stored.user.email || stored.user.name || 'Sesión activa';
  setStatus('Sesión activa. La consulta se limita a cuentas autorizadas.');
  return true;
}

function fillProvinces() {
  for (const [id, name] of PROVINCES) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = name;
    $('provinceFilter').append(option);
  }
}

function paramsForExport() {
  const params = new URLSearchParams({
    search: $('search').value.trim(),
    job: $('job').value.trim(),
    province: $('provinceFilter').value,
    page: String(state.page),
    excludeExported: $('excludeExported').checked ? '1' : '0',
  });
  return params;
}

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${state.token}`, ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) throw new Error('Tu sesión no está autorizada. Comprueba que tu cuenta de Agenda Staff tiene acceso a la base de candidatos.');
    throw new Error(payload.error || `Error del buscador (${response.status}).`);
  }
  return payload;
}

async function apiFile(path, body) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${state.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) throw new Error('Tu sesión no está autorizada. Comprueba que tu cuenta de Agenda Staff tiene acceso a la base de candidatos.');
    throw new Error(payload.error || `Error al generar el Excel (${response.status}).`);
  }
  return response;
}

async function searchCandidates() {
  if (!state.token || state.busy) return;
  state.busy = true;
  $('searchButton').disabled = true;
  $('exportButton').disabled = true;
  setStatus('Buscando candidatos…');
  try {
    const data = await api(`/api/dashboard?${paramsForExport()}`);
    state.candidates = data.candidates || [];
    state.total = Number(data.total || 0);
    state.pages = Number(data.pages || 1);
    renderResults();
    $('resultCount').textContent = `${state.total.toLocaleString('es-ES')} candidatos encontrados · página ${state.page} de ${state.pages}`;
    $('exportButton').disabled = state.total === 0;
    setStatus(state.total ? 'Búsqueda completada.' : 'No hay resultados para esos filtros.', state.total ? 'success' : '');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'No se pudo buscar.', 'error');
  } finally {
    state.busy = false;
    $('searchButton').disabled = !state.token;
    $('previousPage').disabled = state.page <= 1;
    $('nextPage').disabled = state.page >= state.pages;
  }
}

function renderResults() {
  const body = $('results');
  body.replaceChildren();
  if (!state.candidates.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 6;
    cell.className = 'empty';
    cell.textContent = 'No hay candidatos en esta página.';
    row.append(cell);
    body.append(row);
    return;
  }
  for (const candidate of state.candidates) {
    const row = document.createElement('tr');
    for (const [value, muted] of [
      [candidate.name, false], [candidate.phone || '—', !candidate.phone], [candidate.email || '—', !candidate.email],
      [candidate.latestJob || '—', !candidate.latestJob], [candidate.exportedAt ? 'Sí' : 'No', !candidate.exportedAt],
    ]) {
      const cell = document.createElement('td');
      cell.textContent = String(value);
      if (muted) cell.className = 'muted';
      row.append(cell);
    }
    const cvCell = document.createElement('td');
    if (candidate.cvPdfLink) {
      const preview = document.createElement('button');
      preview.type = 'button';
      preview.className = 'preview-cv';
      preview.textContent = 'Ver CV';
      preview.addEventListener('click', () => { void previewCv(candidate); });
      cvCell.append(preview);
    } else {
      cvCell.textContent = '—';
      cvCell.className = 'muted';
    }
    row.append(cvCell);
    body.append(row);
  }
  $('pageLabel').textContent = `Página ${state.page} de ${state.pages}`;
}

async function previewCv(candidate) {
  const dialog = $('cvDialog');
  const frame = $('cvFrame');
  const status = $('cvStatus');
  const openLink = $('openCvTab');
  $('cvDialogTitle').textContent = candidate.name ? `CV · ${candidate.name}` : 'Vista previa del CV';
  status.hidden = false;
  status.textContent = 'Cargando CV…';
  status.className = 'cv-status';
  frame.hidden = true;
  frame.removeAttribute('src');
  openLink.hidden = true;
  dialog.showModal();
  try {
    const response = await fetch(`${API_BASE}/api/candidates/${encodeURIComponent(candidate.id)}/cv`, {
      headers: { Authorization: `Bearer ${state.token}` },
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      if (response.status === 401) throw new Error('Tu sesión no está autorizada para abrir este CV.');
      throw new Error(payload.error || 'No se pudo cargar el CV.');
    }
    const blob = await response.blob();
    if (activeCvObjectUrl) URL.revokeObjectURL(activeCvObjectUrl);
    activeCvObjectUrl = URL.createObjectURL(blob);
    frame.src = activeCvObjectUrl;
    frame.hidden = false;
    openLink.href = activeCvObjectUrl;
    openLink.hidden = false;
    status.hidden = true;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : 'No se pudo cargar el CV.';
    status.className = 'cv-status error';
  }
}

function filenamePart(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function updateFilename() {
  const province = filenamePart($('exportProvince').value) || 'provincia';
  const tags = filenamePart($('exportTags').value);
  $('filenamePreview').textContent = `Nombre: ${['bbdd', province, tags].filter(Boolean).join('_')}.xlsx`;
}

async function downloadExcel(event) {
  event.preventDefault();
  if (!$('exportForm').reportValidity() || state.busy) return;
  const province = $('exportProvince').value.trim();
  const observations = $('exportObservations').value.trim();
  const tags = $('exportTags').value.trim();
  const button = $('confirmExport');
  state.busy = true;
  button.disabled = true;
  button.textContent = 'Generando…';
  try {
    const response = await apiFile('/api/extension/export', {
      search: $('search').value.trim(),
      job: $('job').value.trim(),
      provinceFilter: $('provinceFilter').value,
      excludeExported: $('excludeExported').checked,
      sample: Number($('exportLimit').value),
      province,
      observations,
      tags,
    });
    const count = Number(response.headers.get('X-Exported-Count') || 0);
    const blob = await response.blob();
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    const filename = ['bbdd', filenamePart(province) || 'provincia', filenamePart(tags)].filter(Boolean).join('_');
    anchor.download = `${filename}.xlsx`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(href), 2000);
    $('exportDialog').close();
    setStatus(`${count.toLocaleString('es-ES')} candidatos exportados y marcados como utilizados.`, 'success');
    state.busy = false;
    await searchCandidates();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'No se pudo generar el Excel.', 'error');
  } finally {
    state.busy = false;
    button.disabled = false;
    button.textContent = 'Descargar Excel';
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  fillProvinces();
  await loadSession();
  $('searchForm').addEventListener('submit', (event) => { event.preventDefault(); state.page = 1; void searchCandidates(); });
  $('clearButton').addEventListener('click', () => { $('searchForm').reset(); state.page = 1; void searchCandidates(); });
  $('previousPage').addEventListener('click', () => { if (state.page > 1) { state.page -= 1; void searchCandidates(); } });
  $('nextPage').addEventListener('click', () => { if (state.page < state.pages) { state.page += 1; void searchCandidates(); } });
  $('exportButton').addEventListener('click', () => { updateFilename(); $('exportDialog').showModal(); });
  $('exportForm').addEventListener('submit', downloadExcel);
  $('cancelExport').addEventListener('click', () => $('exportDialog').close());
  $('exportProvince').addEventListener('input', updateFilename);
  $('exportTags').addEventListener('input', updateFilename);
  $('excludeExported').addEventListener('change', () => { state.page = 1; void searchCandidates(); });
  $('closeCv').addEventListener('click', () => $('cvDialog').close());
  $('cvDialog').addEventListener('close', () => {
    $('cvFrame').src = 'about:blank';
    $('cvFrame').hidden = true;
    $('openCvTab').hidden = true;
    if (activeCvObjectUrl) URL.revokeObjectURL(activeCvObjectUrl);
    activeCvObjectUrl = null;
  });
});

