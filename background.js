// Background Service Worker for AGENDA STAFF
// v5.23.20 - Con notificaciones (excluye eventos completados)

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// Set side panel behavior
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// ============================================
// CONSTANTS
// ============================================
const NOTIFICATION_CHECK_INTERVAL_MS = 30000;  // Check notifications every 30s
const MIDNIGHT_CLEANUP_INTERVAL_MS = 60000;    // Check for midnight every 60s
const BADGE_DISPLAY_DURATION_MS = 3000;        // Show badge icon for 3s
const NOTIFICATION_WINDOW_MINUTES = 1;         // Only notify within 1-minute window
const WHITE_TOLERANCE = 25;                    // Screenshot white removal tolerance

// ============================================
// NOTIFICATION SYSTEM
// ============================================

let notificationCheckInterval = null;
let scheduledEvents = [];
let notifiedEvents = new Set();

// Listen for messages from sidepanel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'START_NOTIFICATION_CHECK') {
    startNotificationCheck();
    sendResponse({ success: true });
    return true;
  }
  
  if (message.type === 'SCHEDULE_NOTIFICATIONS') {
    // Only schedule events that are NOT completed
    scheduledEvents = message.events.filter(ev => !ev.completed);
    console.log('Scheduled events (excluding completed):', scheduledEvents.length);
    sendResponse({ success: true });
    return true;
  }
  
  if (message.type === 'TEST_NOTIFICATION') {
    showTestNotification(message.title);
    sendResponse({ success: true });
    return true;
  }
  
  if (message.type === 'START_SCREENSHOT') {
    handleStartScreenshot();
    sendResponse({ success: true });
    return true;
  }
  
  if (message.type === 'CAPTURE_AREA') {
    captureAndProcessArea(message.rect)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  
  if (message.type === 'SCREENSHOT_CANCELLED') {
    notifySidepanel({ type: 'SCREENSHOT_CANCELLED' });
    sendResponse({ success: true });
    return true;
  }
  
  if (message.type === 'SCREENSHOT_ERROR') {
    notifySidepanel({ type: 'SCREENSHOT_ERROR', error: message.error });
    sendResponse({ success: true });
    return true;
  }
});

function startNotificationCheck() {
  // Clear existing interval
  if (notificationCheckInterval) {
    clearInterval(notificationCheckInterval);
  }
  
  // Check every 30 seconds
  notificationCheckInterval = setInterval(checkNotifications, NOTIFICATION_CHECK_INTERVAL_MS);
  
  // Also check immediately
  checkNotifications();
  
  console.log('Notification check started');
}

async function checkNotifications() {
  // Load notification settings
  const stored = await chrome.storage.local.get(['notificationSettings']);
  const settings = stored.notificationSettings || { enabled: true, minutesBefore: 5 };
  
  if (!settings.enabled) return;
  
  const now = new Date();
  const currentTime = now.getHours() * 60 + now.getMinutes();
  const currentDate = formatDate(now);
  
  for (const event of scheduledEvents) {
    // Skip if already notified or if completed
    if (notifiedEvents.has(event.id) || event.completed) continue;
    
    // Check if event is today
    if (event.date !== currentDate) continue;
    
    // Parse event time
    if (!event.time) continue;
    const [hours, minutes] = event.time.split(':').map(Number);
    const eventTime = hours * 60 + minutes;
    const notifyTime = eventTime - settings.minutesBefore;
    
    // Check if it's time to notify (within 1 minute window)
    if (currentTime >= notifyTime && currentTime <= notifyTime + NOTIFICATION_WINDOW_MINUTES) {
      await showEventNotification(event, settings);
      notifiedEvents.add(event.id);
    }
  }
  
  // Clear old notified events at midnight
  if (now.getHours() === 0 && now.getMinutes() === 0) {
    notifiedEvents.clear();
  }
}

