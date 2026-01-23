// app/page.tsx
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

// Utility: Check if running inside Tauri
const isTauri = () => typeof window !== "undefined" && (window as any).__TAURI__;

interface Recording {
  id: string;
  date: string;
  time: string;
  duration: number; // in seconds
  transcription?: string;
  enrichment?: string;
  status: "idle" | "recording" | "transcribing" | "enriching" | "completed";
}

export default function HomePage() {
  const [isRecording, setIsRecording] = useState(false);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [activeResult, setActiveResult] = useState<{ text: string; title: string } | null>(null);
  const [status, setStatus] = useState("Bereit");
  const [recordingTime, setRecordingTime] = useState(0);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [promptTemplates, setPromptTemplates] = useState<string[]>([]);
  const [selectedPrompt, setSelectedPrompt] = useState<string>("Prompt 1");
  const [enrichingId, setEnrichingId] = useState<string | null>(null);
  const [isModelAvailable, setIsModelAvailable] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const audioBlobs = useRef<Map<string, Blob>>(new Map());

  // Initialize Worker for Browser Mode
  useEffect(() => {
    if (isTauri()) return;

    if (!workerRef.current) {
      // Create worker
      workerRef.current = new Worker(new URL('./worker.ts', import.meta.url));

      // Handle worker messages
      workerRef.current.onmessage = (event) => {
        const { type, text, id, status } = event.data;
        if (type === 'complete') {
          setIsModelLoading(false);
          setRecordings(prev => prev.map(r =>
            r.id === id ? {
              ...r,
              transcription: text,
              // Simple simulation of enrichment since we only have transcription in browser for now
              enrichment: "KI-Analyse (Browser-Demo): " + text.substring(0, 50) + "...",
              status: "completed"
            } : r
          ));
        } else if (type === 'status') {
          console.log(`Worker status for ${id}: ${status}`);
          if (status === 'loading') {
            setIsModelLoading(true);
          } else if (status === 'transcribing') {
            setIsModelLoading(false);
          }
        } else if (type === 'error') {
          setIsModelLoading(false);
          console.error("Worker error:", event.data.error);
          setRecordings(prev => prev.map(r =>
            r.id === id ? { ...r, status: "idle" } : r
          ));
        }
      };
    }

    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  // Listen for enriched result from Rust (Tauri only)
  useEffect(() => {
    if (!isTauri()) return;
    // ... existing Tauri listeners ...
    const unlistenTrans = (window as any).__TAURI__.event.listen(
      "transcription_ready",
      (event: any) => {
        const { id, text } = event.payload;
        setRecordings(prev => prev.map(r =>
          r.id === id ? { ...r, transcription: text, status: "enriching" } : r
        ));
      }
    );

    const unlistenEnriched = (window as any).__TAURI__.event.listen(
      "enriched_ready",
      (event: any) => {
        const { id, text } = event.payload;
        setRecordings(prev => prev.map(r =>
          r.id === id ? { ...r, enrichment: text, status: "completed" } : r
        ));
        setStatus("Bereit");
      }
    );

    return () => {
      unlistenTrans.then((f: any) => f());
      unlistenEnriched.then((f: any) => f());
    };
  }, []);

  // Load existing recordings on mount and sort by timestamp
  useEffect(() => {
    if (!isTauri()) return;

    const loadExistingRecordings = async () => {
      try {
        const existingRecordings = await invoke("get_all_recordings") as Recording[];
        // Sort by ID (timestamp) in descending order (newest first)
        existingRecordings.sort((a, b) => parseInt(b.id) - parseInt(a.id));
        setRecordings(existingRecordings);
      } catch (err) {
        console.error("Failed to load recordings:", err);
      }
    };

    const loadPromptTemplates = async () => {
      try {
        const templates = await invoke("get_prompt_templates") as string[];
        setPromptTemplates(templates);
        if (templates.length > 0) {
          setSelectedPrompt(templates[0]);
        }
      } catch (err) {
        console.error("Failed to load prompt templates:", err);
      }
    };

    const checkAndDownloadModel = async () => {
      try {
        setIsModelLoading(true);
        setIsInitializing(true);
        console.log("Checking Whisper model...");
        await invoke("check_model");
        setIsModelAvailable(true);
        console.log("Whisper model is ready");
      } catch (err) {
        console.error("Failed to load Whisper model:", err);
        setIsModelAvailable(false);
        setErrorMessage("Fehler beim Laden des Whisper-Modells. Transkription ist nicht verfügbar.");
      } finally {
        setIsModelLoading(false);
        setIsInitializing(false);
      }
    };

    // Check model first, then load other data
    checkAndDownloadModel().then(() => {
      loadExistingRecordings();
      loadPromptTemplates();
    });
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioChunks: Blob[] = [];
      const startTime = Date.now();

      mediaRecorderRef.current = new MediaRecorder(stream);
      mediaRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.push(e.data);
      };

      mediaRecorderRef.current.onstop = async () => {
        const duration = Math.round((Date.now() - startTime) / 1000);
        const blob = new Blob(audioChunks, { type: "audio/wav" });
        const arrayBuffer = await blob.arrayBuffer();

        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        const channelData = audioBuffer.getChannelData(0); // Float32Array

        // For Tauri, we need Int16
        const samples = new Int16Array(channelData.length);
        for (let i = 0; i < channelData.length; i++) {
          samples[i] = Math.max(-32768, Math.min(32767, channelData[i] * 32767));
        }

        const now = new Date();
        const dateStr = now.toLocaleDateString('de-DE').replace(/\//g, '.');
        const timeStr = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' h';

        if (isTauri()) {
          try {
            const id = await invoke("save_and_queue_recording", { samples: Array.from(samples) }) as string;
            audioBlobs.current.set(id, blob); // Store the blob for playback
            const newRec: Recording = {
              id,
              date: dateStr,
              time: timeStr,
              duration: duration,
              status: "transcribing"
            };
            setRecordings(prev => {
              const updated = [newRec, ...prev];
              // Sort by ID (timestamp) descending
              updated.sort((a, b) => parseInt(b.id) - parseInt(a.id));
              return updated;
            });
            setStatus("Gespeichert");
            console.log("Recording saved with ID:", id);
          } catch (e) {
            console.error("Save error:", e);
            setStatus("Fehler beim Speichern");
            setErrorMessage("Fehler beim Speichern der Aufnahme: " + (e as any).toString());
          }
        } else {
          // Browser Mode: Use Worker
          const id = Date.now().toString();
          audioBlobs.current.set(id, blob);

          const newRec: Recording = {
            id,
            date: dateStr,
            time: timeStr,
            duration: duration,
            status: "transcribing"
          };
          setRecordings(prev => {
            const updated = [newRec, ...prev];
            // Sort by ID (timestamp) descending
            updated.sort((a, b) => parseInt(b.id) - parseInt(a.id));
            return updated;
          });

          // Send to worker
          if (workerRef.current) {
            workerRef.current.postMessage({
              type: 'transcribe',
              audio: channelData, // Send Float32Array directly
              id
            });
          }
        }
      };


      mediaRecorderRef.current.start();
      setIsRecording(true);
      setRecordingTime(0);
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
      setStatus("Nimm auf...");
    } catch (err: any) {
      console.error("Mikrofon-Fehler:", err);
      setStatus("Mikrofon nicht verfügbar");
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setErrorMessage("Der Zugriff auf das Mikrofon wurde blockiert.\n\nBitte erlauben Sie den Zugriff:\n1. Klicken Sie auf das Schloss-Symbol in der Adressleiste\n2. Erlauben Sie den Mikrofon-Zugriff\n3. Laden Sie die Seite neu");
      } else if (err.name === 'NotFoundError') {
        setErrorMessage("Kein Mikrofon gefunden.\n\nBitte:\n1. Schließen Sie ein Mikrofon an\n2. Überprüfen Sie die Systemeinstellungen\n3. Starten Sie die Anwendung neu");
      } else {
        setErrorMessage("Fehler beim Zugriff auf das Mikrofon:\n\n" + (err.message || "Unbekannter Fehler") + "\n\nBitte überprüfen Sie die Mikrofoneinstellungen in Ihrem System.");
      }
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }, [isRecording]);

  // Hotkey listener
  useEffect(() => {
    if (!isTauri()) return;

    const handleHotkey = () => {
      console.log("Hotkey triggered! isRecording:", isRecording);
      if (!isRecording) {
        startRecording();
      } else {
        stopRecording();
      }
    };

    const unlisten = (window as any).__TAURI__.event.listen("hotkey-triggered", handleHotkey);

    return () => {
      unlisten.then((f: any) => f());
    };
  }, [isRecording, startRecording, stopRecording]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const reEnrichWithPrompt = async (id: string) => {
    if (!isTauri()) return;
    
    setEnrichingId(id);
    try {
      const enriched = await invoke("re_enrich_with_prompt", { id, promptName: selectedPrompt }) as string;
      setRecordings(prev => prev.map(r =>
        r.id === id ? { ...r, enrichment: enriched, status: "completed" } : r
      ));
    } catch (err) {
      console.error("Re-enrichment error:", err);
    } finally {
      setEnrichingId(null);
    }
  };


  const deleteRecording = async (id: string) => {
    setRecordings(prev => prev.filter(r => r.id !== id));
    audioBlobs.current.delete(id);
    if (activeResult) setActiveResult(null);
    if (playingId === id) {
      audioRef.current?.pause();
      setPlayingId(null);
      setPlaybackProgress(0);
    }

    if (isTauri()) {
      try {
        await invoke("delete_recording", { id });
      } catch (err) {
        console.error("Delete error:", err);
      }
    }
  };

  const playRecording = async (id: string) => {
    if (playingId === id) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      setPlayingId(null);
      setPlaybackProgress(0);
      return;
    }

    setPlaybackProgress(0);

    try {
      let blob = audioBlobs.current.get(id);
      console.log("Playing recording:", id, "Blob in memory:", !!blob);

      if (!blob && isTauri()) {
        // Fetch from Rust if not in memory
        console.log("Fetching audio from Rust backend...");
        const audioData = await invoke("get_recording_audio", { id }) as number[];
        console.log("Received audio data, length:", audioData.length);
        blob = new Blob([new Uint8Array(audioData)], { type: "audio/wav" });
        audioBlobs.current.set(id, blob);
      }

      if (blob) {
        console.log("Creating audio URL from blob, size:", blob.size);
        const url = URL.createObjectURL(blob);
        if (audioRef.current) {
          audioRef.current.pause();
        }
        const audio = new Audio(url);
        audioRef.current = audio;
        setPlayingId(id);

        audio.ontimeupdate = () => {
          if (audio.duration) {
            setPlaybackProgress((audio.currentTime / audio.duration) * 100);
          }
        };

        audio.onended = () => {
          setPlayingId(null);
          setPlaybackProgress(0);
          URL.revokeObjectURL(url);
        };

        audio.onerror = (e) => {
          console.error("Audio playback error:", e);
          setPlayingId(null);
          setPlaybackProgress(0);
          URL.revokeObjectURL(url);
        };

        await audio.play();
        console.log("Audio playback started");
      } else {
        console.error("Audio data not found for id:", id);
        setErrorMessage("Audio-Datei nicht gefunden");
      }
    } catch (err) {
      console.error("Playback error:", err);
      setErrorMessage("Fehler bei der Wiedergabe: " + (err as any).toString());
    }
  };

  return (
    <div className="app-container">
      {/* Show loading overlay during initialization */}
      {isInitializing && (
        <div className="loading-overlay">
          <div className="loading-card">
            <div className="hourglass-container">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#ffffff"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="hourglass-icon"
              >
                <path d="M5 22h14" />
                <path d="M5 2h14" />
                <path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22" />
                <path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" />
              </svg>
            </div>
            <div className="loading-text">Whisper-Modell wird geladen...</div>
            <div className="loading-subtext">Dies kann beim ersten Start einige Minuten dauern (~500 MB)</div>
          </div>
        </div>
      )}

      {/* Main UI - only show after initialization */}
      {!isInitializing && (
        <>
          {/* Upper Display Area */}
          <div className={`display-panel ${activeResult ? 'visible' : 'hidden'}`}>
            <div className="panel-content">
              <button onClick={() => setActiveResult(null)} className="panel-close">✕</button>
          <h2 className="panel-title">{activeResult?.title || "Transkription"}</h2>
          <div className="panel-body">{activeResult?.text}</div>
        </div>
      </div>



      {/* Main Content Area */}
      <div className="main-content">

        {/* Prompt Template Selector */}
        {isTauri() && promptTemplates.length > 0 && (
          <div className="prompt-selector">
            <label htmlFor="prompt-select" className="prompt-label">KI-Stil:</label>
            <select 
              id="prompt-select"
              value={selectedPrompt} 
              onChange={(e) => setSelectedPrompt(e.target.value)}
              className="prompt-dropdown"
            >
              {promptTemplates.map((template) => (
                <option key={template} value={template}>{template}</option>
              ))}
            </select>
          </div>
        )}

        {/* History Stack - ALL recordings including current/newest */}
        <div className="history-stack custom-scrollbar">
          {/* Show current recording if recording */}
          {isRecording && (
            <div className="rec-item">
              <div className="rec-card recording-active">
                <div className="rec-footer">
                  <div className="rec-time">
                    {new Date().toLocaleDateString('de-DE').replace(/\//g, '.') + ' - ' + new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' h'}
                  </div>
                  <div className="rec-play-btn recording-dot-container">
                    <span className="recording-dot-pulse"></span>
                  </div>
                  <span className="rec-duration recording-timer">
                    {formatDuration(recordingTime)}
                  </span>
                  <span className="rec-text-preview">Aufnahme läuft...</span>
                </div>
              </div>
            </div>
          )}

          {/* Show all saved recordings */}
          {recordings.map((rec) => (
            <div key={rec.id} className="rec-item">
              <div className="rec-card">
                <div className="rec-footer">
                  <div className="rec-time">{rec.date} - {rec.time}</div>
                  <button
                    onClick={() => playRecording(rec.id)}
                    className={`rec-play-btn ${playingId === rec.id ? 'playing' : ''}`}
                    title={playingId === rec.id ? 'Wiedergabe stoppen' : 'Aufnahme abspielen'}
                  >
                    {playingId === rec.id ? '■' : '▶'}
                  </button>
                  <span className="rec-duration">{formatDuration(rec.duration)}</span>
                  <span className="rec-text-preview">{rec.transcription || ""}</span>
                  
                  {!rec.transcription && (
                    <div className="rec-processing-inline">
                      <div className="standby-circle-inline"></div>
                    </div>
                  )}

                  {rec.transcription && (
                    <button
                      onClick={() => {
                        if (activeResult?.text === rec.transcription && activeResult?.title === "Transkription") {
                          setActiveResult(null);
                        } else {
                          setActiveResult({ text: rec.transcription!, title: "Transkription" });
                        }
                      }}
                      className="rec-action-btn-inline"
                      title="Transkription anzeigen"
                    >
                      <img src="/transkription.png" alt="A" />
                    </button>
                  )}

                  {rec.transcription && !rec.enrichment && isModelAvailable && (
                    <button
                      onClick={() => reEnrichWithPrompt(rec.id)}
                      className="rec-action-btn-inline"
                      disabled={enrichingId === rec.id}
                      title="Mit KI anreichern"
                    >
                      {enrichingId === rec.id ? (
                        <div className="button-spinner-inline"></div>
                      ) : (
                        <img src="/transkription-ai.png" alt="AI" />
                      )}
                    </button>
                  )}

                  {rec.enrichment && (
                    <>
                      <button
                        onClick={() => {
                          if (activeResult?.text === rec.enrichment && activeResult?.title === "Transkription + KI") {
                            setActiveResult(null);
                          } else {
                            setActiveResult({ text: rec.enrichment!, title: "Transkription + KI" });
                          }
                        }}
                        className="rec-action-btn-inline"
                        title="Transkription AI"
                      >
                        <img src="/transkription-ai.png" alt="AI" />
                      </button>
                      <button
                        onClick={() => reEnrichWithPrompt(rec.id)}
                        className="rec-refresh-btn-inline"
                        disabled={enrichingId === rec.id}
                        title="Neu anreichern mit aktuellem Prompt"
                      >
                        {enrichingId === rec.id ? (
                          <div className="button-spinner-inline"></div>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                          </svg>
                        )}
                      </button>
                    </>
                  )}

                  <button onClick={() => deleteRecording(rec.id)} className="rec-delete-btn" title="Löschen">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6"></polyline>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                      <line x1="10" y1="11" x2="10" y2="17"></line>
                      <line x1="14" y1="11" x2="14" y2="17"></line>
                    </svg>
                  </button>
                </div>
                {playingId === rec.id && (
                  <div className="playback-progress-container">
                    <div
                      className="playback-progress-bar"
                      style={{ width: `${playbackProgress}%` }}
                    />
                  </div>
                )}
              </div>
            </div>
          ))}


        </div>

        {/* Bottom Control Bar: Record Button Only */}
        <div className="controls-bar">
          <div className="record-section">
            <button
              onClick={isRecording ? stopRecording : startRecording}
              className={`record-toggle ${isRecording ? 'recording' : 'idle'}`}
              disabled={isModelLoading}
              title={isRecording ? "Aufnahme stoppen Ctrl+Shift+Space" : "Aufnahme starten Ctrl+Shift+Space"}
            >
              <div className="record-indicator"></div>
            </button>
          </div>
        </div>
      </div>
        </>
      )}

      {/* Error overlay - always available */}
      {errorMessage && (
        <div className="error-overlay">
          <div className="error-card">
            <div className="error-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#fa5252" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
            </div>
            <h3 className="error-title">Mikrofon blockiert</h3>
            <p className="error-message">{errorMessage}</p>
            <button onClick={() => setErrorMessage(null)} className="error-close-btn">
              Verstanden
            </button>
          </div>
        </div>
      )}

      <style jsx global>{`
        body {
          margin: 0;
          background: #0f1115;
          color: #e0e0e0;
          font-family: 'Inter', sans-serif;
        }
        .app-container {
          height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          padding: 20px 40px;
          box-sizing: border-box;
          overflow-y: auto;
          overflow-x: hidden;
        }
        
        /* Show scrollbar for app-container */
        .app-container::-webkit-scrollbar {
          width: 8px;
        }
        .app-container::-webkit-scrollbar-track {
          background: #1a1d23;
        }
        .app-container::-webkit-scrollbar-thumb {
          background: #333;
          border-radius: 4px;
        }
        .app-container::-webkit-scrollbar-thumb:hover {
          background: #444;
        }

        /* Top Panel */
        .display-panel {
          width: 900px;
          height: 200px;
          background: #1a1d23;
          border-radius: 24px;
          border: 1px solid #2d323b;
          margin-bottom: 20px;
          margin-left: 0;
          margin-right: auto;
          transition: all 0.4s ease;
          position: relative;
          flex-shrink: 0;
          align-self: flex-start;
        }
        .display-panel.hidden { 
          opacity: 0; 
          transform: translateY(10px); 
          pointer-events: none; 
          height: 0; 
          margin: 0; 
          padding: 0; 
          border: none;
        }
        .display-panel.visible { opacity: 1; transform: translateY(0); }
        .panel-content { padding: 25px; height: 100%; box-sizing: border-box; overflow-y: auto; }
        .panel-close { position: absolute; top: 15px; right: 20px; background: none; border: none; color: #666; cursor: pointer; font-size: 20px; transition: color 0.2s; }
        .panel-close:hover { color: white; }
        .panel-title { color: #4dabf7; font-size: 13px; text-transform: uppercase; letter-spacing: 2.5px; margin-bottom: 15px; font-weight: 700; }
        .panel-body { font-size: 17px; line-height: 1.6; color: #d1d5db; word-wrap: break-word; overflow-wrap: break-word; white-space: pre-wrap; }
        

        
        /* Main Layout */
        .main-content {
          width: 900px;
          display: flex;
          flex-direction: column;
          flex: 1;
          min-height: 0;
          padding-bottom: 20px;
        }

        /* Prompt Selector - Inline version inside rec-card */
        .rec-divider {
          width: 1px;
          height: 20px;
          background: #444;
          flex-shrink: 0;
          margin: 0 4px;
        }
        .prompt-label-inline {
          font-size: 13px;
          color: #aaa;
          font-weight: 500;
          flex-shrink: 0;
        }
        .prompt-dropdown-inline {
          background: #0f1115;
          border: 1px solid #444;
          color: #e0e0e0;
          padding: 4px 12px;
          border-radius: 6px;
          font-size: 12px;
          cursor: pointer;
          transition: all 0.2s;
          outline: none;
          flex-shrink: 0;
        }
        .prompt-dropdown-inline:hover {
          border-color: #4dabf7;
        }
        .prompt-dropdown-inline:focus {
          border-color: #4dabf7;
          box-shadow: 0 0 0 2px rgba(77, 171, 247, 0.1);
        }

        .history-stack {
          flex: 1;
          display: flex;
          flex-direction: column-reverse; /* Newest on bottom */
          align-items: flex-start;
          gap: 0px;
          overflow-y: auto;
          padding: 10px 0 10px 0;
          padding-left: 68px; /* 48px button + 20px gap to align with record button */
          margin-bottom: 0;
        }

        .controls-bar {
          display: flex;
          align-items: center;
          gap: 20px;
          padding-top: 2px;
          flex-shrink: 0;
        }
        
        .recording-active {
          border: 2px solid #fa5252 !important;
          box-shadow: 0 0 20px rgba(250, 82, 82, 0.3) !important;
        }

        /* Recording Item */
        .rec-item { 
          display: flex; 
          align-items: flex-start; 
          animation: slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1);
          flex-shrink: 0;
        }

        @keyframes slideUp {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .rec-card { 
          background: #1a1d23; 
          border: 1px solid #333; 
          padding: 6px 18px; 
          border-radius: 12px; 
          width: 550px; 
          box-shadow: 0 4px 15px rgba(0,0,0,0.4);
          position: relative;
          overflow: hidden;
        }

        .playback-progress-container {
          position: absolute;
          bottom: 0;
          left: 0;
          width: 100%;
          height: 3px;
          background: rgba(255, 255, 255, 0.1);
        }

        .playback-progress-bar {
          height: 100%;
          background: #40c057;
          transition: width 0.1s linear;
        }
        
        .rec-time { font-size: 13px; color: #aaa; font-weight: 500; flex-shrink: 0; }
        .rec-footer { display: flex; align-items: center; gap: 8px; }
        .rec-play-btn, .rec-delete-btn { background: none; border: none; color: #aaa; cursor: pointer; font-size: 18px; transition: all 0.2s; width: 26px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .rec-play-btn:hover { color: #4dabf7; transform: scale(1.1); }
        .rec-play-btn.playing { color: #aaa; }
        .rec-play-btn.playing:hover { color: #4dabf7; transform: scale(1.1); }
        .rec-delete-btn:hover { color: #fa5252; transform: scale(1.1); }
        .rec-duration { font-family: monospace; font-size: 12px; color: #666; flex-shrink: 0; }
        .rec-text-preview { flex: 1; font-size: 13px; color: #777; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; text-align: left; }
        
        /* Inline action buttons inside rec-card */
        .rec-action-btn-inline { 
          width: 26px; height: 26px; background: white; border-radius: 6px; 
          border: none; cursor: pointer; transition: all 0.2s; 
          display: flex; align-items: center; justify-content: center; padding: 4px;
          flex-shrink: 0;
        }
        .rec-action-btn-inline:hover { transform: scale(1.1); }
        .rec-action-btn-inline:disabled { opacity: 0.5; cursor: not-allowed; }
        .rec-action-btn-inline:disabled:hover { transform: scale(1); }
        .rec-action-btn-inline img { width: 100%; height: 100%; object-fit: contain; }
        
        .rec-refresh-btn-inline {
          width: 26px; height: 26px; background: transparent; border-radius: 6px;
          border: 1px solid #333; cursor: pointer; transition: all 0.2s;
          display: flex; align-items: center; justify-content: center;
          color: #4dabf7; flex-shrink: 0;
        }
        .rec-refresh-btn-inline:hover { 
          background: #4dabf7; 
          color: white; 
          transform: scale(1.1); 
        }
        .rec-refresh-btn-inline:disabled { opacity: 0.5; cursor: not-allowed; }
        .rec-refresh-btn-inline:disabled:hover { transform: scale(1); background: transparent; color: #4dabf7; }

        .rec-processing-inline {
          width: 26px; height: 26px; 
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
        }
        .standby-circle-inline {
          width: 16px; height: 16px;
          border: 2px solid rgba(77, 171, 247, 0.5);
          border-radius: 50%;
          background: transparent;
          animation: pulse-standby 2s ease-in-out infinite;
        }

        .button-spinner-inline {
          width: 18px; height: 18px;
          border: 2px solid rgba(77, 171, 247, 0.2);
          border-top-color: #4dabf7;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }
        
        /* Record Button */
        .record-section { flex-shrink: 0; }
        .record-toggle { 
          width: 48px; height: 48px; border-radius: 50%; border: 3px solid #333; 
          background: none; cursor: pointer; transition: all 0.3s; 
          display: flex; align-items: center; justify-content: center;
        }
        .record-toggle.idle { animation: pulsateButton 2s ease-in-out infinite; }
        .record-toggle:not(:disabled):hover { border-color: #ffffff; transform: scale(1.05); box-shadow: 0 0 15px rgba(255, 255, 255, 0.2); }
        .record-toggle.recording { background: #fa5252; border-color: #fa5252; box-shadow: 0 0 25px rgba(250, 82, 82, 0.5); animation: none; }
        .record-toggle:disabled { opacity: 0.3; cursor: not-allowed; }
        .record-indicator { width: 20px; height: 20px; background: #fa5252; border-radius: 50%; transition: all 0.3s; }
        .record-toggle.recording .record-indicator { width: 16px; height: 16px; background: white; border-radius: 4px; }
        
        @keyframes pulsateButton { 
          0%, 100% { transform: scale(1); opacity: 1; } 
          50% { transform: scale(1.08); opacity: 0.85; } 
        }
        
        .recording-timer { color: #fa5252 !important; font-weight: 600; }
        .recording-dot-container { display: flex; align-items: center; justify-content: center; width: 26px; }
        .recording-dot-pulse { width: 10px; height: 10px; background: #fa5252; border-radius: 50%; animation: pulsate 1.5s ease-in-out infinite; }
        @keyframes pulsate { 
          0%, 100% { transform: scale(1); opacity: 1; } 
          50% { transform: scale(1.4); opacity: 0.6; } 
        }
        
        .custom-scrollbar {
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .custom-scrollbar::-webkit-scrollbar { display: none; }

        .loading-overlay {
          position: fixed; top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(15, 17, 21, 0.98);
          display: flex; align-items: center; justify-content: center;
          z-index: 1000; backdrop-filter: blur(10px);
        }
        .loading-card {
          background: #1a1d23; border: 1px solid #333; padding: 50px;
          border-radius: 32px; text-align: center; box-shadow: 0 30px 60px rgba(0,0,0,0.5);
        }
        .hourglass-container {
          width: 70px; height: 70px;
          margin: 0 auto 30px; display: flex; align-items: center; justify-content: center;
        }
        .hourglass-icon {
          width: 100%; height: 100%; object-fit: contain;
          animation: rotateHourglass 2s infinite cubic-bezier(0.77, 0, 0.175, 1);
        }
        @keyframes rotateHourglass {
          0% { transform: rotate(0deg); }
          45% { transform: rotate(180deg); }
          50% { transform: rotate(180deg); }
          95% { transform: rotate(360deg); }
          100% { transform: rotate(360deg); }
        }
        .loading-text { font-size: 22px; font-weight: 700; color: #4dabf7; margin-bottom: 12px; }
        .loading-subtext { font-size: 14px; color: #555; }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes pulse-standby {
          0%, 100% { 
            border-color: rgba(77, 171, 247, 0.5);
            transform: scale(1);
          }
          50% { 
            border-color: rgba(77, 171, 247, 0.8);
            transform: scale(1.1);
          }
        }

        .error-overlay {
          position: fixed; top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(15, 17, 21, 0.8);
          display: flex; align-items: center; justify-content: center;
          z-index: 2000; backdrop-filter: blur(5px);
          animation: fadeIn 0.3s ease;
        }
        .error-card {
          background: #1a1d23; border: 1px solid #fa5252; padding: 30px;
          border-radius: 20px; text-align: center; box-shadow: 0 10px 40px rgba(0,0,0,0.6);
          max-width: 400px; width: 90%;
          animation: slideUpFade 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .error-icon { margin-bottom: 20px; display: flex; justify-content: center; }
        .error-title { font-size: 20px; font-weight: 700; color: #fa5252; margin: 0 0 10px; }
        .error-message { font-size: 15px; color: #ccc; line-height: 1.5; margin-bottom: 25px; white-space: pre-line; text-align: left; }
        .error-close-btn {
          background: #fa5252; color: white; border: none; padding: 10px 24px;
          border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer;
          transition: all 0.2s;
        }
        .error-close-btn:hover { background: #ff6b6b; transform: scale(1.05); }

        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUpFade { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
}
