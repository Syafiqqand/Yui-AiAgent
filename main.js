const { app, BrowserWindow, ipcMain, Menu } = require("electron");
const path = require("path");
const fs = require("fs/promises");
const musicController = require("./src/main/musicController");

// Load environment variables from .env in the project root.
require("dotenv").config({ path: path.join(__dirname, ".env") });

const DEFAULT_TTS_CONFIG = {
  enabled: false,
  engine: "kokoro",
  serverUrl: "http://127.0.0.1:5005",
  fallbackToTextOnly: true,
};

const DEFAULT_THINKING_CONFIG = {
  enabled: true,
  message: "Thinking...",
  animations: ["thinking-1", "thinking-2"],
  animationDurationMs: 5000,
};

const TTS_OUTPUT_DIR = path.resolve(__dirname, "local-tts", "output");
const TTS_OUTPUT_MAX_AGE_MS = 60 * 60 * 1000;

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function normalizeServerUrl(url) {
  const serverUrl = String(url || DEFAULT_TTS_CONFIG.serverUrl).trim();
  return serverUrl.replace(/\/tts\/?$/, "").replace(/\/$/, "");
}

function buildTtsUrl(serverUrl, endpointPath) {
  return `${normalizeServerUrl(serverUrl)}${endpointPath}`;
}

function buildLocalTtsOutputPath(filename) {
  if (!filename) {
    return "";
  }

  return path.join(TTS_OUTPUT_DIR, path.basename(filename));
}

function isPathInsideTtsOutput(targetPath) {
  const resolvedOutputDir = path.resolve(TTS_OUTPUT_DIR);
  const resolvedTarget = path.resolve(targetPath);
  return resolvedTarget.startsWith(`${resolvedOutputDir}${path.sep}`);
}

function withTimeout(options = {}, timeoutMs = 1500) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  return {
    options: { ...options, signal: controller.signal },
    clear: () => clearTimeout(timeout),
  };
}

async function loadAppConfig() {
  const configPath = path.join(__dirname, "config", "app-config.json");
  let fileConfig = {};

  try {
    const rawConfig = await fs.readFile(configPath, "utf-8");
    fileConfig = JSON.parse(rawConfig);
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn("[Config] Failed to read app-config.json:", error);
    }
  }

  const fileTts = fileConfig.tts || {};
  const fileThinking = fileConfig.thinking || {};
  const envServerUrl = process.env.KOKORO_TTS_SERVER_URL || process.env.KOKORO_TTS_URL;

  // TTS_PROVIDER env var overrides config file engine setting.
  const resolvedEngine = (process.env.TTS_PROVIDER || fileTts.engine || DEFAULT_TTS_CONFIG.engine)
    .trim()
    .toLowerCase();

  return {
    tts: {
      enabled: parseBoolean(process.env.TTS_ENABLED, fileTts.enabled ?? DEFAULT_TTS_CONFIG.enabled),
      engine: resolvedEngine,
      serverUrl: normalizeServerUrl(envServerUrl || fileTts.serverUrl || DEFAULT_TTS_CONFIG.serverUrl),
      fallbackToTextOnly: parseBoolean(
        process.env.TTS_FALLBACK_TO_TEXT_ONLY,
        fileTts.fallbackToTextOnly ?? DEFAULT_TTS_CONFIG.fallbackToTextOnly,
      ),
    },
    thinking: {
      ...DEFAULT_THINKING_CONFIG,
      ...fileThinking,
      animations: Array.isArray(fileThinking.animations)
        ? fileThinking.animations
        : DEFAULT_THINKING_CONFIG.animations,
    },
  };
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const request = withTimeout(options, timeoutMs);

  try {
    return await fetch(url, request.options);
  } finally {
    request.clear();
  }
}

async function deleteTempTtsOutputFile(inputPath) {
  if (!inputPath || typeof inputPath !== "string") {
    return { deleted: false, reason: "missing-path" };
  }

  const targetPath = path.resolve(inputPath);
  const outputDirPath = path.resolve(TTS_OUTPUT_DIR);

  if (!isPathInsideTtsOutput(targetPath)) {
    console.warn("[TTS] refused to delete path outside output dir", targetPath);
    return { deleted: false, reason: "outside-output-dir" };
  }

  try {
    const outputDirRealPath = await fs.realpath(outputDirPath);
    const targetRealPath = await fs.realpath(targetPath);
    if (!targetRealPath.startsWith(`${outputDirRealPath}${path.sep}`)) {
      console.warn("[TTS] refused to delete path outside output dir", targetRealPath);
      return { deleted: false, reason: "outside-output-dir" };
    }

    await fs.unlink(targetPath);
    console.log("[TTS] deleted temp output:", targetPath);
    return { deleted: true };
  } catch (error) {
    if (error.code === "ENOENT") {
      console.log("[TTS] temp output already missing:", targetPath);
      return { deleted: false, missing: true };
    }

    console.warn("[TTS] failed to delete temp output:", targetPath, error);
    return { deleted: false, reason: error.message };
  }
}

