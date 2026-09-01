// Renderer process logic for Yui AI Companion — Live2D Haru version.
// Replaces video-based avatar system with Live2D Cubism controller.

// Haru avatar is loaded via haru-bundle.js (IIFE) before this script.
// The bundle sets window.haruAvatar and calls initHaruAvatar() automatically.
console.log('[Renderer] window.haruAvatar available:', !!window.haruAvatar);


// -------------------------------------------------
// Avatar Live2D adapter — thin wrappers around window.haruAvatar.
// window.haruAvatar is set by src/avatar/haru-init.js (ES module).
// Using optional chaining so calls are no-ops if module is not ready yet.
// -------------------------------------------------
function avatarPlayIdle()     { window.haruAvatar?.playIdle(); }
function avatarPlayThinking() { window.haruAvatar?.playThinking(); }
function avatarPlayTalking(audioElement) { window.haruAvatar?.playTalking(audioElement); }
function avatarPlayExpression(name) { window.haruAvatar?.playExpression(name); }
function avatarResetExpression() { window.haruAvatar?.resetExpression(); }

const THINKING_ANIMATIONS = ['thinking-1', 'thinking-2'];
const THINKING_ANIMATION_DURATION_MS = 5000;
const POSE_ANIMATIONS = ['pose-1', 'pose-2', 'pose-3'];
const POSE_ANIMATION_DURATION_MS = 5000;

let mode = 'idle';
let appState = 'idle';
let thinkingAnimationIndex = 0;
let thinkingLoopRunning = false;
let thinkingLoopPromise = null;
let thinkingAnimationTimeout = null;
let resolveThinkingWait = null;
let isPoseAnimationPlaying = false;
let poseAnimationRunId = 0;

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function waitForThinkingDelay(ms) {
  return new Promise((resolve) => {
    resolveThinkingWait = resolve;
    thinkingAnimationTimeout = window.setTimeout(() => {
      thinkingAnimationTimeout = null;
      resolveThinkingWait = null;
      resolve();
    }, ms);
  });
}

function resolveThinkingDelay() {
  if (thinkingAnimationTimeout) {
    clearTimeout(thinkingAnimationTimeout);
    thinkingAnimationTimeout = null;
  }

  if (resolveThinkingWait) {
    const resolve = resolveThinkingWait;
    resolveThinkingWait = null;
    resolve();
  }
}

function getThinkingAnimationKeys() {
  const animations = envConfig?.thinking?.animations;
  if (!Array.isArray(animations) || animations.length === 0) {
    return THINKING_ANIMATIONS;
  }
  return animations.filter((animationKey) => animationKey);
}

function getThinkingAnimationDurationMs() {
  const configuredDuration = Number(envConfig?.thinking?.animationDurationMs);
  if (Number.isFinite(configuredDuration) && configuredDuration > 0) {
    return configuredDuration;
  }
  return THINKING_ANIMATION_DURATION_MS;
}

function isTransientAnimationMode() {
  return mode === 'thinking' || mode === 'pose';
}

function syncPoseButtonsEnabled() {
  const canUsePoseButtons =
    !ttsBusy &&
    !chatBusy &&
    appState !== 'thinking' &&
    appState !== 'preparing_voice' &&
    appState !== 'speaking' &&
    appState !== 'pose' &&
    mode !== 'thinking' &&
    mode !== 'speaking' &&
    !isPoseAnimationPlaying;

  setPoseButtonsEnabled(canUsePoseButtons);
}

function setPoseButtonsEnabled(enabled) {
  poseButtons.forEach((button) => {
    button.disabled = !enabled;
  });
}

function returnToIdleAfterPose() {
  if (mode !== 'pose') return;
  mode = 'idle';
  appState = 'idle';
  avatarPlayIdle();
}

