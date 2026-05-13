const { contextBridge, ipcRenderer } = require("electron");

// Expose a small Gemini helper to the renderer with a safe API surface.
// The actual SDK runs in the main process to keep preload stable.
contextBridge.exposeInMainWorld("gemini", {
  generateResponse: (payload) =>
    ipcRenderer.invoke("gemini:generateResponse", payload),
});

// Load the personality prompt from a local Markdown file.
contextBridge.exposeInMainWorld("personality", {
  load: () => ipcRenderer.invoke("personality:read"),
});

// Load environment variables from the main process.
contextBridge.exposeInMainWorld("env", {
  getAll: () => ipcRenderer.invoke("env:getAll"),
});
