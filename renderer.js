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
}

// Return to idle mode after speaking finishes.
function stopSpeaking() {
  if (mode !== "speaking") {
    return;
  }

  mode = "idle";
  beginTransitionToClip("idle-main", { force: true });
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
// ElevenLabs text-to-speech (TTS) configuration
// -------------------------------------------------
// API keys are loaded from .env via the main process.
const ELEVENLABS_MODEL_ID = "eleven_flash_v2_5";

// -------------------------------------------------
// Gemini configuration
// -------------------------------------------------
// API keys are loaded from .env via the main process.
const GEMINI_MODEL_ID = "gemini-2.5-flash";
const DEFAULT_PERSONALITY =
  "You are Yui, a friendly virtual AI assistant. Be warm, supportive, conversational, and slightly playful. Use clean plain text only. Avoid markdown formatting such as bold, italic, headings, or decorative lists. Keep responses natural and easy to understand.";
let geminiSystemPrompt = DEFAULT_PERSONALITY;
let personalityLoadPromise = null;
let envLoadPromise = null;
let envConfig = {
  GEMINI_API_KEY: "",
  ELEVENLABS_API_KEY: "",
  ELEVENLABS_VOICE_ID: "",
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
      geminiSystemPrompt = text.trim();
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
      GEMINI_API_KEY: values?.GEMINI_API_KEY || "",
      ELEVENLABS_API_KEY: values?.ELEVENLABS_API_KEY || "",
      ELEVENLABS_VOICE_ID: values?.ELEVENLABS_VOICE_ID || "",
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

function decodeArrayBuffer(data) {
  try {
    const decoder = new TextDecoder("utf-8");
    return decoder.decode(new Uint8Array(data));
  } catch (error) {
    return "";
  }
}

function extractApiMessage(payload) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  if (payload.detail?.message) {
    return payload.detail.message;
  }

  if (payload.message) {
    return payload.message;
  }

  if (payload.error) {
    return payload.error;
  }

  return "";
}

function getAxiosErrorDetails(error) {
  const status = error?.response?.status;
  const rawData = error?.response?.data;

  let bodyText = "";
  let apiMessage = "";

  if (rawData instanceof ArrayBuffer) {
    bodyText = decodeArrayBuffer(rawData);
  } else if (typeof rawData === "string") {
    bodyText = rawData;
  } else if (rawData && typeof rawData === "object") {
    bodyText = JSON.stringify(rawData);
  }

  if (bodyText) {
    try {
      const parsed = JSON.parse(bodyText);
      apiMessage = extractApiMessage(parsed);
      bodyText = JSON.stringify(parsed);
    } catch (parseError) {
      apiMessage = "";
    }
  }

  if (!apiMessage) {
    apiMessage = error?.message || "Request failed";
  }

  return {
    status,
    bodyText: bodyText || "(no response body)",
    apiMessage,
  };
}

// Send a TTS request and play the resulting audio.
async function requestSpeech(text, sourceLabel) {
  if (isUiBusy()) {
    setStatus("Busy. Please wait...");
    return;
  }

  if (!text) {
    setStatus("Type something first.");
    return;
  }

  if (!window.axios) {
    setStatus("Axios failed to load.");
    return;
  }

  await ensureEnvLoaded();
  const elevenLabsKey = getEnvValue("ELEVENLABS_API_KEY");
  const elevenLabsVoiceId = getEnvValue("ELEVENLABS_VOICE_ID");

  if (!elevenLabsKey || !elevenLabsVoiceId) {
    setStatus("Set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID in .env.");
    return;
  }

  setTtsBusy(true);
  startSpeaking();

  const labelSuffix = sourceLabel ? ` (${sourceLabel})` : "";
  console.log("[TTS] Request start.", {
    source: sourceLabel || "custom",
    textLength: text.length,
    voiceId: elevenLabsVoiceId,
    modelId: ELEVENLABS_MODEL_ID,
  });
  setStatus(`Generating voice${labelSuffix}...`);

  try {
    const response = await window.axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${elevenLabsVoiceId}`,
      {
        text,
        model_id: ELEVENLABS_MODEL_ID,
        voice_settings: {
          stability: 0.4,
          similarity_boost: 0.6,
        },
      },
      {
        headers: {
          "xi-api-key": elevenLabsKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        responseType: "arraybuffer",
      },
    );

    console.log("[TTS] Request success.", {
      status: response.status,
    });
    console.log("[TTS] Audio received.", {
      bytes: response.data?.byteLength,
    });

    const audioBlob = new Blob([response.data], { type: "audio/mpeg" });
    revokeAudioUrl();
    currentAudioUrl = URL.createObjectURL(audioBlob);

    audioPlayer.pause();
    audioPlayer.src = currentAudioUrl;
    audioPlayer.currentTime = 0;
    await audioPlayer.play();
    setStatus("Playing...");
  } catch (error) {
    const details = getAxiosErrorDetails(error);
    console.error("[TTS] Request failed.", error);
    console.error("[TTS] Full error response:", error?.response || error);
    console.error("[TTS] Error details:", details);

    setStatus(
      `Error ${details.status || "Unknown"}: ${details.apiMessage} | Body: ${details.bodyText}`,
    );
    stopSpeaking();
    setTtsBusy(false);
  }
}

// Send a chat message to Gemini and speak the response.
async function requestGeminiResponse(userMessage) {
  if (isUiBusy()) {
    setStatus("Busy. Please wait...");
    return;
  }

  if (!userMessage) {
    setStatus("Type a message first.");
    return;
  }

  if (!window.gemini?.generateResponse) {
    setStatus("Gemini bridge failed to load.");
    return;
  }

  await ensureEnvLoaded();
  const geminiApiKey = getEnvValue("GEMINI_API_KEY");

  if (!geminiApiKey) {
    setStatus("Set GEMINI_API_KEY in .env.");
    return;
  }

  appendChatMessage("user", userMessage);
  setChatBusy(true);
  await ensurePersonalityLoaded();
  console.log("[Gemini] Request start.", {
    textLength: userMessage.length,
    model: GEMINI_MODEL_ID,
  });
  setStatus("Thinking...");

  try {
    const responseText = await window.gemini.generateResponse({
      apiKey: geminiApiKey,
      model: GEMINI_MODEL_ID,
      systemPrompt: geminiSystemPrompt,
      history: chatHistory,
      message: userMessage,
    });

    const sanitizedResponse = sanitizeResponse(responseText || "");
    const cleanResponse =
      sanitizedResponse.trim() || "Sorry, I had trouble responding just now.";

    console.log("[Gemini] Response received.", {
      chars: cleanResponse.length,
    });
    appendChatMessage("assistant", cleanResponse);
    chatHistory.push(
      { role: "user", parts: [{ text: userMessage }] },
      { role: "model", parts: [{ text: cleanResponse }] },
    );

    setChatBusy(false);
    await requestSpeech(cleanResponse, "Gemini");
  } catch (error) {
    console.error("[Gemini] Request failed.", error);
    setStatus("Gemini request failed. Check the console for details.");
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
  await requestGeminiResponse(text);
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