async function playPoseAnimation(poseName) {
  if (!POSE_ANIMATIONS.includes(poseName)) {
    console.warn(`[Pose] unknown pose: ${poseName}`);
    syncPoseButtonsEnabled();
    return;
  }

  if (
    isPoseAnimationPlaying ||
    appState === 'thinking' ||
    appState === 'preparing_voice' ||
    appState === 'speaking' ||
    mode === 'thinking' ||
    mode === 'speaking'
  ) {
    return;
  }

  isPoseAnimationPlaying = true;
  poseAnimationRunId += 1;
  const runId = poseAnimationRunId;
  appState = 'pose';
  mode = 'pose';
  syncPoseButtonsEnabled();

  console.log(`[Pose] play ${poseName}`);

  // Map pose to Haru motion
  const motionMap = {
    'pose-1': 'haru_m_04',
    'pose-2': 'haru_m_05',
    'pose-3': 'haru_m_06',
  };
  const motionName = motionMap[poseName];
  if (window.haruAvatar?._model) {
    window.haruAvatar._playMotion(motionName, false);
  }

  try {
    await wait(500);
    if (runId !== poseAnimationRunId || appState !== 'pose' || mode !== 'pose') return;
    await wait(POSE_ANIMATION_DURATION_MS);
    if (runId !== poseAnimationRunId || appState !== 'pose' || mode !== 'pose') return;
    console.log(`[Pose] finished ${poseName}`);
    returnToIdleAfterPose();
  } catch (error) {
    console.warn(`[Pose] failed ${poseName}:`, error);
    returnToIdleAfterPose();
  } finally {
    if (runId === poseAnimationRunId) {
      isPoseAnimationPlaying = false;
      if (appState === 'pose') appState = 'idle';
      syncPoseButtonsEnabled();
    }
  }
}

async function playThinkingAnimationAndWait(clipKey) {
  console.log(`[Thinking] play ${clipKey}`);
  avatarPlayThinking();
  await wait(300);
  if (!thinkingLoopRunning || mode !== 'thinking') return;
  await waitForThinkingDelay(getThinkingAnimationDurationMs());
  if (!thinkingLoopRunning || mode !== 'thinking') return;
  console.log(`[Thinking] finished ${clipKey}`);
}

function startThinkingAnimationLoop() {
  if (thinkingLoopRunning) return thinkingLoopPromise;
  const thinkingKeys = getThinkingAnimationKeys();
  if (thinkingKeys.length === 0) {
    console.warn('[Thinking] no thinking animation keys configured');
    return null;
  }
  thinkingLoopRunning = true;
  thinkingAnimationIndex = 0;
  thinkingLoopPromise = (async () => {
    try {
      while (thinkingLoopRunning && mode === 'thinking') {
        const clipKey = thinkingKeys[thinkingAnimationIndex % thinkingKeys.length];
        thinkingAnimationIndex += 1;
        try {
          await playThinkingAnimationAndWait(clipKey);
        } catch (error) {
          console.warn('[Thinking] motion failed:', clipKey, error);
          await waitForThinkingDelay(getThinkingAnimationDurationMs());
        }
      }
    } finally {
      thinkingLoopRunning = false;
      thinkingLoopPromise = null;
      resolveThinkingDelay();
      if (mode === 'thinking') {
        mode = 'idle';
        avatarPlayIdle();
      }
      console.log('[Thinking] stopped');
    }
  })();
  return thinkingLoopPromise;
}

async function stopThinkingAnimationLoop() {
  if (!thinkingLoopRunning && !thinkingLoopPromise) return;
  console.log('[Thinking] stop requested');
  thinkingLoopRunning = false;
  resolveThinkingDelay();
  if (thinkingLoopPromise) await thinkingLoopPromise;
}

function startThinkingState(nextState = 'thinking') {
  if (appState === 'thinking' || appState === 'preparing_voice' || thinkingLoopRunning) return;
  appState = nextState;
  console.log('[Thinking] start');
  syncPoseButtonsEnabled();
  avatarPlayThinking();
  if (getThinkingConfig().enabled === false) return;
  mode = 'thinking';
  startThinkingAnimationLoop();
}

async function stopThinkingState() {
  if (mode !== 'thinking' && appState !== 'thinking' && appState !== 'preparing_voice') return;
  appState = 'idle';
  await stopThinkingAnimationLoop();
  syncPoseButtonsEnabled();
  if (appState === 'idle') avatarPlayIdle();
}

function startSpeaking(audioElement) {
  if (mode === 'speaking') return;
  stopThinkingAnimationLoop();
  appState = 'speaking';
  mode = 'speaking';
  syncPoseButtonsEnabled();
  avatarPlayTalking(audioElement);
}

function stopSpeaking() {
  if (mode !== 'speaking') return;
  mode = 'idle';
  appState = 'idle';
  avatarResetExpression();
  syncPoseButtonsEnabled();
  avatarPlayIdle();
}

