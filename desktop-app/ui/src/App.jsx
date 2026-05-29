import { useEffect, useMemo, useRef, useState } from "react";

function uid() {
  return "p_" + Math.random().toString(36).slice(2, 10);
}
function rid() {
  return "r_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
}

export default function App() {
  const hasBackend = useMemo(
    () => typeof window !== "undefined" && !!window.api,
    [],
  );

  const [status, setStatus] = useState("starting...");
  const [profiles, setProfiles] = useState([]);
  const [profileId, setProfileId] = useState("coding");

  const profile = useMemo(
    () => profiles.find((p) => p.id === profileId) || profiles[0],
    [profiles, profileId],
  );

  // Sessions
  const [sessions, setSessions] = useState([]);
  const [sessionId, setSessionId] = useState("default");
  const session = useMemo(
    () => sessions.find((s) => s.id === sessionId) || sessions[0],
    [sessions, sessionId],
  );

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([
    { role: "assistant", text: "Local assistant ready." },
  ]);

  const startedRef = useRef(false);
  const scrollRef = useRef(null);

  // Profile editor
  const [showEditor, setShowEditor] = useState(false);
  const [editName, setEditName] = useState("");
  const [editSystem, setEditSystem] = useState("");

  // RAG (keyword-only)
  const [ragEnabled, setRagEnabled] = useState(false);
  const [ragFolder, setRagFolder] = useState("");

  // Tasks
  const [tasks, setTasks] = useState([]);
  const [taskText, setTaskText] = useState("");
  const [taskDueLocal, setTaskDueLocal] = useState("");

  // TTS
  const [ttsEnabled, setTtsEnabled] = useState(false);

  // Voice recording (ASR)
  const [isRecording, setIsRecording] = useState(false);
  const mediaStreamRef = useRef(null);
  const audioCtxRef = useRef(null);
  const processorRef = useRef(null);
  const pcmRef = useRef([]);

  // Load profiles
  useEffect(() => {
    (async () => {
      if (!hasBackend || !window.api?.profilesLoad) return;
      const loaded = await window.api.profilesLoad();
      if (Array.isArray(loaded) && loaded.length) {
        setProfiles(loaded);
        const exists = loaded.some((p) => p.id === profileId);
        if (!exists) setProfileId(loaded[0].id);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasBackend]);

  // Save profiles
  useEffect(() => {
    if (!hasBackend || !window.api?.profilesSave) return;
    if (profiles.length) window.api.profilesSave(profiles);
  }, [profiles, hasBackend]);

  // Load sessions when profile changes
  useEffect(() => {
    (async () => {
      if (!hasBackend || !window.api?.sessionsLoad) return;
      const ss = await window.api.sessionsLoad(profileId);
      if (Array.isArray(ss) && ss.length) {
        setSessions(ss);
        const exists = ss.some((s) => s.id === sessionId);
        if (!exists) setSessionId(ss[0].id);
      } else {
        setSessions([{ id: "default", name: "Default" }]);
        setSessionId("default");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, hasBackend]);

  // Load rag folder
  useEffect(() => {
    (async () => {
      if (!hasBackend || !window.api?.ragGetFolder) return;
      const f = await window.api.ragGetFolder();
      if (f) setRagFolder(f);
    })();
  }, [hasBackend]);

  // Load tasks
  useEffect(() => {
    (async () => {
      if (!hasBackend || !window.api?.tasksLoad) return;
      const t = await window.api.tasksLoad();
      if (Array.isArray(t)) setTasks(t);
    })();
  }, [hasBackend]);

  // Backend connect
  useEffect(() => {
    if (!hasBackend) {
      setStatus("browser mode (open Electron app)");
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;

    window.api.onStatus((s) => setStatus(s));

    window.api.onMessage((msg) => {
      // ASR result
      if (msg.type === "asr") {
        const text = (msg.text || "").trim();
        if (text) setInput((prev) => (prev ? prev + " " + text : text));
        return;
      }

      if (msg.type === "response") {
        const sources = Array.isArray(msg.sources) ? msg.sources : [];
        let text = msg.text || "";

        if (msg.rag_meta) {
          const meta = msg.rag_meta;
          const extra =
            `📚 Indexed ${meta.files} files (${meta.chunks} chunks) in ${meta.build_seconds}s\n` +
            `Folder: ${meta.folder}\n\n`;
          text = extra + text;
        }

        setMessages((m) => [
          ...m,
          { role: "assistant", text, sources, showSources: false },
        ]);

        if (ttsEnabled) speakText(text);
        return;
      }

      if (msg.type === "error") {
        const detail = msg.traceback ? `\n\n${msg.traceback}` : "";
        setMessages((m) => [
          ...m,
          { role: "assistant", text: "❌ " + msg.message + detail },
        ]);
      }
    });

    // Task reminder
    window.api.onReminder?.((task) => {
      setMessages((m) => [
        ...m,
        { role: "assistant", text: `⏰ Reminder: ${task?.text || "Task"}` },
      ]);
    });

    window.api.start();
  }, [hasBackend, ttsEnabled]);

  // Load history
  useEffect(() => {
    (async () => {
      if (!hasBackend || !window.api?.historyLoad) return;
      if (!profileId || !sessionId) return;
      const saved = await window.api.historyLoad(profileId, sessionId);
      if (Array.isArray(saved) && saved.length) {
        setMessages(
          saved.map((x) => ({
            role: x.role,
            text: x.text,
            sources: Array.isArray(x.sources) ? x.sources : [],
            showSources: !!x.showSources,
          })),
        );
      } else {
        setMessages([
          {
            role: "assistant",
            text: `Session: ${session?.name || "Session"} ✅`,
          },
        ]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, sessionId, hasBackend]);

  // Save history
  useEffect(() => {
    if (!hasBackend || !window.api?.historySave) return;
    if (!profileId || !sessionId) return;
    window.api.historySave(profileId, sessionId, messages);
  }, [messages, hasBackend, profileId, sessionId]);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages]);

  // Chat send
  const send = () => {
    const text = input.trim();
    if (!text) return;

    setMessages((m) => [...m, { role: "user", text }]);
    setInput("");

    if (!hasBackend) {
      setMessages((m) => [
        ...m,
        { role: "assistant", text: "Browser mode: run Electron to connect." },
      ]);
      return;
    }

    const N = 10;
    const history = messages
      .slice(-N)
      .map(({ role, text }) => ({ role, text: String(text ?? "") }));

    window.api.sendPrompt({
      profileId,
      sessionId,
      text,
      history,
      system: profile?.system || "",
      rag: { enabled: ragEnabled, folderPath: ragFolder }, // ✅ keyword-only
    });
  };

  const clearChat = async () => {
    setMessages([{ role: "assistant", text: `Cleared session history ✅` }]);
    if (window.api?.historyClear)
      await window.api.historyClear(profileId, sessionId);
  };

  // Profiles
  const openEditor = () => {
    setEditName(profile?.name || "");
    setEditSystem(profile?.system || "");
    setShowEditor(true);
  };
  const saveEditor = () => {
    const name = editName.trim() || "Unnamed";
    const system = editSystem || "";
    setProfiles((prev) =>
      prev.map((p) => (p.id === profileId ? { ...p, name, system } : p)),
    );
    setShowEditor(false);
  };
  const createProfile = () => {
    const id = uid();
    const p = {
      id,
      name: "New Profile",
      system: "You are Basil's assistant. Be helpful and concise.",
    };
    setProfiles((prev) => [p, ...(prev || [])]);
    setProfileId(id);
    setShowEditor(false);
  };
  const deleteProfile = async () => {
    if (!profile) return;
    if (profiles.length <= 1) {
      setMessages((m) => [
        ...m,
        { role: "assistant", text: "❌ You must keep at least one profile." },
      ]);
      return;
    }
    const ok = confirm(`Delete profile "${profile.name}"?`);
    if (!ok) return;
    const next = profiles.filter((p) => p.id !== profileId);
    setProfiles(next);
    setProfileId(next[0].id);
    setShowEditor(false);
  };

  // Sessions
  const createSession = async () => {
    const name = prompt("Session name:", "New Session");
    if (name === null) return;
    const s = await window.api.sessionsCreate(profileId, name);
    const ss = await window.api.sessionsLoad(profileId);
    setSessions(ss);
    setSessionId(s.id);
  };
  const renameSession = async () => {
    if (!session) return;
    const name = prompt("Rename session:", session.name || "Session");
    if (name === null) return;
    await window.api.sessionsRename(profileId, sessionId, name);
    const ss = await window.api.sessionsLoad(profileId);
    setSessions(ss);
  };
  const deleteSession = async () => {
    if (!session || sessionId === "default") return;
    const ok = confirm(`Delete session "${session.name}"?`);
    if (!ok) return;
    await window.api.sessionsDelete(profileId, sessionId);
    const ss = await window.api.sessionsLoad(profileId);
    setSessions(ss);
    setSessionId(ss[0]?.id || "default");
  };

  // RAG folder
  const pickFolder = async () => {
    const folder = await window.api.pickFolder();
    if (folder) {
      setRagFolder(folder);
      await window.api.ragSetFolder(folder);
      setMessages((m) => [
        ...m,
        { role: "assistant", text: `📁 RAG folder set to:\n${folder}` },
      ]);
    }
  };

  // Sources UI
  const toggleSources = (index) => {
    setMessages((prev) =>
      prev.map((m, i) =>
        i === index ? { ...m, showSources: !m.showSources } : m,
      ),
    );
  };
  const openSource = async (p) =>
    window.api?.openPath && (await window.api.openPath(p));
  const showInFolder = async (p) =>
    window.api?.showItemInFolder && (await window.api.showItemInFolder(p));

  // Tasks
  const refreshTasks = async () => {
    const t = await window.api.tasksLoad();
    if (Array.isArray(t)) setTasks(t);
  };
  const addTask = async () => {
    const text = taskText.trim();
    if (!text) return;
    const dueISO = taskDueLocal ? new Date(taskDueLocal).toISOString() : "";
    await window.api.tasksAdd({ text, dueISO });
    setTaskText("");
    setTaskDueLocal("");
    await refreshTasks();
  };
  const toggleTask = async (id) => {
    await window.api.tasksToggleDone(id);
    await refreshTasks();
  };
  const deleteTask = async (id) => {
    await window.api.tasksDelete(id);
    await refreshTasks();
  };

  // TTS
  function speakText(text) {
    try {
      if (!("speechSynthesis" in window)) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance((text || "").slice(0, 1200));
      u.rate = 1.0;
      u.pitch = 1.0;
      window.speechSynthesis.speak(u);
    } catch {}
  }
  const stopSpeaking = () => {
    try {
      window.speechSynthesis?.cancel?.();
    } catch {}
  };

  // Voice recording → ASR
  const startRecording = async () => {
    if (!hasBackend || !window.api?.sendASR) {
      setMessages((m) => [
        ...m,
        { role: "assistant", text: "❌ Voice requires Electron backend." },
      ]);
      return;
    }
    if (isRecording) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      pcmRef.current = [];
      processor.onaudioprocess = (ev) => {
        const input = ev.inputBuffer.getChannelData(0);
        pcmRef.current.push(new Float32Array(input));
      };

      source.connect(processor);
      processor.connect(ctx.destination);

      setIsRecording(true);
    } catch {
      setMessages((m) => [
        ...m,
        { role: "assistant", text: "❌ Microphone permission denied." },
      ]);
    }
  };

  const stopRecording = async () => {
    if (!isRecording) return;
    setIsRecording(false);

    try {
      processorRef.current?.disconnect();
      audioCtxRef.current?.close();
      mediaStreamRef.current?.getTracks()?.forEach((t) => t.stop());

      const wavBytes = floatPcmToWav16kMono(pcmRef.current, 16000);
      const wavB64 = arrayBufferToBase64(wavBytes.buffer);

      window.api.sendASR({
        request_id: rid(),
        wav_b64: wavB64,
        model_size: "tiny",
      });

      setMessages((m) => [
        ...m,
        { role: "assistant", text: "🎙️ Transcribing..." },
      ]);
    } catch {
      setMessages((m) => [
        ...m,
        { role: "assistant", text: "❌ Failed to encode audio." },
      ]);
    }
  };

  return (
    <div style={root()}>
      <div style={{ maxWidth: 1150, margin: "0 auto" }}>
        {/* Header */}
        <div style={headerRow()}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>
              Basil’s Local Assistant
            </div>
            <div style={{ fontSize: 13, opacity: 0.85 }}>
              Status: <span style={{ fontWeight: 700 }}>{status}</span>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <select
              value={profileId}
              onChange={(e) => setProfileId(e.target.value)}
              style={selectStyle()}
              disabled={!profiles.length}
            >
              {(profiles || []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            <button onClick={createProfile} style={btn()}>
              + Profile
            </button>
            <button onClick={openEditor} disabled={!profile} style={btn()}>
              Edit
            </button>
            <button
              onClick={deleteProfile}
              disabled={!profile || profiles.length <= 1}
              style={{ ...btn(), background: "#2a1b1b" }}
            >
              Delete
            </button>
            <button onClick={clearChat} style={btn()}>
              Clear chat
            </button>
          </div>
        </div>

        {/* Sessions tabs */}
        <div style={panel()}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {(sessions || []).slice(0, 8).map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSessionId(s.id)}
                  style={{
                    ...btn(),
                    padding: "6px 10px",
                    background: s.id === sessionId ? "#1f6feb" : "#111827",
                  }}
                >
                  {s.name}
                </button>
              ))}
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={createSession} style={btn()}>
                + Session
              </button>
              <button onClick={renameSession} style={btn()} disabled={!session}>
                Rename
              </button>
              <button
                onClick={deleteSession}
                style={{ ...btn(), background: "#2a1b1b" }}
                disabled={!session || sessionId === "default"}
              >
                Delete
              </button>
            </div>
          </div>

          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
            Profile: <b>{profile?.name || "Profile"}</b> • Session:{" "}
            <b>{session?.name || "Session"}</b>
          </div>
        </div>

        {/* Voice + TTS */}
        <div style={panel()}>
          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <button
              onClick={isRecording ? stopRecording : startRecording}
              style={{
                ...btn(),
                background: isRecording ? "#ef4444" : "#111827",
              }}
            >
              {isRecording ? "Stop Recording" : "🎙️ Voice Input"}
            </button>

            <label
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                fontSize: 13,
              }}
            >
              <input
                type="checkbox"
                checked={ttsEnabled}
                onChange={(e) => setTtsEnabled(e.target.checked)}
              />
              Auto-speak assistant replies
            </label>

            <button
              onClick={stopSpeaking}
              style={{ ...btn(), background: "#0f172a" }}
            >
              Stop speaking
            </button>

            <div style={{ fontSize: 12, opacity: 0.75 }}>
              Voice is offline via faster-whisper (tiny). Speak → Stop → text
              appears in input.
            </div>
          </div>
        </div>

        {/* Tasks */}
        <div style={panel()}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div style={{ fontWeight: 800 }}>✅ Tasks & Reminders</div>
            <button onClick={refreshTasks} style={btn()}>
              Refresh
            </button>
          </div>

          <div
            style={{
              display: "flex",
              gap: 10,
              marginTop: 10,
              flexWrap: "wrap",
            }}
          >
            <input
              style={{ ...inp(), flex: 2, minWidth: 240 }}
              value={taskText}
              onChange={(e) => setTaskText(e.target.value)}
              placeholder="Add a task (e.g., Submit report)…"
            />
            <input
              type="datetime-local"
              value={taskDueLocal}
              onChange={(e) => setTaskDueLocal(e.target.value)}
              style={{ ...inp(), flex: 1, minWidth: 220 }}
              title="Reminder time (optional)"
            />
            <button
              onClick={addTask}
              style={{
                ...btn(),
                background: "#22c55e",
                color: "#0b1220",
                fontWeight: 900,
              }}
            >
              Add
            </button>
          </div>

          <div style={{ marginTop: 10 }}>
            {(tasks || []).length === 0 ? (
              <div style={{ fontSize: 13, opacity: 0.75 }}>No tasks yet.</div>
            ) : (
              (tasks || []).map((t) => (
                <div
                  key={t.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 0",
                    borderBottom: "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 14,
                        textDecoration: t.done ? "line-through" : "none",
                      }}
                    >
                      {t.text}
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.75 }}>
                      {t.dueISO
                        ? `⏰ ${new Date(t.dueISO).toLocaleString()}`
                        : "No reminder"}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                    <button onClick={() => toggleTask(t.id)} style={btn()}>
                      {t.done ? "Undone" : "Done"}
                    </button>
                    <button
                      onClick={() => deleteTask(t.id)}
                      style={{ ...btn(), background: "#2a1b1b" }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* RAG controls (keyword-only) */}
        <div style={panel()}>
          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <label
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                fontSize: 13,
              }}
            >
              <input
                type="checkbox"
                checked={ragEnabled}
                onChange={(e) => setRagEnabled(e.target.checked)}
              />
              Use my files (RAG)
            </label>

            <button onClick={pickFolder} style={btn()}>
              Pick folder
            </button>

            <div style={{ fontSize: 13, opacity: 0.85 }}>
              Folder:{" "}
              <span style={{ fontWeight: 700 }}>
                {ragFolder ? ragFolder : "(not set)"}
              </span>
            </div>
          </div>
        </div>

        {/* Profile editor */}
        {showEditor && (
          <div style={{ ...panel(), padding: 14 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 10,
              }}
            >
              <div style={{ fontWeight: 800 }}>Edit Profile</div>
              <button onClick={() => setShowEditor(false)} style={btn()}>
                Close
              </button>
            </div>

            <label style={{ fontSize: 13, opacity: 0.9 }}>
              Name
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                style={inp()}
              />
            </label>

            <div style={{ height: 10 }} />

            <label style={{ fontSize: 13, opacity: 0.9 }}>
              System Prompt
              <textarea
                value={editSystem}
                onChange={(e) => setEditSystem(e.target.value)}
                rows={6}
                style={ta()}
              />
            </label>

            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <button
                onClick={saveEditor}
                style={{
                  ...btn(),
                  background: "#22c55e",
                  color: "#0b1220",
                  fontWeight: 900,
                }}
              >
                Save
              </button>
              <button
                onClick={() => setShowEditor(false)}
                style={{ ...btn(), background: "#334155" }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Chat */}
        <div ref={scrollRef} style={chatBox()}>
          {messages.map((m, i) => {
            const isUser = m.role === "user";
            const sources = Array.isArray(m.sources) ? m.sources : [];

            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  justifyContent: isUser ? "flex-end" : "flex-start",
                  marginBottom: 10,
                }}
              >
                <div style={bubble(isUser)}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 10,
                    }}
                  >
                    <div
                      style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}
                    >
                      {isUser ? "You" : "Assistant"}
                    </div>

                    {!isUser && (
                      <button
                        onClick={() => speakText(m.text)}
                        style={{
                          ...btn(),
                          padding: "4px 8px",
                          fontSize: 12,
                          background: "#0f172a",
                        }}
                        title="Speak this message"
                      >
                        🔊
                      </button>
                    )}
                  </div>

                  <div style={{ fontSize: 14, whiteSpace: "pre-wrap" }}>
                    {m.text}
                  </div>

                  {!isUser && sources.length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <button
                        onClick={() => toggleSources(i)}
                        style={{ ...btn(), padding: "6px 10px", fontSize: 12 }}
                      >
                        {m.showSources
                          ? "Hide sources"
                          : `Show sources (${sources.length})`}
                      </button>

                      {m.showSources && (
                        <div style={sourcesBox()}>
                          {sources.map((s, idx) => (
                            <div
                              key={idx}
                              style={sourceRow(idx === sources.length - 1)}
                            >
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontSize: 12, fontWeight: 800 }}>
                                  {s.rel}{" "}
                                  <span
                                    style={{ opacity: 0.75, fontWeight: 600 }}
                                  >
                                    (chunk {s.chunk}, score{" "}
                                    {Number(s.score).toFixed(3)})
                                  </span>
                                </div>
                                <div
                                  style={{
                                    fontSize: 11,
                                    opacity: 0.7,
                                    wordBreak: "break-all",
                                  }}
                                >
                                  {s.path}
                                </div>
                              </div>

                              <div
                                style={{
                                  display: "flex",
                                  gap: 8,
                                  flexShrink: 0,
                                }}
                              >
                                <button
                                  onClick={() => openSource(s.path)}
                                  style={{
                                    ...btn(),
                                    padding: "6px 10px",
                                    fontSize: 12,
                                  }}
                                >
                                  Open
                                </button>
                                <button
                                  onClick={() => showInFolder(s.path)}
                                  style={{
                                    ...btn(),
                                    padding: "6px 10px",
                                    fontSize: 12,
                                    background: "#0f172a",
                                  }}
                                >
                                  Folder
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Input */}
        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          <input
            style={inp()}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder={
              hasBackend
                ? `Message (${profile?.name || "Profile"} • ${session?.name || "Session"})...`
                : "Run Electron app to enable chat..."
            }
            disabled={!hasBackend}
          />
          <button
            onClick={send}
            disabled={!hasBackend}
            style={{
              ...btn(),
              background: hasBackend ? "#22c55e" : "#334155",
              color: "#0b1220",
              fontWeight: 900,
            }}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- styles ----------
function root() {
  return {
    fontFamily: "system-ui, Segoe UI, Roboto, Arial",
    minHeight: "100vh",
    background: "#0b1220",
    color: "#e5e7eb",
    padding: 16,
  };
}
function headerRow() {
  return {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
    gap: 12,
    flexWrap: "wrap",
  };
}
function btn() {
  return {
    padding: "8px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.15)",
    background: "#111827",
    color: "#e5e7eb",
    cursor: "pointer",
    fontWeight: 700,
  };
}
function panel() {
  return {
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 14,
    padding: 12,
    background: "#0f172a",
    marginBottom: 12,
  };
}
function inp() {
  return {
    flex: 1,
    padding: 12,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.15)",
    background: "#0b1220",
    color: "#e5e7eb",
    outline: "none",
  };
}
function ta() {
  return {
    width: "100%",
    marginTop: 6,
    padding: 10,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.15)",
    background: "#0b1220",
    color: "#e5e7eb",
    outline: "none",
    resize: "vertical",
  };
}
function selectStyle() {
  return {
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.15)",
    background: "#111827",
    color: "#e5e7eb",
  };
}
function chatBox() {
  return {
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 14,
    padding: 14,
    height: 560,
    overflowY: "auto",
    background: "#0f172a",
  };
}
function bubble(isUser) {
  return {
    maxWidth: "86%",
    padding: "10px 12px",
    borderRadius: 14,
    background: isUser ? "#1f6feb" : "#111827",
    border: "1px solid rgba(255,255,255,0.10)",
    color: "#e5e7eb",
    lineHeight: 1.35,
  };
}
function sourcesBox() {
  return {
    marginTop: 8,
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 12,
    padding: 10,
    background: "#0b1220",
  };
}
function sourceRow(isLast) {
  return {
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
    padding: "6px 0",
    borderBottom: isLast ? "none" : "1px solid rgba(255,255,255,0.08)",
  };
}

// ---------- WAV encoder (16k mono) ----------
function floatPcmToWav16kMono(chunks, targetRate) {
  let total = 0;
  for (const c of chunks) total += c.length;

  const merged = new Float32Array(total);
  let off = 0;
  for (const c of chunks) {
    merged.set(c, off);
    off += c.length;
  }

  const fromRate = 48000;
  const toRate = targetRate || 16000;

  const resampled = linearResample(merged, fromRate, toRate);

  const pcm16 = new Int16Array(resampled.length);
  for (let i = 0; i < resampled.length; i++) {
    let s = Math.max(-1, Math.min(1, resampled[i]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }

  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = toRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcm16.length * 2;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeStr(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(view, 8, "WAVE");
  writeStr(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, toRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let idx = 44;
  for (let i = 0; i < pcm16.length; i++, idx += 2) {
    view.setInt16(idx, pcm16[i], true);
  }

  return new Uint8Array(buffer);
}

function writeStr(view, offset, str) {
  for (let i = 0; i < str.length; i++)
    view.setUint8(offset + i, str.charCodeAt(i));
}

function linearResample(input, fromRate, toRate) {
  const ratio = fromRate / toRate;
  const newLen = Math.floor(input.length / ratio);
  const out = new Float32Array(newLen);

  for (let i = 0; i < newLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = pos - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