async function showEventNotification(event, settings) {
  // Check notification permission before creating
  try {
    const hasPermission = await chrome.permissions.contains({ permissions: ['notifications'] });
    if (!hasPermission) {
      console.log('Notification permission not granted, skipping notification');
      return;
    }
  } catch (err) {
    console.log('Could not check notification permission:', err);
    return;
  }
  
  // Create Chrome notification
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: '📅 Recordatorio: ' + event.title,
    message: `A las ${formatTime(event.time)} - ${event.title}`,
    priority: 2,
    requireInteraction: true
  });
  
  // Play sound via offscreen document
  if (settings.sound !== 'none') {
    await playNotificationSound(settings.sound);
  }
  
  // Send to sidepanel for banner
  try {
    await chrome.runtime.sendMessage({
      type: 'SHOW_REMINDER',
      event: event
    });
  } catch (err) {
    console.log('Could not send to sidepanel');
  }
}

function showTestNotification(title) {
  // Check notification permission before creating
  chrome.permissions.contains({ permissions: ['notifications'] }, (granted) => {
    if (!granted) {
      console.log('Notification permission not granted');
      return;
    }
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: title || '🔔 Prueba de notificación',
      message: 'Las notificaciones están funcionando correctamente',
      priority: 2
    });

    playNotificationSound('bell');
  });
}

async function playNotificationSound(soundType) {
  // Create offscreen document for audio playback
  try {
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT']
    });
    
    if (existingContexts.length === 0) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['AUDIO_PLAYBACK'],
        justification: 'Reproducir sonido de notificación'
      });
    }
    
    await chrome.runtime.sendMessage({ type: 'PLAY_SOUND', sound: soundType });
  } catch (err) {
    console.log('Could not play sound:', err);
  }
}

// ============================================
// SCREENSHOT FUNCTIONALITY
// ============================================

async function handleStartScreenshot() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab || !tab.id) {
      throw new Error('No hay pestaña activa');
    }
    
    // Check if tab.url exists before using startsWith
    if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://'))) {
      throw new Error('No se puede capturar páginas de Chrome');
    }
    
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['screenshot-selector.js']
    });
    
  } catch (err) {
    console.error('Error starting screenshot:', err);
    notifySidepanel({ type: 'SCREENSHOT_ERROR', error: err.message });
  }
}

async function captureAndProcessArea(rect) {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
    
    if (!dataUrl) {
      throw new Error('No se pudo capturar la pantalla');
    }
    
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    
    const img = await createImageBitmap(blob);
    
    const canvas = new OffscreenCanvas(rect.width, rect.height);
    const ctx = canvas.getContext('2d');
    
    ctx.drawImage(
      img,
      rect.x, rect.y, rect.width, rect.height,
      0, 0, rect.width, rect.height
    );
    
    const imageData = ctx.getImageData(0, 0, rect.width, rect.height);
    const data = imageData.data;
    
    const tolerance = WHITE_TOLERANCE;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      
      if (r > 255 - tolerance && g > 255 - tolerance && b > 255 - tolerance) {
        data[i + 3] = 0;
      }
    }
    
    ctx.putImageData(imageData, 0, 0);
    
    const resultBlob = await canvas.convertToBlob({ type: 'image/png' });
    
    const reader = new FileReader();
    const base64 = await new Promise((resolve, reject) => {
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Error leyendo blob'));
      reader.readAsDataURL(resultBlob);
    });
    
    notifySidepanel({ type: 'SCREENSHOT_RESULT', dataUrl: base64 });
    
    return { success: true };
    
  } catch (err) {
    console.error('Error capturing area:', err);
    throw err;
  }
}

async function notifySidepanel(message) {
  try {
    await chrome.runtime.sendMessage(message);
  } catch (err) {
    console.log('Could not notify sidepanel:', err.message);
  }
}

// ============================================
// CONTEXT MENU
// ============================================