// -------------------------------------------------
// Groq configuration
// -------------------------------------------------
const GROQ_MODEL_ID = 'llama-3.3-70b-versatile';
const DEFAULT_PERSONALITY =
  'You are Yui, a friendly virtual AI assistant. Be warm, supportive, conversational, and slightly playful. Default to English for all assistant responses unless the user explicitly requests another language. If the user asks to use Indonesian, Japanese, or any other language, follow that request. Do not switch languages merely because the user\'s message is written in another language. Use clean plain text only. Avoid markdown formatting such as bold, italic, headings, or decorative lists. Keep responses natural and easy to understand.';
let systemPrompt = DEFAULT_PERSONALITY;
let personalityLoadPromise = null;
let envLoadPromise = null;
const DEFAULT_TTS_CONFIG = {
  enabled: false,
  engine: 'kokoro',
  serverUrl: 'http://127.0.0.1:5005',
  fallbackToTextOnly: true,
};
const DEFAULT_THINKING_CONFIG = {
  enabled: true,
  message: 'Thinking...',
  animations: THINKING_ANIMATIONS,
  animationDurationMs: THINKING_ANIMATION_DURATION_MS,
};
let envConfig = {
  GROQ_API_KEY: '',
  WEATHERSTACK_API_KEY: '',
  CALENDARIFIC_API_KEY: '',
  tts: { ...DEFAULT_TTS_CONFIG },
  thinking: { ...DEFAULT_THINKING_CONFIG },
};

const ttsForm = document.querySelector('.tts-form');
const ttsInput = document.querySelector('#tts-input');
const ttsButton = document.querySelector('#tts-button');
const ttsStatus = document.querySelector('#tts-status');
const poseButtons = document.querySelectorAll('.pose-button');
const chatLog = document.querySelector('#chat-log');

const chatHistory = [];
let ttsBusy = false;
let chatBusy = false;

function updateUiBusy() {
  const isBusy = ttsBusy || chatBusy;
  if (ttsButton) ttsButton.disabled = isBusy;
  if (ttsInput) ttsInput.disabled = isBusy;
  syncPoseButtonsEnabled();
}

function setTtsBusy(isBusy) { ttsBusy = isBusy; updateUiBusy(); }
function setChatBusy(isBusy) { chatBusy = isBusy; updateUiBusy(); }
function isUiBusy() { return ttsBusy || chatBusy; }

const audioPlayer = new Audio();
audioPlayer.preload = 'auto';
let currentAudioUrl = null;
let currentTempTtsOutputPath = '';

function setStatus(message) {
  if (ttsStatus) ttsStatus.textContent = message;
}

async function loadPersonalityPrompt() {
  if (!window.personality?.load) {
    console.warn('[Personality] Bridge not available. Using default prompt.');
    return;
  }
  try {
    const text = await window.personality.load();
    if (text && text.trim()) {
      systemPrompt = text.trim();
      console.log('[Personality] personality.md loaded.');
    } else {
      console.warn('[Personality] personality.md is empty. Using default.');
    }
  } catch (error) {
    console.error('[Personality] Failed to load personality.md:', error);
  }
}

function ensurePersonalityLoaded() {
  if (!personalityLoadPromise) personalityLoadPromise = loadPersonalityPrompt();
  return personalityLoadPromise;
}

async function loadEnvConfig() {
  if (!window.env?.getAll) {
    console.warn('[Env] Bridge not available. API keys not loaded.');
    return;
  }
  try {
    const values = await window.env.getAll();
    envConfig = {
      GROQ_API_KEY: values?.GROQ_API_KEY || '',
      WEATHERSTACK_API_KEY: values?.WEATHERSTACK_API_KEY || '',
      CALENDARIFIC_API_KEY: values?.CALENDARIFIC_API_KEY || '',
      tts: { ...DEFAULT_TTS_CONFIG, ...(values?.TTS_CONFIG || {}) },
      thinking: { ...DEFAULT_THINKING_CONFIG, ...(values?.THINKING_CONFIG || {}) },
    };
    console.log('[Env] Environment keys loaded.');
  } catch (error) {
    console.error('[Env] Failed to load environment keys:', error);
  }
}

function ensureEnvLoaded() {
  if (!envLoadPromise) envLoadPromise = loadEnvConfig();
  return envLoadPromise;
}

