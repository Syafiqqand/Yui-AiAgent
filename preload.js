const { contextBridge, ipcRenderer } = require("electron");

// Expose a small Groq helper to the renderer with a safe API surface.
// The actual SDK runs in the main process to keep preload stable.
contextBridge.exposeInMainWorld("groq", {
  generateResponse: (payload) =>
    ipcRenderer.invoke("groq:generateResponse", payload),
});

// Load the personality prompt from a local Markdown file.
contextBridge.exposeInMainWorld("personality", {
  load: () => ipcRenderer.invoke("personality:read"),
});

// Load environment variables from the main process.
contextBridge.exposeInMainWorld("env", {
  getAll: () => ipcRenderer.invoke("env:getAll"),
});

// Local Kokoro TTS bridge.
contextBridge.exposeInMainWorld("kokoroTts", {
  synthesize: (payload) => ipcRenderer.invoke("tts:kokoroSynthesize", payload),
  deleteOutputFile: (payload) => ipcRenderer.invoke("tts:deleteOutputFile", payload),
});
