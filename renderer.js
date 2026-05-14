// Renderer process logic lives here.
// This file controls the idle animation playback system.

const videoA = document.querySelector(".idle-video--a");
const videoB = document.querySelector(".idle-video--b");

// Clip configuration with per-clip trim windows and warmup playback.
// trimStart/trimEnd remove unstable frames at the start/end.
// startDelay skips extra startup frames if the clip needs more stabilization.
// warmupSeconds lets the next clip play hidden before fading in.
const defaultClipSettings = {
  trimStart: 0.08,
  trimEnd: 0.08,
  startDelay: 0.06,
  warmupSeconds: 0.12,
};

const clipConfig = {
  "idle-main": {
    src: "assets/idle-main.mp4",
    trimStart: 0.08,
    trimEnd: 0.08,
    startDelay: 0.08,
    warmupSeconds: 0.14,
  },
  "speak-1": {
    src: "assets/speak-1.mp4",
    trimStart: 0.08,
    trimEnd: 0.08,
    startDelay: 0.1,
    warmupSeconds: 0.1,
  },
  "speak-2": {
    src: "assets/speak-2.mp4",
    trimStart: 0.08,
    trimEnd: 0.08,
    startDelay: 0.1,
    warmupSeconds: 0.1,
  },
  "idle-1": {
    src: "assets/idle-1.mp4",
    trimStart: 0.08,
    trimEnd: 0.08,
    startDelay: 0.06,
    warmupSeconds: 0.12,
  },
  "idle-2": {
    src: "assets/idle-2.mp4",
    trimStart: 0.08,
    trimEnd: 0.08,
    startDelay: 0.06,
    warmupSeconds: 0.12,
  },
  "idle-3": {
    src: "assets/idle-3.mp4",
    trimStart: 0.08,
    trimEnd: 0.08,
    startDelay: 0.06,
    warmupSeconds: 0.12,
  },
};

const variationKeys = ["idle-1", "idle-2", "idle-3"];
const speakingKeys = ["speak-1", "speak-2"];
const crossfadeMs = 280;
const overlapLeadSeconds = 0.3;

let activeVideo = videoA;
let lastVariation = null;
let lastSpeaking = null;
let mode = "idle";
let switchInProgress = false;
let transitionToken = 0;

// Ensure video elements are always muted so only TTS audio is audible.
function muteVideoElement(videoElement) {
  if (!videoElement) {
    return;
  }

  videoElement.muted = true;
  videoElement.volume = 0;
  videoElement.defaultMuted = true;
}

muteVideoElement(videoA);
muteVideoElement(videoB);

// Preload all videos to keep transitions smooth.
function preloadVideos() {
  Object.values(clipConfig).forEach((clip) => {
    const preloadVideo = document.createElement("video");
    preloadVideo.src = clip.src;
    preloadVideo.preload = "auto";
    muteVideoElement(preloadVideo);
    preloadVideo.load();
  });
}

// Merge defaults with a specific clip entry.
function getClip(clipKey) {
  const clip = clipConfig[clipKey];
  if (!clip) {
    return null;
  }

  return { ...defaultClipSettings, ...clip };
}

// Pick a variation that is not the same as the last one.
function pickVariationKey() {
  if (variationKeys.length === 1) {
    return variationKeys[0];
  }

  let choice = variationKeys[0];
  while (choice === lastVariation) {
    const index = Math.floor(Math.random() * variationKeys.length);
    choice = variationKeys[index];
  }

  lastVariation = choice;
  return choice;
}

// Pick a speaking clip that is not the same as the last one.
function pickSpeakingKey() {
  if (speakingKeys.length === 1) {
    return speakingKeys[0];
  }

  let choice = speakingKeys[0];
  while (choice === lastSpeaking) {
    const index = Math.floor(Math.random() * speakingKeys.length);
    choice = speakingKeys[index];
  }

  lastSpeaking = choice;
  return choice;
}

// Decide the next clip in the idle -> variation -> idle loop.
function getNextClipKey(currentClipKey) {
  if (mode === "speaking") {
    return pickSpeakingKey();
  }

  if (currentClipKey && currentClipKey.startsWith("speak-")) {
    return "idle-main";
  }

  if (currentClipKey === "idle-main") {
    return pickVariationKey();
  }

  return "idle-main";
}

