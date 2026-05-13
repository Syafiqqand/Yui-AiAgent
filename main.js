const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs/promises");

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

// Gemini requests are handled in the main process to avoid preload failures.
ipcMain.handle("gemini:generateResponse", async (_event, payload = {}) => {
  const { apiKey, model, systemPrompt, history, message } = payload;

  try {
    if (!apiKey) {
      throw new Error("Missing Gemini API key.");
    }

    // Load the SDK here so preload stays lightweight and safe.
    const { GoogleGenerativeAI } = require("@google/generative-ai");

    const genAI = new GoogleGenerativeAI(apiKey);
    const generativeModel = genAI.getGenerativeModel({
      model: model || "gemini-2.5-flash",
      systemInstruction: systemPrompt || "",
    });

    const chat = generativeModel.startChat({
      history: Array.isArray(history) ? history : [],
    });

    const result = await chat.sendMessage(message || "");
    if (!result?.response?.text) {
      return "";
    }

    return result.response.text();
  } catch (error) {
    console.error("[Gemini] Main process error:", error);
    throw error;
  }
});

// Load personality.md for the Gemini system prompt.
ipcMain.handle("personality:read", async () => {
  try {
    const filePath = path.join(__dirname, "personality.md");
    return await fs.readFile(filePath, "utf-8");
  } catch (error) {
    console.error("[Personality] Failed to load personality.md:", error);
    return "";
  }
});
