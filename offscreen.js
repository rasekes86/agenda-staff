// Offscreen document for audio playback
// This allows playing audio from a service worker

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PLAY_SOUND') {
    playSound(message.sound);
    sendResponse({ success: true });
  }
  return true;
});

function playSound(soundType) {
  const audioId = 'audio' + soundType.charAt(0).toUpperCase() + soundType.slice(1);
  const audio = document.getElementById(audioId) || document.getElementById('audioBell');
  
  if (audio) {
    audio.currentTime = 0;
    audio.play().catch(err => {
      console.error('Error playing sound:', err);
    });
  }
}