function getEnvValue(key) { return envConfig[key] || ''; }
function getTtsConfig() { return envConfig.tts || DEFAULT_TTS_CONFIG; }
function isRealtimeTtsEnabled() {
  const ttsConfig = getTtsConfig();
  const supportedEngines = ['kokoro', 'piper'];
  return ttsConfig.enabled === true && supportedEngines.includes(ttsConfig.engine);
}
function getThinkingConfig() { return envConfig.thinking || DEFAULT_THINKING_CONFIG; }

function appendChatMessage(role, text) {
  if (!chatLog) return null;
  const message = document.createElement('div');
  message.className = `chat-message chat-message--${role}`;
  message.textContent = text;
  chatLog.appendChild(message);
  chatLog.scrollTop = chatLog.scrollHeight;
  return message;
}

function appendAssistantThinkingMessage(text = getThinkingConfig().message) {
  const message = appendChatMessage('assistant', text);
  if (message) message.dataset.loading = 'true';
  return message;
}

function updateThinkingMessage(messageElement, text) {
  if (messageElement) messageElement.textContent = text;
}

function replaceThinkingMessageWithFinal(messageElement, finalText) {
  if (!messageElement) {
    appendChatMessage('assistant', finalText);
    return;
  }
  messageElement.textContent = finalText;
  delete messageElement.dataset.loading;
  console.log('[Chat] replaced thinking message with final response');
}

function sanitizeResponse(text) {
  if (!text) return '';
  let output = text;
  output = output.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  output = output.replace(/^\s*[\*\+]\s+/gm, '- ');
  output = output.replace(/\*\*(.+?)\*\*/g, '$1');
  output = output.replace(/__(.+?)__/g, '$1');
  output = output.replace(/(^|[\s])\*(\S[^*]*?)\*([\s]|$)/g, '$1$2$3');
  output = output.replace(/(^|[\s])_(\S[^_]*?)_([\s]|$)/g, '$1$2$3');
  output = output.replace(/[ \t]+/g, ' ');
  return output.trim();
}

function revokeAudioUrl() {
  if (currentAudioUrl) {
    URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = null;
  }
}

async function deleteTempTtsOutputFile(tempOutputPath) {
  if (!tempOutputPath || !window.kokoroTts?.deleteOutputFile) return;
  try {
    await window.kokoroTts.deleteOutputFile({ path: tempOutputPath });
  } catch (error) {
    console.warn('[TTS] Failed to request temp output deletion:', error);
  }
}

function cleanupCurrentTempTtsOutput() {
  if (!currentTempTtsOutputPath) return;
  const tempOutputPath = currentTempTtsOutputPath;
  currentTempTtsOutputPath = '';
  void deleteTempTtsOutputFile(tempOutputPath);
}

audioPlayer.addEventListener('ended', () => {
  console.log('[TTS] playback ended');
  revokeAudioUrl();
  cleanupCurrentTempTtsOutput();
  stopSpeaking();
  setTtsBusy(false);
  setStatus('Ready.');
});

audioPlayer.addEventListener('error', () => {
  console.log('[TTS] Audio playback error.');
  revokeAudioUrl();
  cleanupCurrentTempTtsOutput();
  stopSpeaking();
  setTtsBusy(false);
  setStatus('Playback error.');
});

audioPlayer.addEventListener('play', () => {
  console.log('[TTS] playback started');
  startSpeaking(audioPlayer);
});

async function playAudioBuffer(arrayBuffer, mimeType = 'audio/wav', tempOutputPath = '') {
  const audioBlob = new Blob([arrayBuffer], { type: mimeType });
  cleanupCurrentTempTtsOutput();
  revokeAudioUrl();
  currentAudioUrl = URL.createObjectURL(audioBlob);
  currentTempTtsOutputPath = tempOutputPath;
  audioPlayer.pause();
  audioPlayer.src = currentAudioUrl;
  audioPlayer.currentTime = 0;
  try {
    await audioPlayer.play();
    setStatus('Playing...');
  } catch (error) {
    cleanupCurrentTempTtsOutput();
    throw error;
  }
}

