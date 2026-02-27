// app/page.tsx
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

// Global logging function that writes to window for debugging
const debugLog = (message: string) => {
  console.log(message);
  if (typeof window !== "undefined") {
    if (!(window as any).__DEBUG_LOGS__) {
      (window as any).__DEBUG_LOGS__ = [];
    }
    (window as any).__DEBUG_LOGS__.push(`${new Date().toISOString()}: ${message}`);
    
    // Also try to log to Rust backend if available
    try {
      if ((window as any).__TAURI__) {
        invoke("log_frontend", { message }).catch(() => {
          // Ignore errors
        });
      }
    } catch (e) {
      // Ignore errors
    }
  }
};

// Utility: Check if running inside Tauri
const isTauri = () => {
  if (typeof window === "undefined") {
    debugLog("isTauri: window is undefined");
    return false;
  }
  // Check for Tauri API - be more thorough
  const hasTauri = !!(window as any).__TAURI__;
  debugLog(`isTauri check: ${hasTauri}, window.__TAURI__: ${typeof (window as any).__TAURI__}`);
  return hasTauri;
};

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
  const [promptTemplateText, setPromptTemplateText] = useState<string>("");
  const [enrichingId, setEnrichingId] = useState<string | null>(null);
  const [expandedTranscription, setExpandedTranscription] = useState<string | null>(null);
  const [expandedEnrichment, setExpandedEnrichment] = useState<string | null>(null);
  const [isModelAvailable, setIsModelAvailable] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true); // Start as true to show splash screen
  const [isTauriMode, setIsTauriMode] = useState<boolean | null>(null); // null = not yet determined
  const [isHistoryVisible, setIsHistoryVisible] = useState(false); // State to control history visibility (hidden by default)
  const [isSettingsVisible, setIsSettingsVisible] = useState(false); // State to control settings visibility
  const [previousHistoryVisible, setPreviousHistoryVisible] = useState<boolean | null>(null); // Track history state before settings opened
  const [config, setConfig] = useState<{
    provider: 'ollama' | 'openrouter';
    url: string;
    api_key: string;
    model: string;
    timeout_seconds: number;
    prompt_template1: string;
    prompt_template2: string;
    prompt_template3: string;
    prompt_template4: string;
    whisper_model_url: string;
    enabled: boolean;
  } | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [configMessage, setConfigMessage] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const audioBlobs = useRef<Map<string, Blob>>(new Map());

  // Debug: Log component mount
  useEffect(() => {
    console.log("HomePage component mounted, isTauri:", isTauri(), "isInitializing:", true, "isTauriMode:", isTauriMode);
    console.log("window.__TAURI__ at mount:", typeof (window as any).__TAURI__);
    console.log("window location:", window.location.href);
    
    // Force log to backend immediately
    const hasTauri = typeof window !== "undefined" && !!(window as any).__TAURI__;
    console.log("Checking for Tauri, result:", hasTauri);
    if (hasTauri) {
      invoke("log_frontend", { message: "=== HOMEPAGE COMPONENT MOUNTED ===" })
        .then(() => console.log("log_frontend succeeded"))
        .catch(e => console.error("log_frontend FAILED:", e));
    } else {
      console.log("NOT calling log_frontend - Tauri not detected");
    }
  }, []);

  // Load config on mount (Tauri mode only)
  useEffect(() => {
    const loadConfig = async () => {
      if (typeof window !== "undefined" && !!(window as any).__TAURI__) {
        try {
          setConfigLoading(true);
          const cfg = await invoke("get_config") as any;
          setConfig({
            provider: cfg.llm.provider === 'openrouter' ? 'openrouter' : 'ollama',
            url: cfg.llm.url,
            api_key: cfg.llm.api_key,
            model: cfg.llm.model,
            timeout_seconds: cfg.llm.timeout_seconds,
            prompt_template1: cfg.llm.prompt_template1,
            prompt_template2: cfg.llm.prompt_template2,
            prompt_template3: cfg.llm.prompt_template3,
            prompt_template4: cfg.llm.prompt_template4,
            whisper_model_url: cfg.llm.whisper_model_url,
            enabled: cfg.llm.enabled,
          });
          setConfigLoading(false);
        } catch (err) {
          console.error("Failed to load config:", err);
          setConfigMessage("Failed to load configuration");
          setConfigLoading(false);
        }
      }
    };
    loadConfig();
  }, []);

  // Load prompt template text when selection changes
  useEffect(() => {
    const loadPromptText = async () => {
      if (typeof window !== "undefined" && !!(window as any).__TAURI__ && selectedPrompt) {
        try {
          const text = await invoke("get_prompt_template_text", { promptName: selectedPrompt }) as string;
          setPromptTemplateText(text);
        } catch (err) {
          console.error("Failed to load prompt template text:", err);
        }
      }
    };
    loadPromptText();
  }, [selectedPrompt]);

  // Initialize Worker for Browser Mode
  useEffect(() => {
    if (isTauriMode === true) return; // Skip if in Tauri mode
    if (isTauriMode === null) return; // Wait until mode is determined

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
  }, [isTauriMode]);

  // Listen for model ready/failed events from backend
  useEffect(() => {
    if (isTauriMode !== true) return;
    
    const setupModelListeners = async () => {
      const unlistenReady = await (window as any).__TAURI__.event.listen(
        "model_ready",
        () => {
          debugLog("Model ready event received - model download complete");
          setIsModelAvailable(true);
          setIsModelLoading(false);
          setIsInitializing(false); // Hide splash screen only after model is fully ready
        }
      );
      
      const unlistenFailed = await (window as any).__TAURI__.event.listen(
        "model_failed",
        (event: any) => {
          debugLog(`Model failed event received: ${event.payload}`);
          setIsModelAvailable(false);
          setIsModelLoading(false);
          setIsInitializing(false); // Hide splash screen on error
          setErrorMessage("Fehler beim Laden des Whisper-Modells: " + event.payload);
        }
      );
      
      const unlistenChecking = await (window as any).__TAURI__.event.listen(
        "model_checking",
        () => {
          debugLog("Model checking event received - keeping splash screen visible");
          setIsModelLoading(true);
          setIsInitializing(true); // Keep splash screen visible during download
        }
      );
      
      return () => {
        unlistenReady();
        unlistenFailed();
        unlistenChecking();
      };
    };
    
    setupModelListeners();
  }, [isTauriMode]);

  // Listen for enriched result from Rust (Tauri only)
  useEffect(() => {
    if (isTauriMode !== true) return;
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
  }, [isTauriMode]);

  // Load existing recordings on mount and sort by timestamp
  useEffect(() => {
    debugLog(`Initialization useEffect running, isTauri: ${isTauri()}`);
    
    // Wait for Tauri to be available
    const waitForTauri = async () => {
      let attempts = 0;
      const maxAttempts = 50; // Increased from 10 to 50 (5 seconds total)
      while (attempts < maxAttempts) {
        if ((window as any).__TAURI__) {
          debugLog(`Tauri API detected after ${attempts} attempts (${attempts * 100}ms)`);
          return true;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
        
        // Log every 10 attempts
        if (attempts % 10 === 0) {
          debugLog(`Still waiting for Tauri API... attempt ${attempts}/${maxAttempts}`);
        }
      }
      debugLog(`Tauri API not detected after ${maxAttempts} attempts (${maxAttempts * 100}ms) - assuming browser mode`);
      return false;
    };
    
    const initialize = async () => {
      debugLog(`=== INITIALIZATION START ===`);
      debugLog(`window.location.protocol: ${window.location.protocol}`);
      debugLog(`window.location.href: ${window.location.href}`);
      debugLog(`window.__TAURI__ initial: ${typeof (window as any).__TAURI__}`);
      
      const hasTauri = await waitForTauri();
      
      debugLog(`=== TAURI DETECTION RESULT ===`);
      debugLog(`hasTauri: ${hasTauri}`);
      debugLog(`window.__TAURI__: ${typeof (window as any).__TAURI__}`);
      debugLog(`Setting isTauriMode to: ${hasTauri}`);
      
      // Set the Tauri mode state
      setIsTauriMode(hasTauri);
      debugLog(`Tauri mode set to: ${hasTauri}`);
      
      if (!hasTauri) {
        // In browser mode, skip initialization and hide splash screen
        debugLog("Browser mode detected, skipping initialization");
        setIsInitializing(false);
        return;
      }

      debugLog("Tauri mode detected, loading data...");
      
      // Model check happens automatically in backend on startup
      // Backend will emit model_checking event if download needed
      // Keep splash screen visible until model_ready event is received
      debugLog("Waiting for model_ready event before hiding splash screen");

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
          // Load the text for the first template
          if (typeof window !== "undefined" && !!(window as any).__TAURI__) {
            const text = await invoke("get_prompt_template_text", { promptName: templates[0] }) as string;
            setPromptTemplateText(text);
          }
        }
      } catch (err) {
        console.error("Failed to load prompt templates:", err);
      }
    };

    // Load data
    loadExistingRecordings();
    loadPromptTemplates();
    };

    initialize();
  }, []);

  const startRecording = useCallback(async () => {
    // Log to backend immediately
    if (typeof window !== "undefined" && (window as any).__TAURI__) {
      await invoke("log_frontend", { message: "=== RECORDING START ===" }).catch(() => {});
    }
    console.log("=== RECORDING START ===");
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioChunks: Blob[] = [];
      const startTime = Date.now();

      mediaRecorderRef.current = new MediaRecorder(stream);
      mediaRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.push(e.data);
      };

      mediaRecorderRef.current.onstop = async () => {
        const isRunningInTauri = typeof window !== "undefined" && !!(window as any).__TAURI__;

        // Log to backend immediately
        if (isRunningInTauri) {
          await invoke("log_frontend", { message: "=== RECORDING END ===" }).catch(() => {});
        }
        
        console.log("=== RECORDING END ===");
        const duration = Math.round((Date.now() - startTime) / 1000);
        console.log("Recording duration:", duration, "seconds");
        console.log("Audio chunks collected:", audioChunks.length);
        console.log("isRunningInTauri:", isRunningInTauri);
        
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

        if (isRunningInTauri) {
          console.log("✓ TAURI MODE - Will save to backend");
          try {
            debugLog(`Attempting to save recording with ${samples.length} samples`);
            debugLog(`Samples array first 10: ${Array.from(samples).slice(0, 10)}`);
            debugLog(`isTauriMode state: ${isTauriMode}`);
            debugLog(`window.__TAURI__ exists: ${!!(window as any).__TAURI__}`);
            
            const samplesArray = Array.from(samples);
            debugLog(`Converted samples to array, length: ${samplesArray.length}`);
            
            console.log("Calling invoke('save_and_queue_recording')...");
            const id = await invoke("save_and_queue_recording", { samples: samplesArray }) as string;
            console.log("✓ Backend returned ID:", id);
            debugLog(`Recording saved successfully with ID: ${id}`);
            
            audioBlobs.current.set(id, wavBlob); // Store the WAV blob for playback
            const newRec: Recording = {
              id,
              date: dateStr,
              time: timeStr,
              duration: duration,
              status: "transcribing"
            };
            debugLog(`Adding new recording to state: ${JSON.stringify(newRec)}`);
            
            setRecordings(prev => {
              const updated = [...prev, newRec];
              // Sort by ID (timestamp) ascending (oldest first, newest at bottom)
              updated.sort((a, b) => parseInt(a.id) - parseInt(b.id));
              debugLog(`Updated recordings list: ${updated.length} recordings`);
              return updated;
            });
            setStatus("Gespeichert");
            debugLog(`Recording saved with ID: ${id}`);
          } catch (e) {
            console.error("✗ SAVE ERROR:", e);
            debugLog(`Save error: ${e}`);
            debugLog(`Error details: ${JSON.stringify(e)}`);
            console.error("Save error:", e);
            console.error("Error details:", e);
            setStatus("Fehler beim Speichern");
            setErrorMessage("Fehler beim Speichern der Aufnahme: " + (e as any).toString());
          }
        } else {
          console.log("✗ BROWSER MODE - Not saving to backend");
          debugLog("Not in Tauri mode - using browser mode");
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


      mediaRecorderRef.current.start(250);
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
  }, [isTauriMode]);

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
    if (isTauriMode !== true) return;

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
  }, [isRecording, startRecording, stopRecording, isTauriMode]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const reEnrichWithPrompt = async (id: string) => {
    if (isTauriMode !== true) return;
    
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

    // Use direct window check instead of stale isTauriMode
    if (typeof window !== "undefined" && !!(window as any).__TAURI__) {
      try {
        await invoke("delete_recording", { id });
      } catch (err) {
        console.error("Delete error:", err);
      }
    }
  };

  const playRecording = async (id: string) => {
    console.log("=== PLAY_RECORDING START ===");
    console.log("Requested ID:", id);
    console.log("Currently playing ID:", playingId);
    console.log("isTauriMode:", isTauriMode);
    
    if (playingId === id) {
      console.log("Stopping current playback");
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      setPlayingId(null);
      setPlaybackProgress(0);
      console.log("=== PLAY_RECORDING END (stopped) ===");
      return;
    }

    setPlaybackProgress(0);

    try {
      let blob = audioBlobs.current.get(id);
      console.log("Checking in-memory blob for ID:", id);
      console.log("  Blob exists in memory:", !!blob);
      if (blob) {
        console.log("  Blob size:", blob.size, "bytes");
        console.log("  Blob type:", blob.type);
      }

      if (!blob && isTauriMode) {
        // Fetch from Rust if not in memory
        console.log("Blob not in memory, fetching from Rust backend...");
        console.log("  Calling invoke('get_recording_audio', { id:", id, "})");
        
        try {
          const audioData = await invoke("get_recording_audio", { id }) as number[];
          console.log("✓ Received audio data from backend");
          console.log("  Data length:", audioData.length, "bytes");
          
          // Create proper WAV blob from the byte array
          const uint8Array = new Uint8Array(audioData);
          blob = new Blob([uint8Array], { type: "audio/wav" });
          audioBlobs.current.set(id, blob);
          
          console.log("✓ Created blob from backend data");
          console.log("  Blob size:", blob.size, "bytes");
          console.log("  Blob type:", blob.type);
          
          // Verify WAV header
          if (uint8Array.length >= 4) {
            const header = String.fromCharCode(uint8Array[0], uint8Array[1], uint8Array[2], uint8Array[3]);
            console.log("  WAV header:", header);
            console.log("  Valid WAV:", header === "RIFF");
          }
        } catch (fetchErr) {
          console.error("✗ ERROR fetching audio from backend:", fetchErr);
          console.error("  Error details:", JSON.stringify(fetchErr));
          throw fetchErr;
        }
      }

      if (blob) {
        console.log("Creating audio element from blob");
        console.log("  Blob size:", blob.size, "bytes");
        const url = URL.createObjectURL(blob);
        console.log("  Created object URL:", url);
        
        if (audioRef.current) {
          console.log("  Pausing existing audio");
          audioRef.current.pause();
        }
        
        const audio = new Audio(url);
        audioRef.current = audio;
        setPlayingId(id);
        console.log("  Audio element created");

        audio.ontimeupdate = () => {
          if (audio.duration) {
            setPlaybackProgress((audio.currentTime / audio.duration) * 100);
          }
        };

        audio.onended = () => {
          console.log("Audio playback ended");
          setPlayingId(null);
          setPlaybackProgress(0);
          URL.revokeObjectURL(url);
        };

        audio.onerror = (e) => {
          console.error("✗ Audio playback error:", e);
          console.error("  Error code:", audio.error?.code);
          console.error("  Error message:", audio.error?.message);
          setPlayingId(null);
          setPlaybackProgress(0);
          URL.revokeObjectURL(url);
          setErrorMessage(`Wiedergabefehler: ${audio.error?.message || "Unbekanntes Format"}`);
        };

        // Add canplay listener to ensure audio is ready
        audio.oncanplay = () => {
          console.log("✓ Audio is ready to play");
          console.log("  Duration:", audio.duration, "seconds");
        };

        try {
          console.log("Attempting to play audio...");
          await audio.play();
          console.log("✓ Audio playback started successfully");
          console.log("=== PLAY_RECORDING END (playing) ===");
        } catch (playErr) {
          console.error("✗ Play error:", playErr);
          console.error("  Error details:", JSON.stringify(playErr));
          setPlayingId(null);
          setPlaybackProgress(0);
          URL.revokeObjectURL(url);
          setErrorMessage(`Wiedergabefehler: ${(playErr as any).message || "Kann nicht abspielen"}`);
          console.log("=== PLAY_RECORDING END (play failed) ===");
        }
      } else {
        console.error("✗ ERROR: No blob available for playback");
        console.error("  ID:", id);
        console.error("  isTauriMode:", isTauriMode);
        console.error("  Blobs in memory:", Array.from(audioBlobs.current.keys()));
        setErrorMessage("Audio-Datei nicht gefunden");
        console.log("=== PLAY_RECORDING END (no blob) ===");
      }
    } catch (err) {
      console.error("✗ Playback error:", err);
      console.error("  Error type:", typeof err);
      console.error("  Error details:", JSON.stringify(err));
      const errorMsg = (err as any).message || (err as any).toString();
      setErrorMessage(`Wiedergabefehler: ${errorMsg}`);
      console.log("=== PLAY_RECORDING END (error) ===");
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
            
            {/* Simple loading spinner instead of progress bar */}
            <div className="loading-spinner"></div>
          </div>
        </div>
      )}

      {/* Main UI - only show after initialization */}
      {!isInitializing && (
        <>
      {/* Main Content Area */}
      <div className="main-content">

        {/* History Stack and Record Button - Bottom Layout */}
        <div className="controls-and-history">
          {/* History Stack - saved recordings only */}
          <div className={`history-stack custom-scrollbar ${!isHistoryVisible ? 'hidden' : ''}`} style={!isHistoryVisible ? { display: 'none' } : undefined}>
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
                  <span className="rec-text-preview">{rec.transcription ? (rec.transcription.length > 35 ? rec.transcription.substring(0, 35) + "..." : rec.transcription) : ""}</span>
                  
                  <div className="rec-footer-actions">
                    {!rec.transcription && (
                      <div className="rec-processing-inline">
                        <div className="standby-circle-inline"></div>
                      </div>
                    )}
          
                    {rec.transcription && (
                      <button
                        onClick={() => {
                          if (expandedTranscription === rec.id) {
                            setExpandedTranscription(null);
                          } else {
                            setExpandedTranscription(rec.id);
                            setExpandedEnrichment(null);
                          }
                        }}
                        className={`rec-action-btn-inline ${expandedTranscription === rec.id ? 'active' : ''}`}
                        title="Transkription anzeigen"
                      >
                        <img src="/transkription.png" alt="A" />
                      </button>
                    )}
          
                    <button
                      onClick={() => {
                        if (rec.enrichment) {
                          if (expandedEnrichment === rec.id) {
                            setExpandedEnrichment(null);
                          } else {
                            setExpandedEnrichment(rec.id);
                            setExpandedTranscription(null);
                          }
                        }
                      }}
                      className={`rec-action-btn-inline ${rec.enrichment && expandedEnrichment === rec.id ? 'active' : ''} ${!rec.enrichment ? 'invisible' : ''}`}
                      title={rec.enrichment ? "Transkription AI" : ""}
                      disabled={!rec.enrichment}
                    >
                      <img src="/transkription-ai.png" alt="AI" />
                    </button>
          
                    <select
                      value={selectedPrompt}
                      onChange={(e) => setSelectedPrompt(e.target.value)}
                      className={`rec-prompt-dropdown ${!(rec.enrichment && isTauriMode && promptTemplates.length > 0) ? 'invisible' : ''}`}
                      title={promptTemplateText}
                      disabled={!(rec.enrichment && isTauriMode && promptTemplates.length > 0)}
                    >
                      {promptTemplates.map((template) => (
                        <option key={template} value={template} title={template === selectedPrompt ? promptTemplateText : ""}>
                          {template}
                        </option>
                      ))}
                    </select>
          
                    <button
                      onClick={() => {
                        if (rec.enrichment && !enrichingId) {
                          reEnrichWithPrompt(rec.id);
                        }
                      }}
                      className={`rec-refresh-btn-inline ${!rec.enrichment ? 'invisible' : ''}`}
                      disabled={!rec.enrichment || enrichingId === rec.id}
                      title={rec.enrichment ? "Neu anreichern mit aktuellem Prompt" : ""}
                    >
                      {enrichingId === rec.id ? (
                        <div className="button-spinner-inline"></div>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                        </svg>
                      )}
                    </button>
          
                    <button onClick={() => deleteRecording(rec.id)} className="rec-delete-btn" title="Löschen">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16.2" height="16.2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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

              {/* Inline Transcription Display */}
              {(expandedTranscription === rec.id || expandedEnrichment === rec.id) && (
                  <>
                    {/* Transcription block */}
                    {expandedTranscription === rec.id && rec.transcription && (
                      <div className="rec-transcription-inline">
                        <div className="rec-transcription-text">
                          {rec.transcription}
                        </div>
                        <div className="rec-transcription-footer">
                          <button 
                            className="rec-copy-btn"
                            onClick={() => navigator.clipboard.writeText(rec.transcription || "")}
                            title="In Zwischenablage kopieren"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="12.6" height="12.6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Enrichment block */}
                    {expandedEnrichment === rec.id && rec.enrichment && (
                      <div className="rec-transcription-inline">
                        <div className="rec-transcription-text">
                          {rec.enrichment}
                        </div>
                        <div className="rec-transcription-footer">
                          <button 
                            className="rec-copy-btn"
                            onClick={() => navigator.clipboard.writeText(rec.enrichment || "")}
                            title="In Zwischenablage kopieren"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
            </div>
          ))}

          </div>

          {/* Settings Panel - appears in place of history stack when visible */}
          {isSettingsVisible && (
            <div className="settings-panel custom-scrollbar" style={{ display: 'block' }}>
              <div className="settings-card">
                <div className="settings-header">
                  <h3 className="settings-title">Einstellungen</h3>
                  <button 
                    className="settings-close-btn"
                    onClick={() => setIsSettingsVisible(false)}
                    title="Schließen"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                  </button>
                </div>
                <div className="settings-content">
                  {configLoading ? (
                    <div className="settings-loading">Lade Konfiguration...</div>
                  ) : configMessage ? (
                    <div className="settings-error">{configMessage}</div>
                  ) : (
                    <>
                  <div className="settings-section">
                    <h4 className="settings-section-title">LLM Provider</h4>
                    <div className="settings-item">
                      <label className="settings-label">Provider</label>
                      <select 
                        className="settings-select"
                        value={config?.provider || 'ollama'}
                        onChange={(e) => {
                          const provider = e.target.value as 'ollama' | 'openrouter';
                          const defaultUrl = provider === 'ollama' ? 'http://127.0.0.1:11434' : 'https://openrouter.ai/api/v1';
                          setConfig(prev => prev ? { ...prev, provider, url: defaultUrl } : null);
                        }}
                      >
                        <option value="ollama">Ollama (Lokal)</option>
                        <option value="openrouter">OpenRouter (Cloud)</option>
                      </select>
                    </div>
                    {config?.provider === 'openrouter' && (
                      <div className="settings-item">
                        <label className="settings-label">API Key</label>
                        <input 
                          type="password"
                          className="settings-input"
                          value={config?.api_key || ''}
                          onChange={(e) => setConfig(prev => prev ? { ...prev, api_key: e.target.value } : null)}
                          placeholder="sk-or-..."
                        />
                      </div>
                    )}
                    <div className="settings-item">
                      <label className="settings-label">Server URL</label>
                      <input 
                        type="text"
                        className="settings-input"
                        value={config?.url || ''}
                        onChange={(e) => setConfig(prev => prev ? { ...prev, url: e.target.value } : null)}
                        placeholder={config?.provider === 'ollama' ? 'http://127.0.0.1:11434' : 'https://openrouter.ai/api/v1'}
                      />
                    </div>
                    <div className="settings-item">
                      <label className="settings-label">Modell</label>
                      <input 
                        type="text"
                        className="settings-input"
                        value={config?.model || ''}
                        onChange={(e) => setConfig(prev => prev ? { ...prev, model: e.target.value } : null)}
                        placeholder="llama3.2:latest"
                      />
                    </div>
                    <div className="settings-item">
                      <label className="settings-label">Timeout (Sekunden)</label>
                      <input 
                        type="number"
                        className="settings-input"
                        value={config?.timeout_seconds || 60}
                        onChange={(e) => setConfig(prev => prev ? { ...prev, timeout_seconds: parseInt(e.target.value) || 60 } : null)}
                        min={1}
                        max={300}
                      />
                    </div>
                  </div>
                  
                  <div className="settings-section">
                    <h4 className="settings-section-title">Prompt Templates</h4>
                    <div className="settings-item">
                      <label className="settings-label">Prompt 1</label>
                      <textarea 
                        className="settings-textarea"
                        value={config?.prompt_template1 || ''}
                        onChange={(e) => setConfig(prev => prev ? { ...prev, prompt_template1: e.target.value } : null)}
                        rows={3}
                      />
                    </div>
                    <div className="settings-item">
                      <label className="settings-label">Prompt 2</label>
                      <textarea 
                        className="settings-textarea"
                        value={config?.prompt_template2 || ''}
                        onChange={(e) => setConfig(prev => prev ? { ...prev, prompt_template2: e.target.value } : null)}
                        rows={3}
                      />
                    </div>
                    <div className="settings-item">
                      <label className="settings-label">Prompt 3</label>
                      <textarea 
                        className="settings-textarea"
                        value={config?.prompt_template3 || ''}
                        onChange={(e) => setConfig(prev => prev ? { ...prev, prompt_template3: e.target.value } : null)}
                        rows={3}
                      />
                    </div>
                    <div className="settings-item">
                      <label className="settings-label">Prompt 4</label>
                      <textarea 
                        className="settings-textarea"
                        value={config?.prompt_template4 || ''}
                        onChange={(e) => setConfig(prev => prev ? { ...prev, prompt_template4: e.target.value } : null)}
                        rows={3}
                      />
                    </div>
                  </div>
                  
                  <div className="settings-section">
                    <h4 className="settings-section-title">Whisper Modell</h4>
                    <div className="settings-item">
                      <label className="settings-label">Modell URL</label>
                      <input 
                        type="text"
                        className="settings-input"
                        value={config?.whisper_model_url || ''}
                        onChange={(e) => setConfig(prev => prev ? { ...prev, whisper_model_url: e.target.value } : null)}
                      />
                    </div>
                  </div>
                  
                  <div className="settings-actions">
                    <button 
                      className="settings-button-primary"
                      onClick={async () => {
                        if (!config) return;
                        try {
                          await invoke("save_config", { configData: config });
                          setConfigMessage("Konfiguration gespeichert!");
                          setTimeout(() => setConfigMessage(null), 3000);
                        } catch (err) {
                          setConfigMessage("Fehler beim Speichern: " + (err as any).toString());
                        }
                      }}
                    >
                      Speichern
                    </button>
                    <button 
                      className="settings-button-secondary"
                      onClick={async () => {
                        try {
                          const cfg = await invoke("get_config") as any;
                          setConfig({
                            provider: cfg.llm.provider === 'openrouter' ? 'openrouter' : 'ollama',
                            url: cfg.llm.url,
                            api_key: cfg.llm.api_key,
                            model: cfg.llm.model,
                            timeout_seconds: cfg.llm.timeout_seconds,
                            prompt_template1: cfg.llm.prompt_template1,
                            prompt_template2: cfg.llm.prompt_template2,
                            prompt_template3: cfg.llm.prompt_template3,
                            prompt_template4: cfg.llm.prompt_template4,
                            whisper_model_url: cfg.llm.whisper_model_url,
                            enabled: cfg.llm.enabled,
                          });
                          setConfigMessage("Konfiguration neu geladen");
                          setTimeout(() => setConfigMessage(null), 3000);
                        } catch (err) {
                          setConfigMessage("Fehler beim Laden: " + (err as any).toString());
                        }
                      }}
                    >
                      Neu laden
                    </button>
                  </div>
                  </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Record Button, Eject Button, and Settings Button - Bottom Left */}
          <div className="record-section">
            <div className="record-button-wrapper">
              <button
                onClick={isRecording ? stopRecording : startRecording}
                className={`record-toggle ${isRecording ? 'recording' : 'idle'}`}
                disabled={isModelLoading}
                title={isRecording ? "Aufnahme stoppen Ctrl+Shift+Space" : "Aufnahme starten Ctrl+Shift+Space"}
              >
                <div className="record-indicator"></div>
              </button>
              <button
                className="eject-button"
                title="Aufnahmen"
                onClick={() => setIsHistoryVisible(!isHistoryVisible)}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16.2" height="16.2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                  <line x1="12" y1="11" x2="12" y2="17"></line>
                  <line x1="9" y1="14" x2="15" y2="14"></line>
                </svg>
              </button>
              <button 
                className="settings-button" 
                title="Einstellungen"
                onClick={() => {
                  if (!isSettingsVisible) {
                    // Opening settings: save current history state and hide it
                    setPreviousHistoryVisible(isHistoryVisible);
                    setIsSettingsVisible(true);
                    setIsHistoryVisible(false);
                  } else {
                    // Closing settings: restore previous history state
                    setIsSettingsVisible(false);
                    if (previousHistoryVisible !== null) {
                      setIsHistoryVisible(previousHistoryVisible);
                      setPreviousHistoryVisible(null);
                    }
                  }
                }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12.6" height="12.6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                 <circle cx="12" cy="12" r="3"></circle>
                 <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
               </svg>
             </button>
             <button
               className="exit-button"
               title="Anwendung beenden"
               onClick={async () => {
                 // Direct check for Tauri app API
                 if (typeof window !== "undefined" && (window as any).__TAURI__ && (window as any).__TAURI__.app) {
                   try {
                     await (window as any).__TAURI__.app.exit();
                   } catch (error) {
                     console.error("Failed to exit application:", error);
                   }
                 } else {
                   console.log("Not in Tauri mode or app API not available");
                 }
               }}
             >
               <svg xmlns="http://www.w3.org/2000/svg" width="12.6" height="12.6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                 <line x1="18" y1="6" x2="6" y2="18"></line>
                 <line x1="6" y1="6" x2="18" y2="18"></line>
               </svg>
             </button>
           </div>
            
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
          background: transparent;
          color: #e0e0e0;
          font-family: 'Inter', sans-serif;
        }
        .app-container {
          height: 100vh;
          width: 100%;
          min-width: 600px;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          padding: 20px 40px;
          box-sizing: border-box;
          background: rgba(15, 17, 21, 0.95);
          border-radius: 12px;
          overflow: auto;
        }
        
        /* Show scrollbar for app-container only when necessary */
        .app-container::-webkit-scrollbar {
          width: 8px;
          height: 8px;
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

        /* Bottom Panel */
        .display-panel {
          width: 550px;
          height: 200px;
          background: #1a1d23;
          border-radius: 24px;
          border: 1px solid #2d323b;
          margin-top: 20px;
          margin-left: 0;
          margin-right: auto;
          transition: all 0.4s ease;
          position: relative;
          flex-shrink: 0;
          order: 2; /* Move to bottom */
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
          width: 100%;
          max-width: 750px;
          display: flex;
          flex-direction: column;
          flex: 1;
          min-height: 0;
          padding-bottom: 20px;
        }

        /* Controls and History - Top Layout */
        .controls-and-history {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 20px;
          flex: 1;
          min-height: 0;
          position: relative;
          order: 1; /* Keep at top */
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
          flex-direction: column;
          justify-content: flex-end;
          align-items: flex-start;
          gap: 6px;
          overflow-x: hidden;
          overflow-y: auto;
          padding: 0;
          margin: 0;
          padding-bottom: 70px; /* Space for fixed record button at bottom */
          width: 100%;
          max-width: 750px;
          box-sizing: border-box;
          transition: all 0.3s ease;
        }

        .history-stack.hidden {
          display: none;
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
          flex-direction: column;
          align-items: flex-start; 
          width: 100%;
          max-width: 750px;
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
          width: 100%;
          max-width: 750px;
          box-shadow: 0 4px 15px rgba(0,0,0,0.4);
          position: relative;
          overflow: hidden;
          display: flex;
          align-items: center;
          height: 50px;
          box-sizing: border-box;
        }
        .rec-card.recording-active {
          max-width: 500px;
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

        .rec-transcription-inline {
          background: #1a1d23;
          border: 1px solid #333;
          border-radius: 8px;
          padding: 12px;
          margin-top: 8px;
          width: 100%;
          max-width: 750px;
          box-sizing: border-box;
          animation: slideDown 0.2s ease-out;
        }

        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .rec-transcription-footer {
          font-size: 12px;
          color: #4dabf7;
          margin-top: 8px;
          font-weight: 600;
          display: flex;
          align-items: center;
          justify-content: flex-end;
        }

        .rec-copy-btn {
          background: none;
          border: none;
          color: #666;
          cursor: pointer;
          padding: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 4px;
          transition: all 0.2s;
        }

        .rec-copy-btn:hover {
          color: #4dabf7;
          background: rgba(77, 171, 247, 0.1);
        }

        .rec-transcription-text {
          font-size: 14px;
          color: #d1d5db;
          line-height: 1.5;
          white-space: pre-wrap;
          word-wrap: break-word;
        }
        
        .rec-time {
          font-size: 13px;
          color: #aaa;
          font-weight: 500;
          width: 150px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .rec-footer {
          display: flex;
          align-items: center;
          gap: 8px;
          height: 100%;
          position: relative;
          padding-right: 220px;
        }
        .rec-footer-actions {
          position: absolute;
          right: 0;
          top: 50%;
          transform: translateY(-50%);
          display: flex;
          align-items: center;
          gap: 8px;
          max-width: 220px;
          justify-content: flex-end;
        }
        .rec-play-btn, .rec-delete-btn { background: none; border: none; color: #aaa; cursor: pointer; font-size: 18px; line-height: 26px; transition: all 0.2s; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-sizing: border-box; }
        .rec-play-btn:hover { color: #4dabf7; transform: scale(1.1); }
        .rec-play-btn.playing { color: #aaa; }
        .rec-play-btn.playing:hover { color: #4dabf7; transform: scale(1.1); }
        .rec-delete-btn:hover { color: #fa5252; transform: scale(1.1); }
        .rec-duration {
          font-family: monospace;
          font-size: 12px;
          color: #666;
          width: 50px;
          text-align: center;
          flex-shrink: 0;
        }
        .rec-text-preview {
          flex: 1;
          font-size: 13px;
          color: #777;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          min-width: 0;
          text-align: left;
        }
        
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
          flex-shrink: 0;
          box-sizing: border-box;
        }
        .rec-action-btn-inline.active {
          background: transparent;
          border-color: #4dabf7;
        }
        .rec-action-btn-inline.active:hover {
          background: transparent;
          border-color: #4dabf7;
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
          width: 80px;
          height: 26px;
          display: flex;
          align-items: center;
          justify-content: center;
          box-sizing: border-box;
        }
        .rec-prompt-dropdown:hover {
          border-color: #4dabf7;
          background: #3d424b;
        }
        .rec-prompt-dropdown:focus {
          outline: none;
          border-color: #4dabf7;
        }
        
        .rec-action-btn-inline.invisible,
        .rec-refresh-btn-inline.invisible,
        .rec-prompt-dropdown.invisible {
          visibility: hidden;
          pointer-events: none;
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
        
        /* Record Button Section - contains record, eject, and settings buttons */
        .record-section { 
          position: fixed;
          bottom: 20px;
          left: 40px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          gap: 12px;
          z-index: 100;
        }
        
        .record-button-wrapper {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        
        .record-toggle {
          width: 56px; height: 56px; border-radius: 50%; border: 3px solid #333;
          background: none; cursor: pointer; transition: all 0.3s;
          display: flex; align-items: center; justify-content: center;
          box-sizing: border-box;
          transform-origin: center center;
        }
        .record-toggle.idle { animation: pulsateButton 2s ease-in-out infinite; }
        .record-toggle.idle:not(:hover) { transform: scale(1); }
        .record-toggle:not(:disabled):hover { border-color: #ffffff; transform: scale(1.05) !important; box-shadow: 0 0 15px rgba(255, 255, 255, 0.2); }
        .record-toggle.recording { background: #fa5252; border-color: #fa5252; box-shadow: 0 0 25px rgba(250, 82, 82, 0.5); animation: none; transform: scale(1); }
        .record-toggle:disabled { opacity: 0.3; cursor: not-allowed; animation: none; transform: scale(1); }
        .record-indicator { width: 22px; height: 22px; background: #fa5252; border-radius: 50%; transition: all 0.3s; }
        .record-toggle.recording .record-indicator { width: 17px; height: 17px; background: white; border-radius: 3px; }
        
        @keyframes pulsateButton { 
          0%, 100% { transform: scale(1); opacity: 1; } 
          50% { transform: scale(1.08); opacity: 0.85; } 
        }
        
        .eject-button, .settings-button, .exit-button {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: #2d323b;
          border: 2px solid #444;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #aaa;
          transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
          box-sizing: border-box;
          flex-shrink: 0;
        }
        
        .eject-button svg, .settings-button svg, .exit-button svg {
          width: 20px;
          height: 20px;
        }
        
        .eject-button:hover, .settings-button:hover, .exit-button:hover {
          background: #3d424b;
          border-color: #4dabf7;
          color: #4dabf7;
          transform: scale(1.1);
          box-shadow: 0 0 15px rgba(77, 171, 247, 0.3);
        }
        
        .recording-timer { color: #fa5252 !important; font-weight: 600; }
        .recording-dot-container { display: flex; align-items: center; justify-content: center; width: 26px; }
        .recording-dot-pulse { width: 10px; height: 10px; background: #fa5252; border-radius: 50%; animation: pulsate 1.5s ease-in-out infinite; }
        @keyframes pulsate { 
          0%, 100% { transform: scale(1); opacity: 1; } 
          50% { transform: scale(1.4); opacity: 0.6; } 
        }
        
        .custom-scrollbar {
          overflow-x: auto;
          overflow-y: auto;
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: #1a1d23;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #333;
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #444;
        }

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
        
        .loading-spinner {
          width: 40px;
          height: 40px;
          border: 4px solid #2a2d33;
          border-top-color: #4dabf7;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin: 0 auto;
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