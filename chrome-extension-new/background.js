// Background Service Worker for Calendar Extension

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// Set side panel behavior
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Handle installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('Calendar extension installed');
  } else if (details.reason === 'update') {
    console.log('Calendar extension updated');
  }
});

// Periodic alarm for syncing events
chrome.alarms.create('syncEvents', { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'syncEvents') {
    // Trigger sync in all open side panels
    chrome.runtime.sendMessage({ type: 'SYNC_EVENTS' }).catch(() => {
      // Ignore errors if no panels are open
    });
  }
});

// Handle messages from side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_EVENTS') {
    // Handle get events request
    sendResponse({ success: true });
  }
  return true;
});