// -------------------------------------------------
// Primary TTS: local Kokoro/Piper via server
// -------------------------------------------------
async function tryKokoroTts(text) {
  if (!window.kokoroTts?.synthesize) throw new Error('[Kokoro TTS] Bridge not available.');
  if (!isRealtimeTtsEnabled()) throw new Error('[Kokoro TTS] Realtime TTS is disabled.');
  console.log('[Using local TTS]', { engine: getTtsConfig().engine, textLength: text.length });
  const result = await window.kokoroTts.synthesize({
    text,
    voice: 'af_heart',
    speed: 1.0,
    language: 'id',
    engine: getTtsConfig().engine,
  });
  const rawArray = Array.isArray(result) ? result : result?.audioBytes;
  if (!Array.isArray(rawArray)) throw new Error('[TTS] Invalid audio response.');
  const uint8 = new Uint8Array(rawArray);
  console.log('[TTS] Audio received.', { bytes: uint8.byteLength });
  return { audioBuffer: uint8.buffer, tempOutputPath: result?.tempOutputPath || '' };
}

async function prepareKokoroAudio(text) {
  await ensureEnvLoaded();
  if (!isRealtimeTtsEnabled()) return null;
  console.log('[TTS] preparing voice');
  const audioData = await tryKokoroTts(text);
  console.log('[TTS] audio ready');
  return audioData;
}

async function requestSpeech(text, sourceLabel) {
  if (isUiBusy()) { setStatus('Busy. Please wait...'); return; }
  if (!text) { setStatus('Type something first.'); return; }
  await ensureEnvLoaded();
  if (!isRealtimeTtsEnabled()) { setStatus('Text-only mode.'); return; }
  setTtsBusy(true);
  const labelSuffix = sourceLabel ? ` (${sourceLabel})` : '';
  setStatus(`Generating local voice${labelSuffix}...`);
  try {
    const audioData = await prepareKokoroAudio(text);
    if (audioData) {
      await playAudioBuffer(audioData.audioBuffer, 'audio/wav', audioData.tempOutputPath);
    }
  } catch (error) {
    console.warn('[Kokoro TTS] Falling back to text-only mode.', error);
    const fallbackMessage = getTtsConfig().fallbackToTextOnly
      ? 'Text-only mode. TTS unavailable.'
      : 'TTS unavailable.';
    setStatus(fallbackMessage);
    stopSpeaking();
    setTtsBusy(false);
  }
}

// -------------------------------------------------
// Expression auto-detection from AI response
// -------------------------------------------------
function detectExpression(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  const patterns = [
    { expr: 'Smile', keywords: ['thank', 'great', 'good', 'happy', 'love', 'awesome', 'wonderful', 'glad', 'pleased', 'enjoy', 'nice', 'cool', 'sweet', 'perfect'] },
    { expr: 'Blushing', keywords: ['cute', 'adorable', 'embarrass', 'shy', 'blush', 'compliment'] },
    { expr: 'Sad', keywords: ['sorry', 'sad', 'unfortunate', 'disappoint', 'upset', 'regret', 'apologize', 'bad', 'terrible', 'awful'] },
    { expr: 'Angry', keywords: ['angry', 'mad', 'furious', 'annoyed', 'frustrated', 'hate'] },
    { expr: 'Surprised', keywords: ['wow', 'amazing', 'incredible', 'unbelievable', 'really?', 'no way', 'shock', 'surprise'] },
  ];
  for (const { expr, keywords } of patterns) {
    if (keywords.some(kw => lower.includes(kw))) return expr;
  }
  return null;
}

// -------------------------------------------------
// Weather: detect query, extract city, fetch context.
// -------------------------------------------------
const WEATHER_KEYWORDS = ['weather', 'cuaca', 'suhu', 'temperature', 'humid', 'kelembaban', 'raining', 'hujan', 'sunny', 'cerah', 'cloudy', 'berawan', 'wind', 'angin', 'forecast', 'prakiraan', 'panas', 'dingin', 'gerimis'];

function isWeatherQuery(message) {
  const lower = message.toLowerCase();
  return WEATHER_KEYWORDS.some((kw) => lower.includes(kw));
}

function extractCityFromMessage(message) {
  const patterns = [
    /weather\s+(?:in|at|for|of|around)\s+([\w\s]+?)(?:\?|$|\s+now|\s+today)/i,
    /(?:in|at|di|kota|daerah)\s+([\w\s]+?)\s+(?:weather|cuaca|suhu|temperature)/i,
    /cuaca\s+(?:di|kota|daerah|wilayah)?\s*([\w\s]+?)(?:\?|$|\s+sekarang|\s+hari ini)/i,
    /suhu\s+(?:di|kota)?\s*([\w\s]+?)(?:\?|$|\s+sekarang)/i,
    /(?:how(?:'s| is) (?:the )?weather|what(?:'s| is) (?:the )?weather)\s+(?:in|at|di)?\s*([\w\s]+?)(?:\?|$)/i,
    /(?:weather|cuaca|suhu|temperature)\s+(?:in|di|at)?\s*([\w\s]+?)(?:\?|$)/i,
  ];
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match && match[1]) return match[1].trim();
  }
  return null;
}

