document.addEventListener("DOMContentLoaded", function() {
    const voiceSelect = document.getElementById("voice-select");
    const speedRange = document.getElementById("speed-range");
    const speedValue = document.getElementById("speed-value");
    const volumeRange = document.getElementById("volume-range");
    const volumeValue = document.getElementById("volume-value");
    const naturalPauses = document.getElementById("natural-pauses");
    const emotionalTone = document.getElementById("emotional-tone");
    const autoTranslate = document.getElementById("auto-translate");
    const statusDiv = document.getElementById("status");
    const videoStateSpan = document.getElementById("video-state");
    const ttsToggle = document.getElementById("tts-toggle");
    
    // Update TTS status in popup
    function updateTTSStatus() {
        chrome.runtime.sendMessage({ message: "getTTSStatus" }, function(response) {
            if (response) {
                // Update checkbox state
                ttsToggle.checked = response.isActive;
                
                // Update status text
                if (response.isActive) {
                    statusDiv.textContent = response.isSpeaking ? "🗣️ Speaking" : "▶️ Active (waiting)";
                    statusDiv.className = "active";
                } else {
                    statusDiv.textContent = "⏹️ Stopped";
                    statusDiv.className = "inactive";
                }
            }
        });
    }
    
    // Update TTS status every second
    setInterval(updateTTSStatus, 1000);
    updateTTSStatus();
    
    // Check video state
    function checkVideoState() {
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
            if (tabs[0]) {
                chrome.scripting.executeScript({
                    target: {tabId: tabs[0].id},
                    function: function() {
                        let videoElement = document.querySelector('video');
                        if (videoElement) {
                            return !videoElement.paused && !videoElement.ended;
                        }
                        return false;
                    }
                }, (results) => {
                    if (results && results[0]) {
                        const isPlaying = results[0].result;
                        if (videoStateSpan) {
                            videoStateSpan.textContent = isPlaying ? "▶️ Playing" : "⏸️ Paused";
                            videoStateSpan.style.color = isPlaying ? "#10b981" : "#fbbf24";
                        }
                    }
                });
            }
        });
    }
    
    // Check video state every 2 seconds
    setInterval(checkVideoState, 2000);
    checkVideoState();
    
    // Load available voices
    function loadVoices() {
        chrome.tts.getVoices(function(voices) {
            voiceSelect.innerHTML = '<option value="">System default voice</option>';
            
            // Filter Spanish voices
            const spanishVoices = voices.filter(voice => 
                voice.lang && voice.lang.startsWith('es')
            );
            
            // Add Spanish voices
            spanishVoices.forEach(voice => {
                const option = document.createElement('option');
                option.value = voice.voiceName;
                option.textContent = `${voice.voiceName} (${voice.lang})`;
                voiceSelect.appendChild(option);
            });
            
            // If no Spanish voices, show all voices
            if (spanishVoices.length === 0) {
                voices.forEach(voice => {
                    const option = document.createElement('option');
                    option.value = voice.voiceName;
                    option.textContent = `${voice.voiceName} (${voice.lang || 'default'})`;
                    voiceSelect.appendChild(option);
                });
            }
            
            // Load saved settings
            chrome.storage.sync.get([
                'selectedVoice', 'speechRate', 'volume', 'naturalPauses', 'emotionalTone', 'autoTranslate'
            ], function(data) {
                if (data.selectedVoice) voiceSelect.value = data.selectedVoice;
                if (data.speechRate) {
                    speedRange.value = data.speechRate;
                    speedValue.textContent = data.speechRate;
                }
                if (data.volume !== undefined) {
                    volumeRange.value = data.volume;
                    volumeValue.textContent = data.volume;
                }
                if (data.naturalPauses !== undefined) naturalPauses.checked = data.naturalPauses;
                if (data.emotionalTone !== undefined) emotionalTone.checked = data.emotionalTone;
                if (data.autoTranslate !== undefined) autoTranslate.checked = data.autoTranslate;
            });
        });
    }
    
    // Load voices on startup
    loadVoices();
    
    // Reload voices if they change
    if (window.speechSynthesis) {
        window.speechSynthesis.onvoiceschanged = loadVoices;
    }
    
    // Save voice selection
    voiceSelect.addEventListener("change", function() {
        chrome.storage.sync.set({ selectedVoice: voiceSelect.value });
        chrome.runtime.sendMessage({ 
            message: "updateSettings",
            voice: voiceSelect.value 
        });
    });
    
    // Update speed display in real-time
    speedRange.addEventListener("input", function() {
        speedValue.textContent = speedRange.value;
    });
    
    // Save speed when slider is released
    speedRange.addEventListener("change", function() {
        chrome.storage.sync.set({ speechRate: parseFloat(speedRange.value) });
        chrome.runtime.sendMessage({ 
            message: "updateSettings",
            rate: parseFloat(speedRange.value)
        });
    });
    
    // Update volume display
    volumeRange.addEventListener("input", function() {
        volumeValue.textContent = volumeRange.value;
    });
    
    // Save volume
    volumeRange.addEventListener("change", function() {
        chrome.storage.sync.set({ volume: parseFloat(volumeRange.value) });
        chrome.runtime.sendMessage({ 
            message: "updateSettings",
            volume: parseFloat(volumeRange.value)
        });
    });
    
    // Natural pauses
    naturalPauses.addEventListener("change", function() {
        chrome.storage.sync.set({ naturalPauses: naturalPauses.checked });
        chrome.runtime.sendMessage({ 
            message: "updateSettings",
            naturalPauses: naturalPauses.checked
        });
    });
    
    // Emotional tone
    emotionalTone.addEventListener("change", function() {
        chrome.storage.sync.set({ emotionalTone: emotionalTone.checked });
        chrome.runtime.sendMessage({ 
            message: "updateSettings",
            emotionalTone: emotionalTone.checked
        });
    });
    
    // Auto-translate
    autoTranslate.addEventListener("change", function() {
        chrome.storage.sync.set({ autoTranslate: autoTranslate.checked });
        chrome.runtime.sendMessage({ 
            message: "updateSettings",
            autoTranslate: autoTranslate.checked
        });
    });
    
    // TTS Toggle checkbox
    ttsToggle.addEventListener("change", function() {
        if (ttsToggle.checked) {
            // Start TTS
            chrome.runtime.sendMessage({ 
                message: "startTTS",
                voice: voiceSelect.value,
                rate: parseFloat(speedRange.value),
                volume: parseFloat(volumeRange.value),
                naturalPauses: naturalPauses.checked,
                emotionalTone: emotionalTone.checked,
                autoTranslate: autoTranslate.checked
            }, function(response) {
                if (response && response.isActive) {
                    statusDiv.textContent = "▶️ Active";
                    statusDiv.className = "active";
                }
            });
        } else {
            // Stop TTS
            chrome.runtime.sendMessage({ message: "stopTTS" }, function(response) {
                statusDiv.textContent = "⏹️ Stopped";
                statusDiv.className = "inactive";
            });
        }
    });
});
