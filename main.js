const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs/promises");

// Load environment variables from .env in the project root.
require("dotenv").config({ path: path.join(__dirname, ".env") });

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
    ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY || "",
    ELEVENLABS_VOICE_ID: process.env.ELEVENLABS_VOICE_ID || "",
  };
});
