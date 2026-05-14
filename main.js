const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs/promises");

// Load environment variables from .env in the project root.
require("dotenv").config({ path: path.join(__dirname, ".env") });

const DEFAULT_KOKORO_TTS_URL = "http://127.0.0.1:5005/tts";

// Create the main application window.
function createWindow() {
  const win = new BrowserWindow({
    width: 450,
    height: 800,
    backgroundColor: "#ffffff",
    webPreferences: {
      // Keep the renderer isolated for safety and future expansion.
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  win.loadFile("index.html");
}

// Initialize the app once Electron is ready.
app.whenReady().then(createWindow);

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
  return {
    GROQ_API_KEY: process.env.GROQ_API_KEY || "",
    KOKORO_TTS_URL: process.env.KOKORO_TTS_URL || DEFAULT_KOKORO_TTS_URL,
  };
});

// Kokoro local TTS handler.
// Expects a local TTS server that returns WAV audio bytes.
ipcMain.handle("tts:kokoroSynthesize", async (_event, payload = {}) => {
  const { text, voice = "af_heart", speed = 1.0 } = payload;

  try {
    if (!text || typeof text !== "string") {
      throw new Error("[Kokoro TTS] No text provided.");
    }

    const endpoint = process.env.KOKORO_TTS_URL || DEFAULT_KOKORO_TTS_URL;
    console.log("[Kokoro TTS] Synthesizing locally.", {
      textLength: text.length,
      voice,
      speed,
    });

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "audio/wav",
      },
      body: JSON.stringify({ text, voice, speed }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(
        `[Kokoro TTS] Server returned ${response.status}: ${errorBody || response.statusText}`,
      );
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    console.log("[Kokoro TTS] Audio ready.", { bytes: audioBuffer.length });

    // Convert Buffer to a plain array so it can travel over Electron IPC.
    // The renderer reconstructs it as a Uint8Array for audio playback.
    return Array.from(audioBuffer);
  } catch (error) {
    console.error("[Kokoro TTS] Synthesis failed:", error);
    throw error;
  }
});