// Return the hidden video element that is not currently visible.
function getInactiveVideo() {
  return activeVideo === videoA ? videoB : videoA;
}

// Set which video is visible and fade between them.
function setActiveVideo(nextVideo) {
  const inactive = activeVideo;
  activeVideo = nextVideo;

  if (inactive) {
    inactive.classList.remove("is-active");
  }

  if (activeVideo) {
    activeVideo.classList.add("is-active");
  }
}

// Compute a safe start time that stays inside the clip window.
function getSafeStartTime(videoElement, clip) {
  const desiredStart = clip.trimStart + clip.startDelay;
  if (!Number.isFinite(videoElement.duration)) {
    return desiredStart;
  }

  const maxStart = Math.max(videoElement.duration - clip.trimEnd - 0.05, 0);
  return Math.min(desiredStart, maxStart);
}

// Compute a safe end time that stays inside the clip window.
function getSafeEndTime(videoElement, clip) {
  if (!Number.isFinite(videoElement.duration)) {
    return Infinity;
  }

  const safeStart = getSafeStartTime(videoElement, clip);
  const safeEnd = Math.max(videoElement.duration - clip.trimEnd, 0);
  return Math.max(safeEnd, safeStart + 0.05);
}

// Prepare a video element with the clip source and trim start.
function prepareVideo(videoElement, clipKey, onReady) {
  const clip = getClip(clipKey);
  if (!videoElement || !clip) {
    return;
  }

  videoElement.dataset.clipKey = clipKey;

  if (videoElement.src !== clip.src) {
    videoElement.src = clip.src;
  }

  muteVideoElement(videoElement);
  videoElement.pause();

  const handleLoadedMetadata = () => {
    const safeStart = getSafeStartTime(videoElement, clip);
    videoElement.currentTime = safeStart;
  };

  const handleCanPlay = () => {
    videoElement.removeEventListener("canplay", handleCanPlay);
    if (onReady) {
      onReady();
    }
  };

  videoElement.addEventListener("loadedmetadata", handleLoadedMetadata, {
    once: true,
  });
  videoElement.addEventListener("canplay", handleCanPlay, { once: true });
  videoElement.load();
}

// Start playback on the prepared element at its safe trim start.
function playPrepared(videoElement, clipKey) {
  const clip = getClip(clipKey);
  if (!videoElement || !clip) {
    return;
  }

  const safeStart = getSafeStartTime(videoElement, clip);
  if (videoElement.currentTime < safeStart) {
    videoElement.currentTime = safeStart;
  }

  videoElement.play().catch(() => {
    // Autoplay should work because the video is muted, but ignore failures.
  });
}

// Begin a stabilized transition to the next clip.
function beginTransitionToClip(nextClipKey, options = {}) {
  const { force = false } = options;
  const nextVideo = getInactiveVideo();
  const nextClip = getClip(nextClipKey);

  if (!nextVideo || !nextClip) {
    return;
  }

  if (switchInProgress && !force) {
    return;
  }

  switchInProgress = true;
  const currentToken = (transitionToken += 1);

  // Hold the last stable frame while the next clip warms up in the background.
  const currentClipKey = activeVideo?.dataset.clipKey;
  const currentClip = getClip(currentClipKey);
  if (activeVideo && currentClip) {
    const safeEnd = getSafeEndTime(activeVideo, currentClip);
    if (Number.isFinite(safeEnd)) {
      activeVideo.currentTime = Math.min(activeVideo.currentTime, safeEnd);
    }
    activeVideo.pause();
  }

  prepareVideo(nextVideo, nextClipKey, () => {
    if (currentToken !== transitionToken) {
      return;
    }

    playPrepared(nextVideo, nextClipKey);

    const warmupMs = Math.max(nextClip.warmupSeconds * 1000, 0);
    const previousVideo = activeVideo;

    setTimeout(() => {
      if (currentToken !== transitionToken) {
        return;
      }

      setActiveVideo(nextVideo);

      setTimeout(() => {
        if (currentToken !== transitionToken) {
          return;
        }

        if (previousVideo) {
          previousVideo.pause();
        }
        switchInProgress = false;
      }, crossfadeMs + 60);
    }, warmupMs);
  });
}

