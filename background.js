let isSpeaking = false;
let lastSubtitle = "";
let isTTSActive = false;
let wasVideoPaused = false; // Track if video was paused
let udemyTabId = null; // Store the Udemy tab ID

// TTS settings (default values)
let ttsSettings = {
    voice: null,
    rate: 1.5,
    volume: 1.0,
    naturalPauses: true,
    emotionalTone: true,
    autoTranslate: true // Auto-translate to Spanish
};

// Load saved settings on startup
chrome.storage.sync.get([
    'selectedVoice', 'speechRate', 'volume', 'naturalPauses', 'emotionalTone', 'autoTranslate'
], function(data) {
    if (data.selectedVoice) ttsSettings.voice = data.selectedVoice;
    if (data.speechRate) ttsSettings.rate = data.speechRate;
    if (data.volume !== undefined) ttsSettings.volume = data.volume;
    if (data.naturalPauses !== undefined) ttsSettings.naturalPauses = data.naturalPauses;
    if (data.emotionalTone !== undefined) ttsSettings.emotionalTone = data.emotionalTone;
    if (data.autoTranslate !== undefined) ttsSettings.autoTranslate = data.autoTranslate;
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
        if (request.autoTranslate !== undefined) ttsSettings.autoTranslate = request.autoTranslate;
        
        // Find and store Udemy tab ID
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
            if (tabs[0] && tabs[0].url && tabs[0].url.includes('udemy.com')) {
                udemyTabId = tabs[0].id;
                console.log('TTS started on Udemy tab:', udemyTabId);
            } else {
                // Not on Udemy tab, search for any Udemy tab
                findUdemyTab();
            }
            speakSubtitle();
        });
        
        sendResponse({ isActive: true });
    } else if (request.message === "stopTTS") {
        isTTSActive = false;
        chrome.tts.stop();
        isSpeaking = false;
        wasVideoPaused = false; // Reset pause state
        lastSubtitle = ""; // Reset last subtitle
        udemyTabId = null; // Clear tab ID
        sendResponse({ isActive: false });
    } else if (request.message === "updateSettings") {
        // Update settings in real-time
        if (request.voice !== undefined) ttsSettings.voice = request.voice || null;
        if (request.rate) ttsSettings.rate = request.rate;
        if (request.volume !== undefined) ttsSettings.volume = request.volume;
        if (request.naturalPauses !== undefined) ttsSettings.naturalPauses = request.naturalPauses;
        if (request.emotionalTone !== undefined) ttsSettings.emotionalTone = request.emotionalTone;
        if (request.autoTranslate !== undefined) ttsSettings.autoTranslate = request.autoTranslate;
    } else if (request.message === "getTTSStatus") {
        // Get current TTS status
        sendResponse({ isActive: isTTSActive, isSpeaking: isSpeaking });
    }
    
    return true; // Keep channel open for async sendResponse
});

function fetchSubtitle(callback) {
    // Use stored Udemy tab ID, or fallback to active tab
    if (udemyTabId) {
        chrome.tabs.get(udemyTabId, function(tab) {
            if (chrome.runtime.lastError || !tab) {
                // Tab was closed or doesn't exist, try to find Udemy tab
                console.log('Stored tab not found, searching for Udemy tab...');
                findUdemyTab(callback);
                return;
            }
            
            executeScriptOnTab(udemyTabId, callback);
        });
    } else {
        // No tab stored, find Udemy tab
        findUdemyTab(callback);
    }
}

function findUdemyTab(callback) {
    chrome.tabs.query({url: "https://www.udemy.com/*"}, function(tabs) {
        if (tabs && tabs.length > 0) {
            udemyTabId = tabs[0].id;
            console.log('Found Udemy tab:', udemyTabId);
            if (callback) executeScriptOnTab(udemyTabId, callback);
        } else {
            console.log('No Udemy tab found');
            if (callback) callback({data: null});
        }
    });
}

function executeScriptOnTab(tabId, callback) {
    chrome.scripting.executeScript({
        target: {tabId: tabId},
        function: getSubtitleAndVideoState,
    }, (injectionResults) => {
        if (chrome.runtime.lastError) {
            console.error('Script injection error:', chrome.runtime.lastError);
            callback({data: null});
            return;
        }
        
        if (injectionResults && injectionResults.length > 0) {
            callback({data: injectionResults[0].result});
        } else {
            callback({data: null});
        }
    });
}