chrome.runtime.onInstalled.addListener(() => {
  console.log('AGENDA STAFF v5.23.20 instalada');
  
  chrome.contextMenus.create({
    id: "sendToAgenda",
    title: "Enviar a AGENDA STAFF",
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "sendToAgenda") {
    const stored = await chrome.storage.local.get(['session', 'user']);
    
    if (!stored.session || !stored.user) {
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
      setTimeout(() => chrome.action.setBadgeText({ text: '' }), BADGE_DISPLAY_DURATION_MS);
      return;
    }
    
    const selectedText = info.selectionText.trim();
    sendToSupabase(selectedText, stored.session.access_token, stored.user.id, stored.user.name);
  }
});

function detectDate(text) {
  const lowerText = text.toLowerCase();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  if (lowerText.includes('hoy') || lowerText.includes('today')) {
    return formatDate(today);
  }
  
  if (lowerText.includes('mañana') || lowerText.includes('manana') || lowerText.includes('tomorrow')) {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return formatDate(tomorrow);
  }
  
  if (lowerText.includes('pasado mañana') || lowerText.includes('pasado manana')) {
    const dayAfter = new Date(today);
    dayAfter.setDate(dayAfter.getDate() + 2);
    return formatDate(dayAfter);
  }
  
  const days = {
    'domingo': 0, 'sunday': 0,
    'lunes': 1, 'monday': 1,
    'martes': 2, 'tuesday': 2,
    'miércoles': 3, 'miercoles': 3, 'wednesday': 3,
    'jueves': 4, 'thursday': 4,
    'viernes': 5, 'friday': 5,
    'sábado': 6, 'sabado': 6, 'saturday': 6
  };
  
  for (const [dayName, dayNum] of Object.entries(days)) {
    if (lowerText.includes(dayName)) {
      const result = new Date(today);
      const currentDay = result.getDay();
      let daysUntil = dayNum - currentDay;
      if (daysUntil <= 0) daysUntil += 7;
      result.setDate(result.getDate() + daysUntil);
      return formatDate(result);
    }
  }
  
  return formatDate(today);
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatTime(time) {
  if (!time) return '';
  const [h, m] = time.split(':');
  const hr = parseInt(h);
  const ap = hr >= 12 ? 'PM' : 'AM';
  return `${hr % 12 || 12}:${m} ${ap}`;
}

async function sendToSupabase(content, accessToken, userId, userName) {
  const SUPABASE_URL = 'https://iugutcsukxkxlgpkmzxt.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1Z3V0Y3N1a3hreGxncGttenh0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzc5OTExMjksImV4cCI6MjA1MzU2NzEyOX0.PpolAzqqXNBOhRlUVzplqkKeGQxzfed4gH377CidVJE';
  
  const detectedDate = detectDate(content);
  
  const emailMatch = content.match(/[\w.-]+@[\w.-]+\.\w+/);
  const phoneMatch = content.match(/[\+]?[(]?[0-9]{1,4}[)]?[-\s.]?[0-9]{1,4}[-\s.]?[0-9]{1,4}[-\s.]?[0-9]{1,9}/);
  
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
  
  const eventData = {
    id: id,
    title: content,
    date: detectedDate,
    description: content,
    color: emailMatch ? '#10b981' : (phoneMatch ? '#f59e0b' : '#8b5cf6'),
    completed: false,
    user_id: userId,
    user_name: userName || 'Usuario'
  };
  
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/calendar_events`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(eventData)
    });
    
    if (res.ok) {
      chrome.action.setBadgeText({ text: '✓' });
      chrome.action.setBadgeBackgroundColor({ color: '#10b981' });
      setTimeout(() => chrome.action.setBadgeText({ text: '' }), BADGE_DISPLAY_DURATION_MS);
    } else {
      throw new Error('Error saving');
    }
  } catch (err) {
    console.error('Error sending to Supabase:', err);
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
    setTimeout(() => chrome.action.setBadgeText({ text: '' }), BADGE_DISPLAY_DURATION_MS);
  }
}

// Clean up old notified events periodically
setInterval(() => {
  const now = new Date();
  if (now.getHours() === 0 && now.getMinutes() === 0) {
    notifiedEvents.clear();
    console.log('Cleared notified events for new day');
  }
}, MIDNIGHT_CLEANUP_INTERVAL_MS);
