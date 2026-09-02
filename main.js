const { app, BrowserWindow, ipcMain, Menu } = require("electron");
const path = require("path");
const fs = require("fs/promises");
const { spawn } = require("child_process");
const musicController = require("./src/main/musicController");

// Load environment variables from .env in the project root.
require("dotenv").config({ path: path.join(__dirname, ".env") });

const DEFAULT_TTS_CONFIG = {
  enabled: true,
  engine: "supertonic",
  serverUrl: "http://127.0.0.1:7788",
  fallbackToTextOnly: false,
};

const DEFAULT_THINKING_CONFIG = {
  enabled: true,
  message: "Thinking...",
  animations: ["thinking-1", "thinking-2"],
  animationDurationMs: 5000,
};

const TTS_OUTPUT_DIR = path.resolve(__dirname, "local-tts", "output");
const TTS_OUTPUT_MAX_AGE_MS = 60 * 60 * 1000;

// Supertonic server management
let supertonicProcess = null;
let supertonicServerReady = false;
let supertonicStartPromise = null;
const SUPERTONIC_HOST = process.env.SUPERTONIC_HOST || "127.0.0.1";
const SUPERTONIC_PORT = parseInt(process.env.SUPERTONIC_PORT || "7788", 10);
const SUPERTONIC_URL = `http://${SUPERTONIC_HOST}:${SUPERTONIC_PORT}`;

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

  return {
    tts: {
      enabled: parseBoolean(process.env.TTS_ENABLED, fileTts.enabled ?? DEFAULT_TTS_CONFIG.enabled),
      engine: (process.env.TTS_PROVIDER || fileTts.engine || DEFAULT_TTS_CONFIG.engine).trim().toLowerCase(),
      serverUrl: normalizeServerUrl(process.env.SUPERTONIC_URL || fileTts.serverUrl || DEFAULT_TTS_CONFIG.serverUrl),
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

// --- Supertonic Server Management ---

async function startSupertonicServer() {
  if (supertonicProcess) {
    console.log("[Supertonic] Server process already running");
    return;
  }

  const pythonExe = findPythonExecutable();
  if (!pythonExe) {
    throw new Error("[Supertonic] Python executable not found. Please ensure Python is installed.");
  }

  const serverScript = path.join(__dirname, "local-tts", "supertonic_server.py");
  const env = {
    ...process.env,
    SUPERTONIC_HOST,
    SUPERTONIC_PORT: String(SUPERTONIC_PORT),
    SUPERTONIC_MODEL: process.env.SUPERTONIC_MODEL || "supertonic-3",
    SUPERTONIC_VOICE: process.env.SUPERTONIC_VOICE || "F1",
    SUPERTONIC_LANG: process.env.SUPERTONIC_LANG || "id",
    SUPERTONIC_STEPS: process.env.SUPERTONIC_STEPS || "8",
    SUPERTONIC_SPEED: process.env.SUPERTONIC_SPEED || "1.05",
  };

  console.log("[Supertonic] Starting server...");
  console.log("[Supertonic] Using Python:", pythonExe);
  console.log("[Supertonic] Server URL:", SUPERTONIC_URL);

  supertonicProcess = spawn(pythonExe, [serverScript], {
    env,
    cwd: path.join(__dirname, "local-tts"),
    windowsHide: true,
  });

  supertonicProcess.stdout?.on("data", (data) => {
    const msg = data.toString().trim();
    if (msg) console.log("[Supertonic:stdout]", msg);
  });

  supertonicProcess.stderr?.on("data", (data) => {
    const msg = data.toString().trim();
    if (msg) console.warn("[Supertonic:stderr]", msg);
  });

  supertonicProcess.on("close", (code) => {
    console.log("[Supertonic] Server process exited with code:", code);
    supertonicProcess = null;
    supertonicServerReady = false;
  });

  supertonicProcess.on("error", (err) => {
    console.error("[Supertonic] Process error:", err);
    supertonicProcess = null;
    supertonicServerReady = false;
  });

  // Wait for server to be ready
  await waitForSupertonicReady();
}

function findPythonExecutable() {
  // Try common Python executables on Windows
  const candidates = [
    path.join(__dirname, ".venv", "Scripts", "python.exe"),
    "python",
    "python3",
    "py",
  ];

  for (const cmd of candidates) {
    try {
      // We can't easily test without spawning, so just return the venv one if it exists
      if (cmd.includes(".venv")) {
        if (require("fs").existsSync(cmd)) {
          return cmd;
        }
      } else {
        // For system python, we'll just try it
        return cmd;
      }
    } catch (e) {
      // continue
    }
  }
  return null;
}

async function waitForSupertonicReady(timeoutMs = 120000) {
  const startTime = Date.now();
  const healthUrl = `${SUPERTONIC_URL}/health`;

  console.log("[Supertonic] Waiting for server to be ready...");

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(healthUrl, { method: "GET" });
      if (response.ok) {
        const data = await response.json();
        console.log("[Supertonic] Server ready:", data);
        supertonicServerReady = true;
        return;
      }
    } catch (e) {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  throw new Error(`[Supertonic] Server did not become ready within ${timeoutMs}ms`);
}

async function ensureSupertonicReady() {
  if (supertonicServerReady && supertonicProcess) {
    // Quick health check
    try {
      const response = await fetch(`${SUPERTONIC_URL}/health`, { method: "GET" });
      if (response.ok) {
        return;
      }
    } catch (e) {
      // Fall through to restart
    }
  }

  if (supertonicStartPromise) {
    await supertonicStartPromise;
    return;
  }

  supertonicStartPromise = startSupertonicServer().catch((err) => {
    supertonicStartPromise = null;
    throw err;
  });

  await supertonicStartPromise;
  supertonicStartPromise = null;
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

// Create the main application window.
function createWindow() {
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

  // Initialize Supertonic server after window is created
  try {
    await ensureSupertonicReady();
    console.log("[Supertonic] TTS system ready");
  } catch (err) {
    console.error("[Supertonic] Failed to start:", err);
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Cleanup on app quit
app.on("before-quit", async () => {
  console.log("[Supertonic] App quitting, cleaning up...");
  if (supertonicProcess) {
    supertonicProcess.kill();
    supertonicProcess = null;
  }
  // Clean up any remaining temp audio files
  await cleanupOldTtsOutputFiles();
});

// B.AI requests
ipcMain.handle("bai:generateResponse", async (_event, payload = {}) => {
  const { apiKey, baseUrl, model, systemPrompt, history, message } = payload;

  try {
    if (!apiKey) {
      throw new Error("Missing B.AI API key.");
    }

    const messages = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    if (Array.isArray(history)) {
      messages.push(...history);
    }
    if (message) {
      messages.push({ role: "user", content: message });
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.7,
        max_tokens: 2048,
        stream: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`B.AI HTTP ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "";
  } catch (error) {
    console.error("[B.AI] Main process error:", error);
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
    BAI_API_KEY: process.env.BAI_API_KEY || "",
    BAI_BASE_URL: process.env.BAI_BASE_URL || "https://api.b.ai/v1",
    BAI_MODEL: process.env.BAI_MODEL || "mimo-v2.5",
    WEATHERSTACK_API_KEY: process.env.WEATHERSTACK_API_KEY || "",
    CALENDARIFIC_API_KEY: process.env.CALENDARIFIC_API_KEY || "",
    TTS_CONFIG: appConfig.tts,
    THINKING_CONFIG: appConfig.thinking,
  };
});

// Calendarific holidays fetch
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

// Weatherstack current weather fetch
ipcMain.handle("weather:fetch", async (_event, payload = {}) => {
  const { city, apiKey } = payload;

  if (!apiKey) {
    throw new Error("[Weather] Missing Weatherstack API key.");
  }

  if (!city || typeof city !== "string") {
    throw new Error("[Weather] Missing or invalid city name.");
  }

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

// Supertonic TTS handler
ipcMain.handle("tts:supertonicSynthesize", async (_event, payload = {}) => {
  const {
    text,
    voice = "F1",
    lang = "id",
    steps = 8,
    speed = 1.05,
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

    // Ensure Supertonic server is ready
    await ensureSupertonicReady();

    const endpoint = `${SUPERTONIC_URL}/v1/tts`;

    console.log("[Supertonic] Synthesizing...", {
      textLength: text.length,
      voice,
      lang,
      steps,
      speed,
    });

    const response = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "audio/wav",
      },
      body: JSON.stringify({ text, voice, lang, steps, speed }),
    }, 60000); // Longer timeout for synthesis

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
      console.log("[Supertonic] Generated output:", tempOutputPath);
    }

    console.log("[Supertonic] Audio ready.", { bytes: audioBuffer.length });

    return {
      audioBytes: Array.from(audioBuffer),
      tempOutputPath,
    };
  } catch (error) {
    console.warn("[Supertonic] Synthesis unavailable:", error);
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

// Yui Music Controller IPC handlers.
ipcMain.handle("music:open-youtube", async () => {
  await musicController.openYouTubeMusic();
});

ipcMain.handle("music:play-youtube", async (_event, payload = {}) => {
  const query = typeof payload.query === "string" ? payload.query : "";
  return await musicController.playYouTubeMusic(query);
});