function getSubtitleAndVideoState() {
    let subtitleText = null;
    let isPlaying = false;
    
    // Udemy subtitles
    let activeSubtitleElement = document.querySelector('[data-purpose="transcript-cue-active"] > [data-purpose="cue-text"]');
    if (activeSubtitleElement) {
        subtitleText = activeSubtitleElement.innerText;
    }
    
    // Detect if video is playing
    let videoElement = document.querySelector('video');
    if (videoElement) {
        isPlaying = !videoElement.paused && !videoElement.ended && videoElement.readyState > 2;
    }
    
    return {
        text: subtitleText,
        isVideoPlaying: isPlaying
    };
}

// Translate text to Spanish using MyMemory API
async function translateToSpanish(text) {
    if (!text || !ttsSettings.autoTranslate) return text;
    
    try {
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|es`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.responseData && data.responseData.translatedText) {
            let translatedText = data.responseData.translatedText;
            
            // Filter out MyMemory warning messages
            if (translatedText.includes('MYMEMORY WARNING') || 
                translatedText.includes('MyMemory Warning') ||
                translatedText.includes('YOU USED ALL AVAILABLE FREE TRANSLATIONS')) {
                console.warn('MyMemory API limit reached, using original text');
                return text; // Return original text instead of warning
            }
            
            console.log('Original:', text);
            console.log('Translated:', translatedText);
            return translatedText;
        }
        
        return text; // Return original if translation fails
    } catch (error) {
        console.error('Translation error:', error);
        return text; // Return original on error
    }
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

    fetchSubtitle(function(response) {
        if (response && response.data) {
            let subtitleText = response.data.text;
            let isVideoPlaying = response.data.isVideoPlaying;
            
            // If video is not playing, pause TTS and wait
            if (!isVideoPlaying) {
                if (!wasVideoPaused) {
                    console.log('Video paused - TTS waiting');
                    chrome.tts.stop();
                    isSpeaking = false;
                    wasVideoPaused = true;
                }
                return;
            }
            
            // If video just resumed from pause, reset state
            if (wasVideoPaused && isVideoPlaying) {
                console.log('Video resumed - resetting subtitle tracking');
                lastSubtitle = "";
                wasVideoPaused = false;
            }
            
            // If no subtitle text, wait
            if (!subtitleText) {
                return;
            }
            
            // If same subtitle, skip
            if (subtitleText === lastSubtitle) {
                return;
            }
            
            // New subtitle detected - speak immediately
            lastSubtitle = subtitleText;
            isSpeaking = true;
            
            console.log('New subtitle:', subtitleText);
            
            // Translate and speak immediately (no buffer)
            if (ttsSettings.autoTranslate) {
                translateToSpanish(subtitleText).then(translatedText => {
                    processAndSpeak(translatedText);
                });
            } else {
                processAndSpeak(subtitleText);
            }
        }
    });
}

function processAndSpeak(text) {
    // Improve text for more natural speech
    const improvedText = improveTextForSpeech(text);

    // Build TTS options
    const speakOptions = {
        rate: ttsSettings.rate,
        volume: ttsSettings.volume,
        lang: 'es-ES', // Always Spanish
        enqueue: false, // Changed back to false for immediate response
        onEvent: function(event) {
            if (event.type === 'start') {
                console.log('Speaking:', improvedText);
            } else if (event.type === 'end') {
                console.log('Finished speaking');
                isSpeaking = false;
            } else if (event.type === 'error') {
                console.error('TTS error:', event);
                isSpeaking = false;
            } else if (event.type === 'interrupted') {
                console.log('TTS interrupted');
                isSpeaking = false;
            }
        }
    };
    
    // Add voice name only if specific voice selected
    if (ttsSettings.voice) {
        speakOptions.voiceName = ttsSettings.voice;
    }
    
    chrome.tts.speak(improvedText, speakOptions);
}

chrome.action.onClicked.addListener((tab) => {
});

// Listen for tab closure to clear stored tab ID
chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId === udemyTabId) {
        console.log('Udemy tab closed, stopping TTS');
        isTTSActive = false;
        chrome.tts.stop();
        isSpeaking = false;
        udemyTabId = null;
    }
});

// Check for new subtitles
setInterval(() => {
    if (isTTSActive && !isSpeaking) {
        speakSubtitle();
    }
}, 500); // Intervalo de chequeo cada 500ms
