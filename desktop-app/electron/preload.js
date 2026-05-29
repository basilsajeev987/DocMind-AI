const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  // LLM bridge
  start: () => ipcRenderer.send("llm-start"),
  sendPrompt: (payload) => ipcRenderer.send("llm-prompt", payload),

  // ✅ ADD THIS (you were missing it)
  sendASR: (payload) => ipcRenderer.send("llm-asr", payload),

  onMessage: (cb) => ipcRenderer.on("llm-message", (_, msg) => cb(msg)),
  onStatus: (cb) => ipcRenderer.on("llm-status", (_, status) => cb(status)),

  // Profiles
  profilesLoad: () => ipcRenderer.invoke("profiles-load"),
  profilesSave: (profiles) => ipcRenderer.invoke("profiles-save", profiles),

  // Sessions
  sessionsLoad: (profileId) => ipcRenderer.invoke("sessions-load", profileId),
  sessionsCreate: (profileId, name) =>
    ipcRenderer.invoke("sessions-create", profileId, name),
  sessionsRename: (profileId, sessionId, name) =>
    ipcRenderer.invoke("sessions-rename", profileId, sessionId, name),
  sessionsDelete: (profileId, sessionId) =>
    ipcRenderer.invoke("sessions-delete", profileId, sessionId),

  // History
  historyLoad: (profileId, sessionId) =>
    ipcRenderer.invoke("history-load", profileId, sessionId),
  historySave: (profileId, sessionId, history) =>
    ipcRenderer.invoke("history-save", profileId, sessionId, history),
  historyClear: (profileId, sessionId) =>
    ipcRenderer.invoke("history-clear", profileId, sessionId),

  // RAG
  pickFolder: () => ipcRenderer.invoke("pick-folder"),
  ragGetFolder: () => ipcRenderer.invoke("rag-get-folder"),
  ragSetFolder: (folderPath) =>
    ipcRenderer.invoke("rag-set-folder", folderPath),

  // Open sources
  openPath: (p) => ipcRenderer.invoke("open-path", p),
  showItemInFolder: (p) => ipcRenderer.invoke("show-item-in-folder", p),

  // Tasks
  tasksLoad: () => ipcRenderer.invoke("tasks-load"),
  tasksAdd: (task) => ipcRenderer.invoke("tasks-add", task),
  tasksToggleDone: (taskId) => ipcRenderer.invoke("tasks-toggle", taskId),
  tasksDelete: (taskId) => ipcRenderer.invoke("tasks-delete", taskId),

  // Reminder event
  onReminder: (cb) => ipcRenderer.on("task-reminder", (_, task) => cb(task)),
});
