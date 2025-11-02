let isSpeaking = false;
let lastSubtitle = ""; // stores a normalized key of the last spoken subtitle
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
    lastSubtitle = ""; // Reset last subtitle key
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
        target: { tabId, allFrames: true },
        function: getSubtitleAndVideoState,
        world: 'MAIN'
    }, (injectionResults) => {
        if (chrome.runtime.lastError) {
            console.error('Script injection error:', chrome.runtime.lastError);
            callback({ data: null });
            return;
        }

        if (injectionResults && injectionResults.length > 0) {
            // Prefer results with transcript, then captions, else propagate playing state
            let best = null;
            let anyPlaying = false;
            for (const r of injectionResults) {
                const res = r.result || {};
                if (res && res.isVideoPlaying) anyPlaying = true;
                if (res && res.transcriptText) {
                    best = res;
                    break;
                }
                if (!best && res && res.captionText) {
                    best = res;
                }
            }

            if (!best) {
                best = { isVideoPlaying: anyPlaying };
            } else {
                best.isVideoPlaying = best.isVideoPlaying || anyPlaying;
            }

            callback({ data: best });
        } else {
            callback({ data: null });
        }
    });
}

function getSubtitleAndVideoState() {
    let transcriptText = null;
    let captionText = null;
    let isPlaying = false;

    // Try to read transcript panel (when it's open)
    const activeSubtitleElement = document.querySelector('[data-purpose="transcript-cue-active"] > [data-purpose="cue-text"]');
    if (activeSubtitleElement) {
        transcriptText = activeSubtitleElement.innerText;
    }

    // Detect if video is playing and try grabbing on-screen captions from textTracks
    const videoElement = document.querySelector('video');
    if (videoElement) {
        isPlaying = !videoElement.paused && !videoElement.ended && videoElement.readyState > 2;

        // Read active cues from any showing text track (closed captions/subtitles)
        try {
            const tracks = Array.from(videoElement.textTracks || []);
            // Ensure tracks can populate activeCues
            for (const track of tracks) {
                if ((track.kind === 'subtitles' || track.kind === 'captions') && track.mode === 'disabled') {
                    track.mode = 'hidden';
                }
            }
            // Prefer tracks that are currently showing or hidden
            const showingTracks = tracks.filter(t => t.mode === 'showing' || t.mode === 'hidden');
            const candidateTracks = showingTracks.length ? showingTracks : tracks;
            for (const track of candidateTracks) {
                const cues = track.activeCues ? Array.from(track.activeCues) : [];
                if (cues.length) {
                    // Join all active cues' text, trimming whitespace
                    const parts = cues.map(c => (c.text || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
                    if (parts.length) {
                        captionText = parts.join(' ').trim();
                        break;
                    }
                }
            }
        } catch (e) {
            // Swallow errors from inaccessible tracks
        }

        // DOM fallback: try to read common caption overlay containers (e.g., video.js)
        if (!captionText) {
            try {
                const isInsideTranscript = (el) => !!el.closest('[data-purpose="transcript"]');
                const selectors = [
                    '.vjs-text-track-display',
                    '.vjs-text-track-cue',
                    '.vjs-caption-subtitles',
                    '[class*="caption"]',
                    '[class*="Caption"]',
                    '[class*="subtitle"]',
                    '[class*="Subtitle"]',
                    '[data-purpose="captions"]',
                    '[data-purpose="video-player"] .captions',
                    '[data-purpose="video-player"] [class*="subtitle"]',
                    '[data-purpose="captions-overlay"]',
                    '[data-purpose="captions-container"]',
                    'span.captions-display__caption'
                ];
                for (const sel of selectors) {
                    const nodes = Array.from(document.querySelectorAll(sel));
                    for (const n of nodes) {
                        if (!n) continue;
                        if (isInsideTranscript(n)) continue;
                        const style = window.getComputedStyle(n);
                        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
                        const text = (n.innerText || '').replace(/\s+/g, ' ').trim();
                        if (text && text.length > 0) {
                            captionText = text;
                            break;
                        }
                    }
                    if (captionText) break;
                }
            } catch (_) {
                // ignore
            }
        }
    }

    return {
        transcriptText,
        captionText,
        isVideoPlaying: isPlaying
    };
}

// Translate text to Spanish using MyMemory API
async function translateToSpanish(text) {
    if (!text || !ttsSettings.autoTranslate) return text;

    // If it already looks like Spanish, don't translate
    if (isLikelySpanish(text)) return text;

    try {
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|es`;
        const response = await fetch(url);
        const data = await response.json();

        if (data && data.responseData && data.responseData.translatedText) {
            let translatedText = data.responseData.translatedText;

            // Filter out MyMemory warning messages or obvious non-translation
            const warning = translatedText.includes('MYMEMORY WARNING') ||
                            translatedText.includes('MyMemory Warning') ||
                            translatedText.includes('YOU USED ALL AVAILABLE FREE TRANSLATIONS');
            if (warning) {
                console.warn('MyMemory API limit reached or warning. Skipping speaking to avoid English.');
                return null; // signal to skip
            }

            // If translation appears unchanged and input is likely English, skip speaking
            if (normalizeKey(translatedText) === normalizeKey(text) && isLikelyEnglish(text)) {
                console.warn('Translation unchanged for English input. Skipping to avoid English speech.');
                return null;
            }

            console.log('Original:', text);
            console.log('Translated:', translatedText);
            return translatedText;
        }

        // No translation; if likely English, skip, else return original
        return isLikelyEnglish(text) ? null : text;
    } catch (error) {
        console.error('Translation error:', error);
        return isLikelyEnglish(text) ? null : text;
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

// Remove UI labels and non-speech markers from captions (e.g., "English", "[Music]")
function sanitizeSubtitleText(text) {
    if (!text) return '';
    let t = String(text);
    // Remove common non-speech markers like [Music], [Applause], [Inaudible]
    t = t.replace(/\[[^\]]+\]/g, ' ');
    // Remove leading dashes used in dialogues
    t = t.replace(/^[-–—]\s*/g, '');
    // Collapse whitespace
    t = t.replace(/\s+/g, ' ').trim();

    const lower = t.toLowerCase();
    const blockedExact = [
        'english', 'inglés', 'ingles', 'spanish', 'español',
        'captions', 'subtitles', 'subtítulos', 'cc',
        'auto-generated', 'autogenerado'
    ];
    if (blockedExact.includes(lower)) return '';

    // Short UI labels like "English (auto-generated)"
    if (t.length <= 25 && /(english|spanish|español)/i.test(t)) {
        return '';
    }

    return t;
}

// Simple language heuristics to avoid speaking English when auto-translate fails
function isLikelySpanish(text) {
    if (!text) return false;
    const lower = text.toLowerCase();
    const hasSpanishChars = /[áéíóúñü¡¿]/i.test(text);
    const spanishStop = [' el ', ' la ', ' de ', ' que ', ' y ', ' en ', ' los ', ' se ', ' del ', ' las ', ' para ', ' como '];
    const stopHit = spanishStop.some(w => lower.includes(w));
    return hasSpanishChars || stopHit;
}

function isLikelyEnglish(text) {
    if (!text) return false;
    const lower = text.toLowerCase();
    const englishStop = [' the ', ' and ', ' of ', ' to ', ' in ', ' is ', ' you ', ' that ', ' for ', ' with ', ' on ', ' as ', ' it ', ' this ', ' are '];
    const shortEnglish = ['ok', 'okay', 'yes', 'no', 'right', 'well', 'so', 'uh', 'um'];
    const stopHit = englishStop.some(w => lower.includes(w));
    const shortHit = shortEnglish.includes(lower.trim());
    const hasSpanishChars = /[áéíóúñü¡¿]/i.test(text);
    return (stopHit || shortHit) && !hasSpanishChars;
}

function normalizeKey(text) {
    return (text || '')
        .toLowerCase()
        .replace(/[\s\u00A0]+/g, ' ')
        .replace(/[\.,;:!\?\(\)\[\]"'`]/g, '')
        .trim();
}

function speakSubtitle() {
    if (!isTTSActive || isSpeaking) return;

    fetchSubtitle(function(response) {
        if (response && response.data) {
            // Prefer transcript text when available; otherwise fall back to on-screen captions
            let usedSource = 'none';
            let subtitleText = null;
            if (response.data.transcriptText) {
                subtitleText = response.data.transcriptText;
                usedSource = 'transcript';
            } else if (response.data.captionText) {
                subtitleText = response.data.captionText;
                usedSource = 'captions';
            }
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
            
            // Sanitize to avoid picking UI labels like "English"
            const sanitized = sanitizeSubtitleText(subtitleText || '');

            // If no subtitle text from either source, or sanitized empty, wait
            if (!sanitized) {
                return;
            }
            
            // If same subtitle (normalized), skip
            const key = normalizeKey(sanitized);
            if (key && key === lastSubtitle) {
                return;
            }
            
            // New subtitle detected - speak immediately
            isSpeaking = true;
            
            console.log(`New subtitle (${usedSource}):`, sanitized);
            
            // Translate and speak immediately (no buffer)
            if (ttsSettings.autoTranslate) {
                translateToSpanish(sanitized).then(translatedText => {
                    if (translatedText) {
                        processAndSpeak(translatedText);
                        lastSubtitle = key; // commit key only after we actually speak
                    } else {
                        // Skip speaking to avoid English when translation failed
                        isSpeaking = false;
                        lastSubtitle = key; // mark as processed to avoid loops on the same cue
                        console.warn('Skipped speaking English due to translation failure/limit');
                    }
                });
            } else {
                processAndSpeak(sanitized);
                lastSubtitle = key;
            }
        }
    });
}

function processAndSpeak(text) {
    // Guard: when auto-translate is ON, never speak clear English lines
    if (ttsSettings.autoTranslate && isLikelyEnglish(text) && !isLikelySpanish(text)) {
        console.warn('Process skipped: text appears English while auto-translate is ON.');
        isSpeaking = false;
        return;
    }

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
        // If auto-translate is ON, avoid forcing a non-Spanish voice
        if (ttsSettings.autoTranslate) {
            const v = String(ttsSettings.voice);
            const looksSpanish = /(\bes\b|spanish|español)/i.test(v);
            if (looksSpanish) {
                speakOptions.voiceName = ttsSettings.voice;
            } // else: let Chrome pick a Spanish voice based on lang
        } else {
            speakOptions.voiceName = ttsSettings.voice;
        }
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
