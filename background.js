let isSpeaking = false;
let lastSubtitle = "";
let isTTSActive = false;
let wasVideoPaused = false; // Track if video was paused

// TTS settings (default values)
let ttsSettings = {
    voice: null,
    rate: 1.5,
    volume: 1.0,
    naturalPauses: true,
    emotionalTone: true
};

// Load saved settings on startup
chrome.storage.sync.get([
    'selectedVoice', 'speechRate', 'volume', 'naturalPauses', 'emotionalTone'
], function(data) {
    if (data.selectedVoice) ttsSettings.voice = data.selectedVoice;
    if (data.speechRate) ttsSettings.rate = data.speechRate;
    if (data.volume !== undefined) ttsSettings.volume = data.volume;
    if (data.naturalPauses !== undefined) ttsSettings.naturalPauses = data.naturalPauses;
    if (data.emotionalTone !== undefined) ttsSettings.emotionalTone = data.emotionalTone;
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.message === "startTTS") {
        isTTSActive = true;
        
        // Update settings if provided
        if (request.voice !== undefined) ttsSettings.voice = request.voice || null;
        if (request.rate) ttsSettings.rate = request.rate;
        if (request.volume !== undefined) ttsSettings.volume = request.volume;
        if (request.naturalPauses !== undefined) ttsSettings.naturalPauses = request.naturalPauses;
        if (request.emotionalTone !== undefined) ttsSettings.emotionalTone = request.emotionalTone;
        
        speakSubtitle();
        sendResponse({ isActive: true });
    } else if (request.message === "stopTTS") {
        isTTSActive = false;
        chrome.tts.stop();
        isSpeaking = false;
        wasVideoPaused = false; // Reset pause state
        lastSubtitle = ""; // Reset last subtitle
        sendResponse({ isActive: false });
    } else if (request.message === "updateSettings") {
        // Update settings in real-time
        if (request.voice !== undefined) ttsSettings.voice = request.voice || null;
        if (request.rate) ttsSettings.rate = request.rate;
        if (request.volume !== undefined) ttsSettings.volume = request.volume;
        if (request.naturalPauses !== undefined) ttsSettings.naturalPauses = request.naturalPauses;
        if (request.emotionalTone !== undefined) ttsSettings.emotionalTone = request.emotionalTone;
    } else if (request.message === "getTTSStatus") {
        // Get current TTS status
        sendResponse({ isActive: isTTSActive, isSpeaking: isSpeaking });
    }
    
    return true; // Keep channel open for async sendResponse
});

function fetchSubtitle(callback) {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        let activeTab = tabs[0];
        if (!activeTab) return;

        chrome.scripting.executeScript({
            target: {tabId: activeTab.id},
            function: getSubtitleAndVideoState,
        }, (injectionResults) => {
            if (injectionResults && injectionResults.length > 0) {
                callback({data: injectionResults[0].result});
            }
        });
    });
}

function getSubtitleAndVideoState() {
    // Get active subtitle
    let activeSubtitleElement = document.querySelector('[data-purpose="transcript-cue-active"] > [data-purpose="cue-text"]');
    let subtitleText = activeSubtitleElement ? activeSubtitleElement.innerText : null;
    
    // Detect if video is playing
    let videoElement = document.querySelector('video');
    let isPlaying = false;
    
    if (videoElement) {
        isPlaying = !videoElement.paused && !videoElement.ended && videoElement.readyState > 2;
    }
    
    return {
        text: subtitleText,
        isVideoPlaying: isPlaying
    };
}

// Improve text for more natural speech
function improveTextForSpeech(text) {
    if (!text) return text;
    
    let improvedText = text;
    
    // Add natural pauses
    if (ttsSettings.naturalPauses) {
        improvedText = improvedText.replace(/\./g, '... ');
        improvedText = improvedText.replace(/,/g, ', ');
        improvedText = improvedText.replace(/;/g, '; ');
        improvedText = improvedText.replace(/:/g, ': ');
        improvedText = improvedText.replace(/\(/g, ' ( ');
        improvedText = improvedText.replace(/\)/g, ' ) ');
    }
    
    // Improve emotional tone
    if (ttsSettings.emotionalTone) {
        improvedText = improvedText.replace(/!/g, ' ! ');
        improvedText = improvedText.replace(/\?/g, ' ? ');
        improvedText = improvedText.replace(/\b([A-Z]{2,})\b/g, ' $1 ');
    }
    
    // Clean multiple spaces
    improvedText = improvedText.replace(/\s+/g, ' ').trim();
    
    return improvedText;
}

function speakSubtitle() {
    if (!isTTSActive || isSpeaking) return;

    isSpeaking = true;
    fetchSubtitle(function(response) {
        if (response && response.data) {
            let subtitleText = response.data.text;
            let isVideoPlaying = response.data.isVideoPlaying;
            
            // If video is not playing, pause TTS and wait
            if (!isVideoPlaying) {
                console.log('Video paused - TTS waiting');
                chrome.tts.stop();
                isSpeaking = false;
                wasVideoPaused = true; // Mark that video was paused
                if (isTTSActive) {
                    setTimeout(speakSubtitle, 1000);
                }
                return;
            }
            
            // If video just resumed from pause, reset lastSubtitle to force re-reading
            if (wasVideoPaused && isVideoPlaying) {
                console.log('Video resumed - resetting subtitle tracking');
                lastSubtitle = ""; // Reset to allow current subtitle to be read
                wasVideoPaused = false;
            }
            
            // If no subtitle text, wait
            if (!subtitleText) {
                isSpeaking = false;
                if (isTTSActive) {
                    setTimeout(speakSubtitle, 500);
                }
                return;
            }
            
            // If same subtitle, wait for next one
            if (subtitleText === lastSubtitle) {
                isSpeaking = false;
                if (isTTSActive) {
                    setTimeout(speakSubtitle, 100);
                }
                return;
            }
            
            lastSubtitle = subtitleText;

            // Improve text for more natural speech
            const improvedText = improveTextForSpeech(subtitleText);

            // Build TTS options
            const speakOptions = {
                rate: ttsSettings.rate,
                volume: ttsSettings.volume,
                lang: 'es-ES', // Always Spanish
                enqueue: false,
                onEvent: function(event) {
                    if (event.type === 'start') {
                        console.log('Speaking:', improvedText);
                    } else if (event.type === 'end') {
                        isSpeaking = false;
                        if (isTTSActive) {
                            setTimeout(speakSubtitle, 100);
                        }
                    } else if (event.type === 'error') {
                        console.error('TTS error:', event);
                        isSpeaking = false;
                        if (isTTSActive) {
                            setTimeout(speakSubtitle, 500);
                        }
                    } else if (event.type === 'interrupted') {
                        console.log('TTS interrupted');
                        isSpeaking = false;
                        if (isTTSActive) {
                            setTimeout(speakSubtitle, 300);
                        }
                    }
                }
            };
            
            // Add voice name only if specific voice selected
            if (ttsSettings.voice) {
                speakOptions.voiceName = ttsSettings.voice;
            }
            
            chrome.tts.speak(improvedText, speakOptions);
        } else {
            isSpeaking = false;
            if (isTTSActive) {
                setTimeout(speakSubtitle, 500);
            }
        }
    });
}

chrome.action.onClicked.addListener((tab) => {
});

// Check for new subtitles every second
setInterval(() => {
    if (isTTSActive && !isSpeaking) {
        speakSubtitle();
    }
}, 1000);
