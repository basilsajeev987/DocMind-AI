const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  Notification,
} = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const fs = require("fs");

const isDev = !app.isPackaged;

// ✅ declare FIRST
let win = null;
let py = null;

// ---------- helpers ----------
function safeId(s) {
  return String(s || "default").replace(/[^a-zA-Z0-9_-]/g, "_");
}
function nowISO() {
  return new Date().toISOString();
}
function genId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
function ensureDir(p) {
  try {
    fs.mkdirSync(p, { recursive: true });
  } catch {}
}

// ---------- profiles ----------
function profilesPath() {
  return path.join(app.getPath("userData"), "profiles.json");
}
function defaultProfiles() {
  return [
    {
      id: "coding",
      name: "Coding",
      system: "You are Basil's coding assistant. Be concise and practical.",
    },
    {
      id: "study",
      name: "Study",
      system: "You are Basil's tutor. Explain clearly with examples.",
    },
    {
      id: "personal",
      name: "Personal",
      system:
        "You are Basil's personal assistant. Help with planning and writing.",
    },
  ];
}
function loadProfiles() {
  try {
    const p = JSON.parse(fs.readFileSync(profilesPath(), "utf8"));
    if (Array.isArray(p) && p.length) return p;
  } catch {}
  return defaultProfiles();
}
function saveProfiles(profiles) {
  fs.writeFileSync(profilesPath(), JSON.stringify(profiles, null, 2), "utf8");
}

// ---------- sessions ----------
function sessionsPath() {
  return path.join(app.getPath("userData"), "sessions.json");
}
function loadSessionsMap() {
  try {
    return JSON.parse(fs.readFileSync(sessionsPath(), "utf8")) || {};
  } catch {
    return {};
  }
}
function saveSessionsMap(map) {
  fs.writeFileSync(sessionsPath(), JSON.stringify(map, null, 2), "utf8");
}
function getSessions(profileId) {
  const map = loadSessionsMap();
  const key = safeId(profileId);
  const arr = Array.isArray(map[key]) ? map[key] : [];
  if (arr.length === 0) {
    const def = [{ id: "default", name: "Default", created_at: nowISO() }];
    map[key] = def;
    saveSessionsMap(map);
    return def;
  }
  return arr;
}
function setSessions(profileId, sessions) {
  const map = loadSessionsMap();
  map[safeId(profileId)] = sessions;
  saveSessionsMap(map);
}

// ---------- history per (profile, session) ----------
function historyPath(profileId, sessionId) {
  const p = safeId(profileId);
  const s = safeId(sessionId || "default");
  return path.join(app.getPath("userData"), `history_${p}_${s}.json`);
}
function loadHistory(profileId, sessionId) {
  try {
    return JSON.parse(
      fs.readFileSync(historyPath(profileId, sessionId), "utf8")
    );
  } catch {
    return [];
  }
}
function saveHistory(profileId, sessionId, history) {
  fs.writeFileSync(
    historyPath(profileId, sessionId),
    JSON.stringify(history, null, 2),
    "utf8"
  );
}
function deleteHistoryFile(profileId, sessionId) {
  try {
    fs.unlinkSync(historyPath(profileId, sessionId));
  } catch {}
}

// ---------- rag folder ----------
function ragConfigPath() {
  return path.join(app.getPath("userData"), "rag_config.json");
}
function loadRagFolder() {
  try {
    const cfg = JSON.parse(fs.readFileSync(ragConfigPath(), "utf8"));
    return cfg?.folderPath || "";
  } catch {
    return "";
  }
}
function saveRagFolder(folderPath) {
  fs.writeFileSync(
    ragConfigPath(),
    JSON.stringify({ folderPath }, null, 2),
    "utf8"
  );
}

// ---------- tasks/reminders ----------
function tasksPath() {
  return path.join(app.getPath("userData"), "tasks.json");
}
function loadTasks() {
  try {
    const t = JSON.parse(fs.readFileSync(tasksPath(), "utf8"));
    return Array.isArray(t) ? t : [];
  } catch {
    return [];
  }
}
function saveTasks(tasks) {
  fs.writeFileSync(tasksPath(), JSON.stringify(tasks, null, 2), "utf8");
}

const reminderTimers = new Map();
function clearAllTimers() {
  for (const t of reminderTimers.values()) {
    try {
      clearTimeout(t);
    } catch {}
  }
  reminderTimers.clear();
}
function scheduleReminders() {
  clearAllTimers();
  const tasks = loadTasks();

  for (const task of tasks) {
    if (!task || task.done) continue;
    if (!task.dueISO) continue;

    const due = new Date(task.dueISO).getTime();
    if (!Number.isFinite(due)) continue;

    const ms = due - Date.now();
    if (ms <= 0) continue;

    const timer = setTimeout(() => {
      try {
        const title = "Reminder";
        const body = task.text || "Task reminder";
        if (Notification.isSupported())
          new Notification({ title, body }).show();
        win?.webContents?.send("task-reminder", task);
      } catch {}
    }, ms);

    reminderTimers.set(task.id, timer);
  }
}

// ---------- electron window ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1120,
    height: 860,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    win.loadURL("http://localhost:5173");
  } else {
    // ✅ packaged path (UI dist must be included by electron-builder)
     const indexPath = path.join(
       process.resourcesPath,
       "ui",
       "dist",
       "index.html"
     );
    win.loadFile(indexPath);
    win.webContents.openDevTools({ mode: "detach" });

  }


  win.setMenuBarVisibility(false);
}