// Smoothly transition near the safe end time to avoid hard restarts.
function trySmoothSwitch(event) {
  if (event.target !== activeVideo || switchInProgress) {
    return;
  }

  const clipKey = activeVideo.dataset.clipKey;
  const clip = getClip(clipKey);
  if (!clip) {
    return;
  }

  const safeEnd = getSafeEndTime(activeVideo, clip);
  const remaining = safeEnd - activeVideo.currentTime;
  if (remaining > overlapLeadSeconds) {
    return;
  }

  const nextClipKey = getNextClipKey(clipKey);
  beginTransitionToClip(nextClipKey);
}

// Fallback to ensure a switch happens even if timing events are missed.
function handleVideoEnded(event) {
  if (event.target !== activeVideo || switchInProgress) {
    return;
  }

  const clipKey = activeVideo.dataset.clipKey || "idle-main";
  const nextClipKey = getNextClipKey(clipKey);
  beginTransitionToClip(nextClipKey);
}

// Switch into speaking mode and prioritize speaking clips.
function startSpeaking() {
  if (mode === "speaking") {
    return;
  }

  mode = "speaking";
  const firstSpeak = pickSpeakingKey();
  beginTransitionToClip(firstSpeak, { force: true });

  // Stop idle ambience immediately when speaking begins.
  stopIdleAmbience();
}

// Return to idle mode after speaking finishes.
function stopSpeaking() {
  if (mode !== "speaking") {
    return;
  }

  mode = "idle";
  beginTransitionToClip("idle-main", { force: true });

  // Resume idle ambience once speaking is done.
  scheduleNextIdleAmbience();
}

preloadVideos();

if (videoA && videoB) {
  videoA.addEventListener("timeupdate", trySmoothSwitch);
  videoB.addEventListener("timeupdate", trySmoothSwitch);
  videoA.addEventListener("ended", handleVideoEnded);
  videoB.addEventListener("ended", handleVideoEnded);

  setActiveVideo(videoA);
  prepareVideo(videoA, "idle-main", () => {
    playPrepared(videoA, "idle-main");
  });
}

// -------------------------------------------------
// Idle ambience system
// -------------------------------------------------
// Plays very soft, infrequent idle sounds to make the assistant
// feel quietly alive during idle states. Not speech — just subtle
// breathing, hums, and ambient vocal presence.

// Volume level — keep this very low so it stays non-intrusive.
const IDLE_AMBIENCE_VOLUME = 0.15;

// Random interval range between idle sounds (in milliseconds).
const IDLE_AMBIENCE_MIN_MS = 15000; // 15 seconds
const IDLE_AMBIENCE_MAX_MS = 40000; // 40 seconds

// Sound pools per idle clip state.
// Each state maps to the files most appropriate for that vibe.
// If a file doesn't exist yet, playback fails silently.
const idleSoundMap = {
  "idle-main": [
    "assets/audio/idle/breathe-1.mp3",
    "assets/audio/idle/breathe-2.mp3",
  ],
  "idle-1": [
    "assets/audio/idle/hum-1.mp3",
    "assets/audio/idle/breathe-1.mp3",
  ],
  "idle-2": [
    "assets/audio/idle/breathe-2.mp3",
    "assets/audio/idle/hum-2.mp3",
  ],
  "idle-3": [
    "assets/audio/idle/breathe-1.mp3",
    "assets/audio/idle/breathe-2.mp3",
  ],
};

// Fallback pool used if no specific state mapping is found.
const idleSoundFallback = [
  "assets/audio/idle/breathe-1.mp3",
  "assets/audio/idle/breathe-2.mp3",
  "assets/audio/idle/hum-1.mp3",
  "assets/audio/idle/hum-2.mp3",
];

// Dedicated audio element for idle ambience.
// Separate from the main TTS player so they never interfere.
const idleAmbiencePlayer = new Audio();
idleAmbiencePlayer.volume = IDLE_AMBIENCE_VOLUME;

let idleAmbienceTimer = null;

// Pick a sound file based on the current idle clip state.
function pickIdleSound() {
  const currentClipKey = activeVideo?.dataset.clipKey || "idle-main";
  const pool = idleSoundMap[currentClipKey];

  // Use the state-specific pool if available, otherwise use the fallback.
  const soundPool = pool && pool.length > 0 ? pool : idleSoundFallback;
  const index = Math.floor(Math.random() * soundPool.length);
  return soundPool[index];
}