async function cleanupOldTtsOutputFiles() {
  let deletedCount = 0;

  try {
    const entries = await fs.readdir(TTS_OUTPUT_DIR, { withFileTypes: true });
    const now = Date.now();

    for (const entry of entries) {
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".wav") {
        continue;
      }

      const targetPath = path.join(TTS_OUTPUT_DIR, entry.name);
      if (!isPathInsideTtsOutput(targetPath)) {
        continue;
      }

      const stat = await fs.stat(targetPath);
      if (now - stat.mtimeMs <= TTS_OUTPUT_MAX_AGE_MS) {
        continue;
      }

      const result = await deleteTempTtsOutputFile(targetPath);
      if (result.deleted) {
        deletedCount += 1;
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn("[TTS] cleanup old output files failed:", error);
    }
  }

  console.log("[TTS] cleanup old output files:", deletedCount, "deleted");
}

// Create the main application window.
function createWindow() {
  // Remove the native menu bar for a cleaner desktop companion feel.
  Menu.setApplicationMenu(null);

  const win = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: 1000,
    minHeight: 650,
    backgroundColor: "#ffffff",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  win.loadFile("index.html");

  win.webContents.on("console-message", (_event, level, message) => {
    const tags = ["log", "info", "warn", "error", "debug"];
    console.log(`[Renderer:${tags[level] || level}] ${message}`);
  });

  win.webContents.on("render-process-gone", (_event, webContents, details) => {
    console.error("[Electron] Render process gone:", details);
  });

  win.webContents.on("uncaught-exception", (_event, error) => {
    console.error("[Electron] Uncaught exception in renderer:", error);
  });

  return win;
}

// Initialize the app once Electron is ready.
app.whenReady().then(async () => {
  await cleanupOldTtsOutputFiles();
  createWindow();
});

// Quit on all windows closed (except on macOS).
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Re-create a window on macOS when the dock icon is clicked.
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Groq requests are handled in the main process to avoid preload failures.
ipcMain.handle("groq:generateResponse", async (_event, payload = {}) => {
  const { apiKey, model, systemPrompt, history, message } = payload;

  try {
    if (!apiKey) {
      throw new Error("Missing Groq API key.");
    }

    // Load the Groq SDK here so preload stays lightweight and safe.
    const Groq = require("groq-sdk");

    const groq = new Groq({ apiKey });

    // Build the messages array for the Groq chat completion.
    // System prompt goes first, then conversation history, then user message.
    const messages = [];

    // Add system prompt as the first message.
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }

    // Append conversation history.
    // History uses { role, content } format matching OpenAI/Groq convention.
    if (Array.isArray(history)) {
      messages.push(...history);
    }

    // Append the new user message.
    if (message) {
      messages.push({ role: "user", content: message });
    }

    // Send the chat completion request to Groq.
    const chatCompletion = await groq.chat.completions.create({
      messages,
      model: model || "llama-3.1-8b-instant",
    });

    // Extract the response text from the first choice.
    const responseText = chatCompletion?.choices?.[0]?.message?.content || "";

    return responseText;
  } catch (error) {
    console.error("[Groq] Main process error:", error);
    throw error;
  }
});

// Load personality.md for the AI system prompt.
ipcMain.handle("personality:read", async () => {
  try {
    const filePath = path.join(__dirname, "personality.md");
    return await fs.readFile(filePath, "utf-8");
  } catch (error) {
    console.error("[Personality] Failed to load personality.md:", error);
    return "";
  }
});

// Provide only the env keys that the renderer needs.
ipcMain.handle("env:getAll", async () => {
  const appConfig = await loadAppConfig();

  return {
    GROQ_API_KEY: process.env.GROQ_API_KEY || "",
    WEATHERSTACK_API_KEY: process.env.WEATHERSTACK_API_KEY || "",
    CALENDARIFIC_API_KEY: process.env.CALENDARIFIC_API_KEY || "",
    TTS_CONFIG: appConfig.tts,
    THINKING_CONFIG: appConfig.thinking,
  };
});