// ---------- python backend ----------
// ---------- python backend ----------
function startPython() {
  if (app.isPackaged) {
    const exePath = path.join(process.resourcesPath, "app_server.exe");
    py = spawn(exePath, [], { stdio: ["pipe", "pipe", "pipe"] });
  } else {
    const pyPath = "C:\\Games\\miniconda\\envs\\qwen\\python.exe";
    const scriptPath = path.resolve(
      __dirname,
      "..",
      "..",
      
      "app_server.py",
    );

    py = spawn(pyPath, [scriptPath], { stdio: ["pipe", "pipe", "pipe"] });
  }

  win?.webContents.send("llm-status", "loading model...");

  // ✅ You removed your stdout listener earlier — add it back or you will NEVER see "ready"
  py.stdout.on("data", (data) => {
    const lines = data.toString().split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        win?.webContents.send("llm-message", msg);
        if (msg.type === "ready") win?.webContents.send("llm-status", "ready");
      } catch {}
    }
  });

  py.stderr.on("data", (data) => {
    win?.webContents.send("llm-message", {
      type: "error",
      message: data.toString(),
    });
  });

  py.on("close", () => {
    win?.webContents.send("llm-status", "stopped");
    py = null;
  });
}





// ---------- IPC ----------
ipcMain.on("llm-start", () => {
  startPython();
});

ipcMain.on("llm-prompt", (_, payload) => {
  if (!py) startPython(); // auto restart
  if (!py) return;
  py.stdin.write(JSON.stringify({ type: "prompt", ...payload }) + "\n");
});

ipcMain.on("llm-asr", (_, payload) => {
  if (!py) return;
  py.stdin.write(JSON.stringify({ type: "asr", ...payload }) + "\n");
});

// Profiles
ipcMain.handle("profiles-load", () => loadProfiles());
ipcMain.handle("profiles-save", (_, profiles) => {
  saveProfiles(profiles);
  return true;
});

// Sessions
ipcMain.handle("sessions-load", (_, profileId) => getSessions(profileId));
ipcMain.handle("sessions-create", (_, profileId, name) => {
  const sessions = getSessions(profileId);
  const id = genId("sess");
  const newSession = {
    id,
    name: (name || "New Session").trim() || "New Session",
    created_at: nowISO(),
  };
  const next = [newSession, ...sessions];
  setSessions(profileId, next);
  return newSession;
});
ipcMain.handle("sessions-rename", (_, profileId, sessionId, name) => {
  const sessions = getSessions(profileId);
  const next = sessions.map((s) =>
    s.id === sessionId ? { ...s, name: (name || s.name).trim() || s.name } : s
  );
  setSessions(profileId, next);
  return true;
});
ipcMain.handle("sessions-delete", (_, profileId, sessionId) => {
  if (sessionId === "default") return false;
  const sessions = getSessions(profileId);
  const next = sessions.filter((s) => s.id !== sessionId);
  if (next.length === 0)
    next.push({ id: "default", name: "Default", created_at: nowISO() });
  setSessions(profileId, next);
  deleteHistoryFile(profileId, sessionId);
  return true;
});

// History
ipcMain.handle("history-load", (_, profileId, sessionId) =>
  loadHistory(profileId, sessionId)
);
ipcMain.handle("history-save", (_, profileId, sessionId, history) => {
  saveHistory(profileId, sessionId, history);
  return true;
});
ipcMain.handle("history-clear", (_, profileId, sessionId) => {
  saveHistory(profileId, sessionId, []);
  return true;
});

// RAG folder
ipcMain.handle("pick-folder", async () => {
  const result = await dialog.showOpenDialog(win, {
    properties: ["openDirectory"],
    title: "Select a folder for RAG",
  });
  if (result.canceled || !result.filePaths?.length) return "";
  return result.filePaths[0];
});
ipcMain.handle("rag-get-folder", () => loadRagFolder());
ipcMain.handle("rag-set-folder", (_, folderPath) => {
  saveRagFolder(folderPath || "");
  return true;
});

// Open sources
ipcMain.handle("open-path", async (_, p) => {
  try {
    if (!p) return false;
    await shell.openPath(p);
    return true;
  } catch {
    return false;
  }
});
ipcMain.handle("show-item-in-folder", async (_, p) => {
  try {
    if (!p) return false;
    shell.showItemInFolder(p);
    return true;
  } catch {
    return false;
  }
});

// Tasks
ipcMain.handle("tasks-load", () => loadTasks());
ipcMain.handle("tasks-add", (_, task) => {
  const tasks = loadTasks();
  const t = {
    id: genId("task"),
    text: String(task?.text || "").trim() || "Untitled task",
    dueISO: task?.dueISO ? String(task.dueISO) : "",
    done: false,
    createdISO: nowISO(),
  };
  const next = [t, ...tasks];
  saveTasks(next);
  scheduleReminders();
  return t;
});
ipcMain.handle("tasks-toggle", (_, taskId) => {
  const tasks = loadTasks();
  const next = tasks.map((t) =>
    t.id === taskId ? { ...t, done: !t.done } : t
  );
  saveTasks(next);
  scheduleReminders();
  return true;
});
ipcMain.handle("tasks-delete", (_, taskId) => {
  const tasks = loadTasks();
  const next = tasks.filter((t) => t.id !== taskId);
  saveTasks(next);
  scheduleReminders();
  return true;
});

// ---------- app lifecycle ----------
app.whenReady().then(() => {
  ensureDir(app.getPath("userData"));
  createWindow();
  scheduleReminders();
  app.on(
    "activate",
    () => BrowserWindow.getAllWindows().length === 0 && createWindow()
  );
});

app.on("window-all-closed", () => {
  if (py) {
    try {
      py.stdin.write(JSON.stringify({ type: "exit" }) + "\n");
    } catch {}
    try {
      py.kill();
    } catch {}
  }
  if (process.platform !== "darwin") app.quit();
});