// Play a single idle ambience sound.
// Does nothing if currently speaking.
function playIdleAmbience() {
  if (mode === "speaking") {
    return;
  }

  const src = pickIdleSound();
  idleAmbiencePlayer.src = src;
  idleAmbiencePlayer.volume = IDLE_AMBIENCE_VOLUME;
  idleAmbiencePlayer.currentTime = 0;

  // Fail silently if the file doesn't exist — no errors shown to user.
  idleAmbiencePlayer.play().catch(() => {});
}

// Schedule the next idle ambience sound at a random interval.
// This is the main loop — it re-schedules itself after each sound.
function scheduleNextIdleAmbience() {
  // Clear any existing timer before setting a new one.
  clearTimeout(idleAmbienceTimer);

  // Don't schedule if currently in speaking mode.
  if (mode === "speaking") {
    return;
  }

  // Pick a random delay between the min and max interval.
  const range = IDLE_AMBIENCE_MAX_MS - IDLE_AMBIENCE_MIN_MS;
  const delay = IDLE_AMBIENCE_MIN_MS + Math.random() * range;

  idleAmbienceTimer = setTimeout(() => {
    playIdleAmbience();

    // Schedule the next sound after this one finishes.
    // Use the audio duration + a small buffer if available,
    // otherwise just move straight to rescheduling.
    const playbackDuration =
      Number.isFinite(idleAmbiencePlayer.duration)
        ? idleAmbiencePlayer.duration * 1000 + 500
        : 0;

    setTimeout(scheduleNextIdleAmbience, playbackDuration);
  }, delay);
}

// Stop any active idle ambience and clear the pending timer.
// Called when speaking begins.
function stopIdleAmbience() {
  clearTimeout(idleAmbienceTimer);
  idleAmbienceTimer = null;
  idleAmbiencePlayer.pause();
  idleAmbiencePlayer.currentTime = 0;
}

// Start the idle ambience loop after a short initial delay.
// The delay gives the app time to finish loading before anything plays.
setTimeout(scheduleNextIdleAmbience, 5000);

// -------------------------------------------------
// Groq configuration
// -------------------------------------------------
// API keys are loaded from .env via the main process.
const GROQ_MODEL_ID = "llama-3.3-70b-versatile";
const DEFAULT_PERSONALITY =
  "You are Yui, a friendly virtual AI assistant. Be warm, supportive, conversational, and slightly playful. Use clean plain text only. Avoid markdown formatting such as bold, italic, headings, or decorative lists. Keep responses natural and easy to understand.";
let systemPrompt = DEFAULT_PERSONALITY;
let personalityLoadPromise = null;
let envLoadPromise = null;
let envConfig = {
  GROQ_API_KEY: "",
  KOKORO_TTS_URL: "",
};

const ttsForm = document.querySelector(".tts-form");
const ttsInput = document.querySelector("#tts-input");
const ttsButton = document.querySelector("#tts-button");
const ttsStatus = document.querySelector("#tts-status");
const languageButtons = document.querySelectorAll(".language-button");
const chatLog = document.querySelector("#chat-log");

// Language introduction scripts for the quick buttons.
const introScripts = {
  id: `Halo. Aku adalah AI Agent dengan codename Yui.
Diciptakan untuk menemani, membantu, dan menjadi asisten virtual yang selalu siap berinteraksi kapan pun dibutuhkan.

Kamu bisa memanggilku Yui.
Senang bisa bertemu denganmu.`,
  en: `Hello. I am an AI Agent with the codename Yui.
Created to assist, accompany, and interact as a virtual assistant whenever needed.

You may call me Yui.
It's a pleasure to meet you.`,
  jp: `こんにちは……コードネーム「ユイ」のAIエージェントです。

お話したり、お手伝いしたり……
いつでもそばで、サポートできるように作られました。

「ユイ」って、気軽に呼んでくださいね。

これから……よろしくお願いします。`,
};

const chatHistory = [];

let ttsBusy = false;
let chatBusy = false;

function updateUiBusy() {
  const isBusy = ttsBusy || chatBusy;

  if (ttsButton) {
    ttsButton.disabled = isBusy;
  }

  if (ttsInput) {
    ttsInput.disabled = isBusy;
  }

  languageButtons.forEach((button) => {
    button.disabled = isBusy;
  });
}

function setTtsBusy(isBusy) {
  ttsBusy = isBusy;
  updateUiBusy();
}