function formatWeatherContext(data) {
  const loc = data.location;
  const cur = data.current;
  const desc = Array.isArray(cur.weather_descriptions) ? cur.weather_descriptions.join(', ') : cur.weather_descriptions || 'unknown';
  return `[Real-time weather data — Location: ${loc.name}, ${loc.region}, ${loc.country} | Temperature: ${cur.temperature}°C (feels like ${cur.feelslike}°C) | Condition: ${desc} | Humidity: ${cur.humidity}% | Wind: ${cur.wind_speed} km/h ${cur.wind_dir} | Visibility: ${cur.visibility} km | UV Index: ${cur.uv_index}]`;
}

async function fetchWeatherContext(city) {
  if (!window.weather?.fetch) return null;
  const weatherApiKey = getEnvValue('WEATHERSTACK_API_KEY');
  if (!weatherApiKey) { console.warn('[Weather] WEATHERSTACK_API_KEY not set.'); return null; }
  try {
    console.log('[Weather] Fetching for city:', city);
    const data = await window.weather.fetch({ city, apiKey: weatherApiKey });
    const context = formatWeatherContext(data);
    console.log('[Weather] Data ready.', context);
    return context;
  } catch (error) {
    console.warn('[Weather] Fetch failed:', error);
    return null;
  }
}

// -------------------------------------------------
// Calendar: detect query, extract params, fetch holidays.
// -------------------------------------------------
const HOLIDAY_KEYWORDS = ['holiday', 'holidays', 'libur', 'hari libur', 'tanggal merah', 'public holiday', 'national day', 'hari nasional', 'cuti bersama', 'long weekend', 'harnas', 'perayaan', 'celebration'];

const COUNTRY_CODE_MAP = { indonesia: 'ID', japanese: 'JP', japan: 'JP', usa: 'US', america: 'US', 'united states': 'US', uk: 'GB', 'united kingdom': 'GB', britain: 'GB', australia: 'AU', malaysia: 'MY', singapore: 'SG', korea: 'KR', china: 'CN', india: 'IN', germany: 'DE', france: 'FR', brazil: 'BR' };

const MONTH_MAP = { january: 1, jan: 1, januari: 1, february: 2, feb: 2, februari: 2, march: 3, mar: 3, maret: 3, april: 4, apr: 4, may: 5, mei: 5, june: 6, jun: 6, juni: 6, july: 7, jul: 7, juli: 7, august: 8, aug: 8, agustus: 8, september: 9, sep: 9, oktober: 10, october: 10, oct: 10, november: 11, nov: 11, desember: 12, december: 12, dec: 12 };

function isHolidayQuery(message) {
  const lower = message.toLowerCase();
  return HOLIDAY_KEYWORDS.some((kw) => lower.includes(kw));
}

function extractHolidayParams(message) {
  const lower = message.toLowerCase();
  let countryCode = 'ID';
  for (const [name, code] of Object.entries(COUNTRY_CODE_MAP)) {
    if (lower.includes(name)) { countryCode = code; break; }
  }
  let month = null;
  for (const [name, num] of Object.entries(MONTH_MAP)) {
    if (lower.includes(name)) { month = num; break; }
  }
  const yearMatch = message.match(/\b(20\d{2})\b/);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : new Date().getFullYear();
  const isTodayQuery = /(today|hari ini|sekarang|tanggal berapa|tanggal hari ini)/i.test(message);
  return { countryCode, month, year, isTodayQuery };
}