// Calendarific holidays fetch — retrieves public holidays for a given country and year.
ipcMain.handle("calendar:fetchHolidays", async (_event, payload = {}) => {
  const { apiKey, country = "ID", year, month } = payload;

  if (!apiKey) {
    throw new Error("[Calendar] Missing Calendarific API key.");
  }

  const resolvedYear = year || new Date().getFullYear();

  let url =
    `https://calendarific.com/api/v2/holidays` +
    `?api_key=${encodeURIComponent(apiKey)}` +
    `&country=${encodeURIComponent(country.toUpperCase())}` +
    `&year=${resolvedYear}`;

  if (month) {
    url += `&month=${month}`;
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`[Calendar] HTTP ${response.status}`);
    }

    const data = await response.json();

    if (data.meta?.code !== 200) {
      throw new Error(`[Calendar] API error: ${data.meta?.error_detail || JSON.stringify(data.meta)}`);
    }

    return data.response?.holidays || [];
  } catch (error) {
    console.error("[Calendar] Fetch failed:", error);
    throw error;
  }
});

// Weatherstack current weather fetch — runs in main process to avoid CORS issues.
ipcMain.handle("weather:fetch", async (_event, payload = {}) => {
  const { city, apiKey } = payload;

  if (!apiKey) {
    throw new Error("[Weather] Missing Weatherstack API key.");
  }

  if (!city || typeof city !== "string") {
    throw new Error("[Weather] Missing or invalid city name.");
  }

  // Weatherstack free tier only supports HTTP, not HTTPS.
  const url = `http://api.weatherstack.com/current?access_key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(city.trim())}&units=m`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`[Weather] HTTP ${response.status}`);
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(`[Weather] API error: ${data.error.info || JSON.stringify(data.error)}`);
    }

    return data;
  } catch (error) {
    console.error("[Weather] Fetch failed:", error);
    throw error;
  }
});

// Local TTS handler (Kokoro / Piper).
// Expects a local TTS server that returns WAV audio bytes.
// IPC channel name kept as "tts:kokoroSynthesize" for backward compatibility.
ipcMain.handle("tts:kokoroSynthesize", async (_event, payload = {}) => {
  const {
    text,
    voice = "af_heart",
    speed = 1.0,
    language = "id",
  } = payload;

  try {
    if (!text || typeof text !== "string") {
      throw new Error("[TTS] No text provided.");
    }

    const appConfig = await loadAppConfig();
    const ttsConfig = appConfig.tts;

    if (!ttsConfig.enabled) {
      throw new Error("[TTS] Realtime TTS is disabled.");
    }

    const activeEngine = ttsConfig.engine || "kokoro";
    const healthUrl = buildTtsUrl(ttsConfig.serverUrl, "/health");
    const endpoint = buildTtsUrl(ttsConfig.serverUrl, "/tts");

    console.log(`[TTS] Synthesizing locally via ${activeEngine}.`, {
      textLength: text.length,
      voice,
      speed,
      language,
      engine: activeEngine,
      serverUrl: ttsConfig.serverUrl,
    });

    const healthResponse = await fetchWithTimeout(healthUrl, {}, 1500);
    if (!healthResponse.ok) {
      throw new Error(`[TTS] Health check returned ${healthResponse.status}.`);
    }

    const response = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "audio/wav",
      },
      body: JSON.stringify({ text, voice, speed, language, engine: activeEngine }),
    }, 30000);

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(
        `[TTS] Server returned ${response.status}: ${errorBody || response.statusText}`,
      );
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    const outputFilename = response.headers.get("x-yui-tts-output-file") || "";
    const tempOutputPath = buildLocalTtsOutputPath(outputFilename);

    if (tempOutputPath) {
      console.log("[TTS] generated output:", tempOutputPath);
    }

    console.log(`[TTS] Audio ready (${activeEngine}).`, { bytes: audioBuffer.length });

    // Convert Buffer to a plain array so it can travel over Electron IPC.
    // The renderer reconstructs it as a Uint8Array for audio playback.
    return {
      audioBytes: Array.from(audioBuffer),
      tempOutputPath,
    };
  } catch (error) {
    console.warn("[TTS] Synthesis unavailable:", error);
    throw error;
  }
});

ipcMain.handle("tts:deleteOutputFile", async (_event, payload = {}) => {
  try {
    return await deleteTempTtsOutputFile(payload.path);
  } catch (error) {
    console.warn("[TTS] delete output handler failed:", error);
    return { deleted: false, reason: error.message };
  }
});

// -------------------------------------------------
// Yui Music Controller IPC handlers.
// Automates YouTube Music opening and playback using Playwright.
// -------------------------------------------------
ipcMain.handle("music:open-youtube", async () => {
  await musicController.openYouTubeMusic();
});

ipcMain.handle("music:play-youtube", async (_event, payload = {}) => {
  const query = typeof payload.query === "string" ? payload.query : "";
  return await musicController.playYouTubeMusic(query);
});