function setChatBusy(isBusy) {
  chatBusy = isBusy;
  updateUiBusy();
}

function isUiBusy() {
  return ttsBusy || chatBusy;
}

const audioPlayer = new Audio();
audioPlayer.preload = "auto";
let currentAudioUrl = null;

function setStatus(message) {
  if (ttsStatus) {
    ttsStatus.textContent = message;
  }
}

// Load the assistant personality from personality.md.
async function loadPersonalityPrompt() {
  if (!window.personality?.load) {
    console.warn("[Personality] Bridge not available. Using default prompt.");
    return;
  }

  try {
    const text = await window.personality.load();
    if (text && text.trim()) {
      systemPrompt = text.trim();
      console.log("[Personality] personality.md loaded.");
    } else {
      console.warn("[Personality] personality.md is empty. Using default.");
    }
  } catch (error) {
    console.error("[Personality] Failed to load personality.md:", error);
  }
}

function ensurePersonalityLoaded() {
  if (!personalityLoadPromise) {
    personalityLoadPromise = loadPersonalityPrompt();
  }

  return personalityLoadPromise;
}

// Load API keys from the main process env bridge.
async function loadEnvConfig() {
  if (!window.env?.getAll) {
    console.warn("[Env] Bridge not available. API keys not loaded.");
    return;
  }

  try {
    const values = await window.env.getAll();
    envConfig = {
      GROQ_API_KEY: values?.GROQ_API_KEY || "",
      KOKORO_TTS_URL: values?.KOKORO_TTS_URL || "",
    };
    console.log("[Env] Environment keys loaded.");
  } catch (error) {
    console.error("[Env] Failed to load environment keys:", error);
  }
}

function ensureEnvLoaded() {
  if (!envLoadPromise) {
    envLoadPromise = loadEnvConfig();
  }

  return envLoadPromise;
}

function getEnvValue(key) {
  return envConfig[key] || "";
}

function appendChatMessage(role, text) {
  if (!chatLog) {
    return;
  }

  const message = document.createElement("div");
  message.className = `chat-message chat-message--${role}`;
  message.textContent = text;
  chatLog.appendChild(message);
  chatLog.scrollTop = chatLog.scrollHeight;
}