function formatHolidayContext(holidays, params) {
  if (!holidays || holidays.length === 0) return `[No public holidays found for country: ${params.countryCode}, year: ${params.year}${params.month ? `, month: ${params.month}` : ''}]`;
  if (params.isTodayQuery) {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const todayHolidays = holidays.filter((h) => h.date?.iso?.startsWith(todayStr));
    if (todayHolidays.length === 0) return `[Today (${todayStr}) is not a public holiday in ${params.countryCode}]`;
    const list = todayHolidays.map((h) => `${h.name} (${h.type?.join(', ') || 'Holiday'})`).join('; ');
    return `[Today (${todayStr}) is a public holiday in ${params.countryCode}: ${list}]`;
  }
  const list = holidays.slice(0, 15).map((h) => `${h.date?.iso || '?'}: ${h.name}`).join(' | ');
  const label = params.month ? `month ${params.month} of ${params.year}` : `year ${params.year}`;
  return `[Public holidays in ${params.countryCode} for ${label} (${holidays.length} total): ${list}]`;
}

async function fetchHolidayContext(message) {
  if (!window.calendar?.fetchHolidays) return null;
  const calApiKey = getEnvValue('CALENDARIFIC_API_KEY');
  if (!calApiKey) { console.warn('[Calendar] CALENDARIFIC_API_KEY not set.'); return null; }
  const params = extractHolidayParams(message);
  try {
    console.log('[Calendar] Fetching holidays.', params);
    const holidays = await window.calendar.fetchHolidays({ apiKey: calApiKey, country: params.countryCode, year: params.year, month: params.month || undefined });
    const context = formatHolidayContext(holidays, params);
    console.log('[Calendar] Data ready.', context);
    return context;
  } catch (error) {
    console.warn('[Calendar] Fetch failed:', error);
    return null;
  }
}

