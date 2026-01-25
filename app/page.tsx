// app/page.tsx
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

// Utility: Check if running inside Tauri
const isTauri = () => typeof window !== "undefined" && (window as any).__TAURI__;

// Utility: Create a proper WAV blob from Int16 samples
const createWavBlob = (samples: Int16Array, sampleRate: number): Blob => {
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // WAV Header
  // "RIFF" chunk descriptor
  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, 36 + dataSize, true); // File size - 8
  view.setUint32(8, 0x57415645, false); // "WAVE"

  // "fmt " sub-chunk
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
  view.setUint16(22, numChannels, true); // NumChannels
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, byteRate, true); // ByteRate
  view.setUint16(32, blockAlign, true); // BlockAlign
  view.setUint16(34, bitsPerSample, true); // BitsPerSample

  // "data" sub-chunk
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, dataSize, true); // Subchunk2Size

  // Write audio samples
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(offset, samples[i], true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
};

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
  const [downloadProgress, setDownloadProgress] = useState(0);
  const abortDownloadRef = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const audioBlobs = useRef<Map<string, Blob>>(new Map());

  // Debug: Log component mount
  useEffect(() => {
    console.log("HomePage component mounted, isTauri:", isTauri(), "isInitializing:", true);
  }, []);

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

    const unlistenFailed = (window as any).__TAURI__.event.listen(
      "transcription_failed",
      (event: any) => {
        const { id, text } = event.payload;
        console.log("Transcription failed for", id, ":", text);
        // Mark recording as completed but without transcription
        // This will hide the transcription buttons
        setRecordings(prev => prev.map(r =>
          r.id === id ? { ...r, status: "idle" } : r
        ));
        setStatus("Bereit");
      }
    );

    return () => {
      unlistenTrans.then((f: any) => f());
      unlistenEnriched.then((f: any) => f());
      unlistenFailed.then((f: any) => f());
    };
  }, []);

  // Load existing recordings on mount and sort by timestamp
  useEffect(() => {
    console.log("Initialization useEffect running, isTauri:", isTauri());
    
    if (!isTauri()) {
      // In browser mode, skip initialization
      console.log("Browser mode detected, skipping initialization");
      setIsInitializing(false);
      return;
    }

    console.log("Tauri mode detected, starting initialization...");

    const loadExistingRecordings = async () => {
      try {
        const existingRecordings = await invoke("get_all_recordings") as Recording[];
        // Sort by ID (timestamp) in ascending order (oldest first, newest at bottom)
        existingRecordings.sort((a, b) => parseInt(a.id) - parseInt(b.id));
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
      let progressInterval: NodeJS.Timeout | null = null;
      abortDownloadRef.current = false;
      let downloadStarted = false;
      
      const handleEscape = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          console.log("ESC pressed - closing dialog");
          abortDownloadRef.current = true;
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          
          // Immediately close the dialog
          if (progressInterval) {
            clearInterval(progressInterval);
            progressInterval = null;
          }
          setIsModelLoading(false);
          setIsInitializing(false);
          setDownloadProgress(0);
          setIsModelAvailable(false);
          document.removeEventListener('keydown', handleEscape, true);
        }
      };
      
      try {
        setIsModelLoading(true);
        setIsInitializing(true);
        setDownloadProgress(0);
        console.log("Checking Whisper model...");
        
        // Wait for Tauri to be fully ready
        if (!(window as any).__TAURI__) {
          console.log("Waiting for Tauri to initialize...");
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        // Add escape key listener with capture phase for highest priority
        document.addEventListener('keydown', handleEscape, true);
        
        // Simulate progress during download
        progressInterval = setInterval(() => {
          if (abortDownloadRef.current) {
            if (progressInterval) {
              clearInterval(progressInterval);
              progressInterval = null;
            }
            return;
          }
          setDownloadProgress(prev => {
            if (prev >= 95) return prev;
            return prev + Math.random() * 5;
          });
        }, 500);
        
        downloadStarted = true;
        
        console.log("Invoking check_model command...");
        // Start download - this will run in background even if we abort
        const downloadPromise = invoke("check_model");
        
        // Wait for download completion
        const result = await downloadPromise;
        console.log("check_model result:", result);
        
        // If user aborted, don't update UI
        if (abortDownloadRef.current) {
          console.log("Download completed but user already closed dialog");
          return;
        }
        
        if (progressInterval) {
          clearInterval(progressInterval);
          progressInterval = null;
        }
        setDownloadProgress(100);
        
        // Wait a moment to show 100%
        await new Promise(resolve => setTimeout(resolve, 500));
        
        setIsModelAvailable(true);
        console.log("Whisper model is ready");
      } catch (err: any) {
        console.error("Failed to load Whisper model:", err);
        console.error("Error details:", err.message, err.stack);
        
        // If user already aborted, don't show error
        if (abortDownloadRef.current) {
          console.log("Download was cancelled by user");
          return;
        }
        
        setIsModelAvailable(false);
        setErrorMessage("Fehler beim Laden des Whisper-Modells: " + (err.message || "Unbekannter Fehler"));
      } finally {
        if (progressInterval) {
          clearInterval(progressInterval);
          progressInterval = null;
        }
        document.removeEventListener('keydown', handleEscape, true);
        
        // Only update UI if not aborted
        if (!abortDownloadRef.current) {
          setIsModelLoading(false);
          setIsInitializing(false);
          setDownloadProgress(0);
        }
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
        console.log("MediaRecorder stopped, processing audio...");
        const duration = Math.round((Date.now() - startTime) / 1000);
        console.log("Recording duration:", duration, "seconds");
        console.log("Audio chunks collected:", audioChunks.length);
        
        if (audioChunks.length === 0) {
          console.error("No audio chunks collected!");
          setErrorMessage("Keine Audio-Daten aufgenommen. Bitte überprüfen Sie Ihr Mikrofon.");
          return;
        }
        
        const blob = new Blob(audioChunks, { type: audioChunks[0]?.type || "audio/webm" });
        console.log("Created blob, size:", blob.size, "bytes, type:", blob.type);
        
        if (blob.size === 0) {
          console.error("Audio blob is empty!");
          setErrorMessage("Audio-Aufnahme ist leer. Bitte versuchen Sie es erneut.");
          return;
        }
        
        const arrayBuffer = await blob.arrayBuffer();
        console.log("ArrayBuffer size:", arrayBuffer.byteLength);

        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        const channelData = audioBuffer.getChannelData(0); // Float32Array
        console.log("Decoded audio, samples:", channelData.length, "sample rate:", audioBuffer.sampleRate);

        // For Tauri, we need Int16
        const samples = new Int16Array(channelData.length);
        for (let i = 0; i < channelData.length; i++) {
          samples[i] = Math.max(-32768, Math.min(32767, channelData[i] * 32767));
        }
        console.log("Converted to Int16, samples:", samples.length);

        // Create a proper WAV blob for playback
        const wavBlob = createWavBlob(samples, 16000);

        const now = new Date();
        const dateStr = now.toLocaleDateString('de-DE').replace(/\//g, '.');
        const timeStr = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' h';

        if (isTauri()) {
          try {
            console.log("Attempting to save recording with", samples.length, "samples");
            console.log("Samples array first 10:", Array.from(samples).slice(0, 10));
            const samplesArray = Array.from(samples);
            console.log("Converted samples to array, length:", samplesArray.length);
            
            const id = await invoke("save_and_queue_recording", { samples: samplesArray }) as string;
            console.log("Recording saved successfully with ID:", id);
            
            audioBlobs.current.set(id, wavBlob); // Store the WAV blob for playback
            const newRec: Recording = {
              id,
              date: dateStr,
              time: timeStr,
              duration: duration,
              status: "transcribing"
            };
            console.log("Adding new recording to state:", newRec);
            
            setRecordings(prev => {
              const updated = [...prev, newRec];
              // Sort by ID (timestamp) ascending (oldest first, newest at bottom)
              updated.sort((a, b) => parseInt(a.id) - parseInt(b.id));
              console.log("Updated recordings list:", updated.length, "recordings");
              return updated;
            });
            setStatus("Gespeichert");
            console.log("Recording saved with ID:", id);
          } catch (e) {
            console.error("Save error:", e);
            console.error("Error details:", e);
            setStatus("Fehler beim Speichern");
            setErrorMessage("Fehler beim Speichern der Aufnahme: " + (e as any).toString());
          }
        } else {
          // Browser Mode: Use Worker
          const id = Date.now().toString();
          audioBlobs.current.set(id, wavBlob);

          const newRec: Recording = {
            id,
            date: dateStr,
            time: timeStr,
            duration: duration,
            status: "transcribing"
          };
          setRecordings(prev => {
            const updated = [...prev, newRec];
            // Sort by ID (timestamp) ascending (oldest first, newest at bottom)
            updated.sort((a, b) => parseInt(a.id) - parseInt(b.id));
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
      
      // Stop all tracks in the stream to release the microphone
      if (mediaRecorderRef.current.stream) {
        mediaRecorderRef.current.stream.getTracks().forEach(track => {
          track.stop();
        });
      }
      
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
        console.log("Starting recording via hotkey");
        startRecording();
      } else {
        console.log("Stopping recording via hotkey");
        stopRecording();
      }
    };

    let unlistenFn: any = null;

    // Wait for Tauri to be fully loaded
    const setupListener = async () => {
      try {
        unlistenFn = await (window as any).__TAURI__.event.listen("hotkey-triggered", handleHotkey);
        console.log("Hotkey listener registered successfully");
      } catch (error) {
        console.error("Failed to register hotkey listener:", error);
      }
    };

    setupListener();

    return () => {
      if (unlistenFn) {
        unlistenFn();
      }
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
        
        // Create proper WAV blob from the byte array
        const uint8Array = new Uint8Array(audioData);
        blob = new Blob([uint8Array], { type: "audio/wav" });
        audioBlobs.current.set(id, blob);
        
        console.log("Created blob, size:", blob.size, "type:", blob.type);
        
        // Verify WAV header
        if (uint8Array.length >= 4) {
          const header = String.fromCharCode(uint8Array[0], uint8Array[1], uint8Array[2], uint8Array[3]);
          console.log("WAV header:", header, "Valid:", header === "RIFF");
        }
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
          console.error("Audio error code:", audio.error?.code, "message:", audio.error?.message);
          setPlayingId(null);
          setPlaybackProgress(0);
          URL.revokeObjectURL(url);
          setErrorMessage(`Wiedergabefehler: ${audio.error?.message || "Unbekanntes Format"}`);
        };

        // Add canplay listener to ensure audio is ready
        audio.oncanplay = () => {
          console.log("Audio is ready to play, duration:", audio.duration);
        };

        try {
          await audio.play();
          console.log("Audio playback started");
        } catch (playErr) {
          console.error("Play error:", playErr);
          setPlayingId(null);
          setPlaybackProgress(0);
          URL.revokeObjectURL(url);
          setErrorMessage(`Wiedergabefehler: ${(playErr as any).message || "Kann nicht abspielen"}`);
        }
      } else {
        console.error("Audio data not found for id:", id);
        setErrorMessage("Audio-Datei nicht gefunden");
      }
    } catch (err) {
      console.error("Playback error:", err);
      const errorMsg = (err as any).message || (err as any).toString();
      setErrorMessage(`Wiedergabefehler: ${errorMsg}`);
    }
  };

  return (
    <div className="app-container">
      {/* Show loading overlay during initialization */}
      {isInitializing && (
        <div className="loading-overlay">
          <div className="loading-card">
            <div className="microphone-container">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="microphone-icon"
              >
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <line x1="12" y1="19" x2="12" y2="22"/>
              </svg>
            </div>
            <div className="loading-text">Whisper-Modell wird geladen...</div>
            <div className="loading-subtext">Dies kann beim ersten Start einige Minuten dauern (~500 MB)</div>
            
            {/* Progress bar - simple line without percentage */}
            <div className="download-progress-container">
              <div className="download-progress-bar" style={{ width: `${downloadProgress}%` }}></div>
            </div>
            
            {/* Cancel button */}
            <button 
              onClick={() => {
                console.log("Download cancelled by button click");
                abortDownloadRef.current = true;
                setIsModelLoading(false);
                setIsInitializing(false);
                setDownloadProgress(0);
                setIsModelAvailable(false);
              }}
              className="cancel-download-btn"
            >
              Abbrechen
            </button>
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

        {/* History Stack and Record Button - Bottom Layout */}
        <div className="controls-and-history">
          {/* History Stack - saved recordings only */}
          <div className="history-stack custom-scrollbar">
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
                  
                  <div className="rec-footer-actions">
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
                          <img src="/.png" alt="AI" />
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
                        
                        {/* Prompt Selector Dropdown */}
                        {isTauri() && promptTemplates.length > 0 && (
                          <select 
                            value={selectedPrompt} 
                            onChange={(e) => setSelectedPrompt(e.target.value)}
                            className="rec-prompt-dropdown"
                            title="Prompt-Template auswählen"
                          >
                            {promptTemplates.map((template) => (
                              <option key={template} value={template}>{template}</option>
                            ))}
                          </select>
                        )}
                        
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

          {/* Record Button and Current Recording - Bottom Left */}
          <div className="record-section">
            <button
              onClick={isRecording ? stopRecording : startRecording}
              className={`record-toggle ${isRecording ? 'recording' : 'idle'}`}
              disabled={isModelLoading}
              title={isRecording ? "Aufnahme stoppen Ctrl+Shift+Space" : "Aufnahme starten Ctrl+Shift+Space"}
            >
              <div className="record-indicator"></div>
            </button>
            
            {/* Show current recording next to button */}
            {isRecording && (
              <div className="current-recording-display">
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
            <h3 className="error-title">
              {errorMessage.includes("Mikrofon") ? "Mikrofon blockiert" : 
               errorMessage.includes("Wiedergabe") ? "Wiedergabefehler" :
               errorMessage.includes("Speichern") ? "Speicherfehler" :
               errorMessage.includes("Whisper") ? "Modell-Fehler" :
               "Fehler"}
            </h3>
            <p className="error-message">{errorMessage}</p>
            <button onClick={() => setErrorMessage(null)} className="error-close-btn">
              OK
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
          width: 550px;
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

        /* Controls and History - Bottom Layout */
        .controls-and-history {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 20px;
          flex: 1;
          min-height: 0;
          position: relative;
        }

        /* Prompt Selector */
        .prompt-selector {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 15px;
          padding: 12px 20px;
          background: #1a1d23;
          border-radius: 12px;
          border: 1px solid #333;
          width: fit-content;
        }
        .prompt-label {
          font-size: 14px;
          color: #aaa;
          font-weight: 500;
        }
        .prompt-dropdown {
          background: #0f1115;
          border: 1px solid #444;
          color: #e0e0e0;
          padding: 8px 16px;
          border-radius: 8px;
          font-size: 14px;
          cursor: pointer;
          transition: all 0.2s;
          outline: none;
          min-width: 150px;
        }
        .prompt-dropdown:hover {
          border-color: #4dabf7;
          background: #1a1d23;
        }
        .prompt-dropdown:focus {
          border-color: #4dabf7;
          box-shadow: 0 0 0 2px rgba(77, 171, 247, 0.1);
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
          flex-direction: row;
          align-items: flex-start;
          gap: 6px;
          overflow-x: auto;
          overflow-y: hidden;
          padding: 0;
          margin: 0;
          margin-left: 60px; /* Space for record button */
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
          padding: 8px 18px; 
          border-radius: 12px; 
          width: 550px; 
          box-shadow: 0 4px 15px rgba(0,0,0,0.4);
          position: relative;
          overflow: hidden;
          display: flex;
          align-items: center;
          min-height: 40px;
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
        .rec-footer { display: flex; align-items: center; gap: 8px; height: 100%; }
        .rec-footer-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; }
        .rec-play-btn, .rec-delete-btn { background: none; border: none; color: #aaa; cursor: pointer; font-size: 18px; transition: all 0.2s; width: 26px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .rec-play-btn:hover { color: #4dabf7; transform: scale(1.1); }
        .rec-play-btn.playing { color: #aaa; }
        .rec-play-btn.playing:hover { color: #4dabf7; transform: scale(1.1); }
        .rec-delete-btn:hover { color: #fa5252; transform: scale(1.1); }
        .rec-duration { font-family: monospace; font-size: 12px; color: #666; flex-shrink: 0; }
        .rec-text-preview { flex: 1; font-size: 13px; color: #777; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; text-align: left; }
        
        /* Inline action buttons inside rec-card */
        .rec-action-btn-inline { 
          width: 26px; height: 26px; 
          background: #2d323b; 
          border-radius: 6px; 
          border: 1px solid #3d424b; 
          cursor: pointer; 
          transition: all 0.2s; 
          display: flex; 
          align-items: center; 
          justify-content: center; 
          padding: 4px;
          flex-shrink: 0;
        }
        .rec-action-btn-inline:hover { 
          transform: scale(1.1); 
          background: #3d424b;
          border-color: #4dabf7;
        }
        .rec-action-btn-inline:disabled { opacity: 0.5; cursor: not-allowed; }
        .rec-action-btn-inline:disabled:hover { 
          transform: scale(1); 
          background: #2d323b; 
          border-color: #3d424b; 
        }
        .rec-action-btn-inline img { width: 100%; height: 100%; object-fit: contain; }
        
        .rec-refresh-btn-inline {
          width: 26px; height: 26px; 
          background: #2d323b; 
          border-radius: 6px;
          border: 1px solid #3d424b; 
          cursor: pointer; 
          transition: all 0.2s;
          display: flex; 
          align-items: center; 
          justify-content: center;
          color: rgb(169, 169, 169); 
          flex-shrink: 0;
        }
        .rec-refresh-btn-inline:hover { 
          transform: scale(1.1); 
          background: #3d424b;
          border-color: #4dabf7;
        }
        .rec-refresh-btn-inline:disabled { opacity: 0.5; cursor: not-allowed; }
        .rec-refresh-btn-inline:disabled:hover { 
          transform: scale(1); 
          background: #2d323b; 
          border-color: #3d424b;
          color: rgb(169, 169, 169); 
        }
        
        /* Inline Prompt Dropdown in Recording Card */
        .rec-prompt-dropdown {
          background: #2d323b;
          color: #e0e0e0;
          border: 1px solid #3d424b;
          border-radius: 6px;
          padding: 4px 8px;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
          flex-shrink: 0;
          max-width: 100px;
        }
        .rec-prompt-dropdown:hover {
          border-color: #4dabf7;
          background: #3d424b;
        }
        .rec-prompt-dropdown:focus {
          outline: none;
          border-color: #4dabf7;
        }

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
        .record-section { 
          position: absolute;
          bottom: 0;
          left: 0;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          gap: 12px;
        }
        
        .current-recording-display {
          animation: slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
        
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(-10px); }
          to { opacity: 1; transform: translateX(0); }
        }
        .record-toggle { 
          width: 40px; height: 40px; border-radius: 50%; border: 3px solid #333; 
          background: none; cursor: pointer; transition: all 0.3s; 
          display: flex; align-items: center; justify-content: center;
        }
        .record-toggle.idle { animation: pulsateButton 2s ease-in-out infinite; }
        .record-toggle:not(:disabled):hover { border-color: #ffffff; transform: scale(1.05); box-shadow: 0 0 15px rgba(255, 255, 255, 0.2); }
        .record-toggle.recording { background: #fa5252; border-color: #fa5252; box-shadow: 0 0 25px rgba(250, 82, 82, 0.5); animation: none; }
        .record-toggle:disabled { opacity: 0.3; cursor: not-allowed; }
        .record-indicator { width: 16px; height: 16px; background: #fa5252; border-radius: 50%; transition: all 0.3s; }
        .record-toggle.recording .record-indicator { width: 12px; height: 12px; background: white; border-radius: 3px; }
        
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
        .microphone-container {
          width: 80px; height: 80px;
          margin: 0 auto 30px; display: flex; align-items: center; justify-content: center;
        }
        .microphone-icon {
          width: 100%; height: 100%;
          color: #4dabf7;
          filter: drop-shadow(0 0 20px rgba(77, 171, 247, 0.5));
          animation: pulse 2s ease-in-out infinite;
        }
        @keyframes pulse {
          0%, 100% { 
            transform: scale(1);
            opacity: 1;
          }
          50% { 
            transform: scale(1.05);
            opacity: 0.8;
          }
        }
        .loading-text { font-size: 22px; font-weight: 700; color: #4dabf7; margin-bottom: 12px; }
        .loading-subtext { font-size: 14px; color: #555; margin-bottom: 25px; }
        
        .download-progress-container {
          width: 100%;
          max-width: 400px;
          height: 4px;
          background: #1a1d23;
          border-radius: 2px;
          overflow: hidden;
          margin: 0 auto;
          border: 1px solid #2a2d33;
        }
        .download-progress-bar {
          height: 100%;
          background: #40c057;
          transition: width 0.3s ease;
          box-shadow: 0 0 8px rgba(64, 192, 87, 0.6);
        }
        
        .cancel-download-btn {
          margin-top: 20px;
          background: #2d323b;
          color: #e0e0e0;
          border: 1px solid #3d424b;
          padding: 10px 24px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        }
        .cancel-download-btn:hover {
          background: #3d424b;
          border-color: #fa5252;
          color: #fa5252;
          transform: scale(1.05);
        }

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