// Remove markdown emphasis and decorative formatting from AI responses.
function sanitizeResponse(text) {
  if (!text) {
    return "";
  }

  let output = text;

  // Strip markdown headings like "# Title".
  output = output.replace(/^\s{0,3}#{1,6}\s+/gm, "");

  // Replace bullet markers with simple dashes.
  output = output.replace(/^\s*[\*\+]\s+/gm, "- ");

  // Remove bold markers.
  output = output.replace(/\*\*(.+?)\*\*/g, "$1");
  output = output.replace(/__(.+?)__/g, "$1");

  // Remove italic markers with spacing boundaries to protect words like snake_case.
  output = output.replace(/(^|[\s])\*(\S[^*]*?)\*([\s]|$)/g, "$1$2$3");
  output = output.replace(/(^|[\s])_(\S[^_]*?)_([\s]|$)/g, "$1$2$3");

  // Trim extra spaces while keeping line breaks intact.
  output = output.replace(/[ \t]+/g, " ");

  return output.trim();
}

function revokeAudioUrl() {
  if (currentAudioUrl) {
    URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = null;
  }
}

audioPlayer.addEventListener("ended", () => {
  console.log("[TTS] Audio playback ended.");
  revokeAudioUrl();
  stopSpeaking();
  setTtsBusy(false);
  setStatus("Ready.");
});

audioPlayer.addEventListener("error", () => {
  console.log("[TTS] Audio playback error.");
  revokeAudioUrl();
  stopSpeaking();
  setTtsBusy(false);
  setStatus("Playback error.");
});

audioPlayer.addEventListener("play", () => {
  console.log("[TTS] Audio playback started.");
  startSpeaking();
});

// -------------------------------------------------
// Helper: play an ArrayBuffer as audio.
// -------------------------------------------------
async function playAudioBuffer(arrayBuffer, mimeType = "audio/wav") {
  const audioBlob = new Blob([arrayBuffer], { type: mimeType });
  revokeAudioUrl();
  currentAudioUrl = URL.createObjectURL(audioBlob);

  audioPlayer.pause();
  audioPlayer.src = currentAudioUrl;
  audioPlayer.currentTime = 0;
  await audioPlayer.play();
  setStatus("Playing...");
}

// -------------------------------------------------
// Primary TTS: local Kokoro
// -------------------------------------------------
async function tryKokoroTts(text) {
  if (!window.kokoroTts?.synthesize) {
    throw new Error("[Kokoro TTS] Bridge not available.");
  }

  console.log("[Using Kokoro local TTS]", { textLength: text.length });

  const rawArray = await window.kokoroTts.synthesize({
    text,
    voice: "af_heart",
    speed: 1.0,
  });

  const uint8 = new Uint8Array(rawArray);
  console.log("[Kokoro TTS] Audio received.", { bytes: uint8.byteLength });
  return uint8.buffer;
}

// -------------------------------------------------
// Main TTS entry point.
// Uses Kokoro local TTS only.
// -------------------------------------------------
async function requestSpeech(text, sourceLabel) {
  if (isUiBusy()) {
    setStatus("Busy. Please wait...");
    return;
  }

  if (!text) {
    setStatus("Type something first.");
    return;
  }

  setTtsBusy(true);
  startSpeaking();

  const labelSuffix = sourceLabel ? ` (${sourceLabel})` : "";
  setStatus(`Generating local voice${labelSuffix}...`);

  try {
    const audioData = await tryKokoroTts(text);
    await playAudioBuffer(audioData, "audio/wav");
  } catch (error) {
    console.error("[Kokoro TTS] Failed:", error);
    setStatus("Kokoro TTS unavailable. Check the local TTS server.");
    stopSpeaking();
    setTtsBusy(false);
  }
}

// Send a chat message to Groq and speak the response.
async function requestGroqResponse(userMessage) {
  if (isUiBusy()) {
    setStatus("Busy. Please wait...");
    return;
  }

  if (!userMessage) {
    setStatus("Type a message first.");
    return;
  }

  if (!window.groq?.generateResponse) {
    setStatus("Groq bridge failed to load.");
    return;
  }

  await ensureEnvLoaded();
  const groqApiKey = getEnvValue("GROQ_API_KEY");

  if (!groqApiKey) {
    setStatus("Set GROQ_API_KEY in .env.");
    return;
  }

  appendChatMessage("user", userMessage);
  setChatBusy(true);
  await ensurePersonalityLoaded();
  console.log("[Groq] Request start.", {
    textLength: userMessage.length,
    model: GROQ_MODEL_ID,
  });
  setStatus("Thinking...");

  try {
    const responseText = await window.groq.generateResponse({
      apiKey: groqApiKey,
      model: GROQ_MODEL_ID,
      systemPrompt: systemPrompt,
      history: chatHistory,
      message: userMessage,
    });

    const sanitizedResponse = sanitizeResponse(responseText || "");
    const cleanResponse =
      sanitizedResponse.trim() || "Sorry, I had trouble responding just now.";

    console.log("[Groq] Response received.", {
      chars: cleanResponse.length,
    });
    appendChatMessage("assistant", cleanResponse);

    // Groq uses OpenAI-compatible format: { role, content }.
    chatHistory.push(
      { role: "user", content: userMessage },
      { role: "assistant", content: cleanResponse },
    );

    setChatBusy(false);
    await requestSpeech(cleanResponse, "Groq");
  } catch (error) {
    console.error("[Groq] Request failed.", error);
    setStatus("Groq request failed. Check the console for details.");
    setChatBusy(false);
  }
}

async function handleTtsSubmit(event) {
  event.preventDefault();

  if (!ttsInput) {
    return;
  }

  const text = ttsInput.value.trim();
  ttsInput.value = "";
  await requestGroqResponse(text);
}

// Handle language button presses for preset introductions.
function handleLanguageButtonClick(event) {
  const button = event.currentTarget;
  const language = button?.dataset?.lang;
  const script = introScripts[language];

  if (!script) {
    setStatus("Missing intro text for this language.");
    return;
  }

  requestSpeech(script, language.toUpperCase());
}

if (ttsForm) {
  ttsForm.addEventListener("submit", handleTtsSubmit);
}

languageButtons.forEach((button) => {
  button.addEventListener("click", handleLanguageButtonClick);
});

ensurePersonalityLoaded();
ensureEnvLoaded();