// -------------------------------------------------
// Date/Time context
// -------------------------------------------------
function getCurrentDateTimeContext() {
  const now = new Date();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const localFormatted = now.toLocaleString('en-US', { timeZone: timezone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const isoTimestamp = now.toISOString();
  return `Current date and time:\n- Local time: ${localFormatted}\n- Timezone: ${timezone}\n- ISO time: ${isoTimestamp}\n\nUse this date/time information when the user asks about time, dates, today, tomorrow, yesterday, schedules, reminders, or time-related questions.`;
}

// -------------------------------------------------
// Yui Music Controller — intent detection.
// -------------------------------------------------
function detectMusicIntent(message) {
  const lower = message.trim().toLowerCase();
  if (/^open\s+(music|youtube\s+music)\s*$/i.test(lower) || /^launch\s+(music|youtube\s+music)\s*$/i.test(lower)) {
    return { type: 'open', query: null };
  }
  const playMatch = lower.match(/^(?:play(?:\s+music)?|search\s+and\s+play|search\s+music|putar)\s+(.+)$/i);
  if (playMatch && playMatch[1]) {
    const query = message.trim().replace(/^(?:play(?:\s+music)?|search\s+and\s+play|search\s+music|putar)\s+/i, '').trim();
    if (query.length > 0) return { type: 'search', query };
  }
  return null;
}

async function handleMusicIntent(userMessage) {
  const intent = detectMusicIntent(userMessage);
  if (!intent) return false;
  appendChatMessage('user', userMessage);
  if (!window.yuiMusic) {
    console.warn('[Music] yuiMusic bridge not available.');
    appendChatMessage('assistant', 'Sorry, the music automation bridge is not available right now.');
    return true;
  }
  if (intent.type === 'open') {
    appendChatMessage('assistant', 'Opening YouTube Music.');
    try { if (window.yuiMusic.openYouTube) await window.yuiMusic.openYouTube(); } catch (err) { console.error('[Music] Failed to open YouTube Music:', err); }
  } else if (intent.type === 'search') {
    appendChatMessage('assistant', `Playing YouTube Music for: ${intent.query}.`);
    try {
      if (window.yuiMusic.playYouTube) {
        const success = await window.yuiMusic.playYouTube(intent.query);
        if (!success) appendChatMessage('assistant', `I opened YouTube Music for: ${intent.query}, but I couldn't auto-play it. Please click the result manually.`);
      }
    } catch (err) {
      console.error('[Music] Failed to automate YouTube Music:', err);
      appendChatMessage('assistant', `I encountered an error trying to search for: ${intent.query}. Please check if the browser was closed.`);
    }
  }
  return true;
}

// Send a chat message to Groq and speak the response.
async function requestGroqResponse(userMessage) {
  if (isUiBusy()) { setStatus('Busy. Please wait...'); return; }
  if (!userMessage) { setStatus('Type a message first.'); return; }
  if (!window.groq?.generateResponse) { setStatus('Groq bridge failed to load.'); return; }
  await ensureEnvLoaded();
  const groqApiKey = getEnvValue('GROQ_API_KEY');
  if (!groqApiKey) { setStatus('Set GROQ_API_KEY in .env.'); return; }
  appendChatMessage('user', userMessage);
  const thinkingConfig = getThinkingConfig();
  const thinkingMessage = appendAssistantThinkingMessage(thinkingConfig.message);
  startThinkingState('thinking');
  setChatBusy(true);
  await ensurePersonalityLoaded();

  let contextualMessage = userMessage;
  const contextParts = [];
  if (isWeatherQuery(userMessage)) {
    const city = extractCityFromMessage(userMessage);
    if (city) { const weatherContext = await fetchWeatherContext(city); if (weatherContext) contextParts.push(weatherContext); }
  }
  if (isHolidayQuery(userMessage)) {
    const holidayContext = await fetchHolidayContext(userMessage);
    if (holidayContext) contextParts.push(holidayContext);
  }
  contextParts.unshift(getCurrentDateTimeContext());
  if (contextParts.length > 0) contextualMessage = `${userMessage}\n\n${contextParts.join('\n')}`;

  console.log('[Groq] Request start.', { textLength: userMessage.length, model: GROQ_MODEL_ID });
  setStatus(thinkingConfig.message);

  try {
    const responseText = await window.groq.generateResponse({
      apiKey: groqApiKey, model: GROQ_MODEL_ID, systemPrompt, history: chatHistory, message: contextualMessage,
    });
    const sanitizedResponse = sanitizeResponse(responseText || '');
    const cleanResponse = sanitizedResponse.trim() || 'Sorry, I had trouble responding just now.';

    console.log('[Groq] Response received.', { chars: cleanResponse.length });
    console.log('[AI] response ready');

    chatHistory.push({ role: 'user', content: userMessage }, { role: 'assistant', content: cleanResponse });

    // Auto-trigger expression based on response
    const expr = detectExpression(cleanResponse);
    if (expr) avatarPlayExpression(expr);

    if (!isRealtimeTtsEnabled()) {
      await stopThinkingState();
      replaceThinkingMessageWithFinal(thinkingMessage, cleanResponse);
      setStatus('Text-only mode.');
      setChatBusy(false);
      return;
    }

    appState = 'preparing_voice';
    setStatus(thinkingConfig.message);

    try {
      const audioData = await prepareKokoroAudio(cleanResponse);
      await stopThinkingState();
      replaceThinkingMessageWithFinal(thinkingMessage, cleanResponse);
      setChatBusy(false);
      if (audioData) {
        setTtsBusy(true);
        await playAudioBuffer(audioData.audioBuffer, 'audio/wav', audioData.tempOutputPath);
      }
    } catch (ttsError) {
      console.warn('[TTS] failed, fallback to text-only', ttsError);
      await stopThinkingState();
      replaceThinkingMessageWithFinal(thinkingMessage, cleanResponse);
      setStatus('Text-only mode. TTS unavailable.');
      setChatBusy(false);
      setTtsBusy(false);
    }
  } catch (error) {
    console.error('[Groq] Request failed.', error);
    await stopThinkingState();
    replaceThinkingMessageWithFinal(thinkingMessage, 'Sorry, I had trouble thinking for a moment. Please try again.');
    setStatus('Groq request failed. Check the console for details.');
    setChatBusy(false);
  }
}

async function handleTtsSubmit(event) {
  event.preventDefault();
  if (!ttsInput) return;
  const text = ttsInput.value.trim();
  ttsInput.value = '';
  if (await handleMusicIntent(text)) return;
  await requestGroqResponse(text);
}

function handlePoseButtonClick(event) {
  const button = event.currentTarget;
  const poseName = button?.dataset?.pose;
  if (!poseName) return;
  void playPoseAnimation(poseName);
}

if (ttsForm) ttsForm.addEventListener('submit', handleTtsSubmit);
poseButtons.forEach((button) => { button.addEventListener('click', handlePoseButtonClick); });

ensurePersonalityLoaded();
ensureEnvLoaded();
syncPoseButtonsEnabled();

// When haruAvatar module signals it's ready, make sure we're in idle state.
document.addEventListener('avatar3d:ready', () => {
  avatarPlayIdle();
  console.log('[HaruAvatar] Ready event received, idle playing.');
});