# Voice Intelligence App - Architektur

## System-Übersicht

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         VOICE INTELLIGENCE APP                              │
│                         Desktop Application (Tauri)                         │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (Next.js)                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐    │
│  │   UI Components  │    │  State Management│    │  Audio Recording │    │
│  │                  │    │                  │    │                  │    │
│  │  • Record Button │    │  • useState      │    │  • MediaRecorder │    │
│  │  • History Stack │    │  • useEffect     │    │  • AudioContext  │    │
│  │  • Display Panel │    │  • useRef        │    │  • Blob Storage  │    │
│  │  • Progress Bar  │    │  • useCallback   │    │                  │    │
│  └──────────────────┘    └──────────────────┘    └──────────────────┘    │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                    Tauri IPC Communication                           │  │
│  │                    (invoke, event listeners)                         │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                    ▲                                        │
│                                    │                                        │
└────────────────────────────────────┼────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            BACKEND (Rust/Tauri)                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │                          main.rs (Core)                            │    │
│  │  • App Initialization                                              │    │
│  │  • Global Hotkey (Ctrl+Shift+Space)                                │    │
│  │  • Event Emitter                                                   │    │
│  │  • Command Handlers                                                │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  audio.rs    │  │ whisper.rs   │  │   llm.rs     │  │  config.rs   │  │
│  │              │  │              │  │              │  │              │  │
│  │ • WAV Save   │  │ • Model DL   │  │ • Ollama API │  │ • JSON Load  │  │
│  │ • Recording  │  │ • Transcribe │  │ • Enrichment │  │ • Prompts    │  │
│  │ • Playback   │  │ • Whisper.cpp│  │ • Templates  │  │ • Settings   │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          EXTERNAL DEPENDENCIES                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐    │
│  │  Whisper Model   │    │   Ollama LLM     │    │  File System     │    │
│  │                  │    │                  │    │                  │    │
│  │ • ggml-small.bin │    │ • localhost:11434│    │ • recordings/    │    │
│  │ • ~500 MB        │    │ • llama3.2       │    │ • models/        │    │
│  │ • HuggingFace    │    │ • Enrichment     │    │ • config.json    │    │
│  └──────────────────┘    └──────────────────┘    └──────────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Datenfluss

```
┌─────────────┐
│   Benutzer  │
└──────┬──────┘
       │
       │ (1) Drückt Record Button / Hotkey
       ▼
┌─────────────────────────────────────┐
│  Frontend: MediaRecorder startet   │
│  • Mikrofon-Zugriff                 │
│  • Audio-Stream aufnehmen           │
└──────────────┬──────────────────────┘
               │
               │ (2) Audio Blob (WAV, 16kHz, Mono)
               ▼
┌─────────────────────────────────────┐
│  Backend: save_and_queue_recording  │
│  • Int16 Samples speichern          │
│  • WAV-Datei erstellen              │
│  • Recording ID generieren          │
└──────────────┬──────────────────────┘
               │
               │ (3) Async Processing
               ▼
┌─────────────────────────────────────┐
│  Whisper: Transkription             │
│  • Model laden (falls nötig)        │
│  • Audio → Text konvertieren        │
│  • Event: transcription_ready       │
└──────────────┬──────────────────────┘
               │
               │ (4) Transkription Text
               ▼
┌─────────────────────────────────────┐
│  LLM: KI-Anreicherung               │
│  • Prompt Template auswählen        │
│  • Ollama API aufrufen              │
│  • Event: enriched_ready            │
└──────────────┬──────────────────────┘
               │
               │ (5) Angereicherter Text
               ▼
┌─────────────────────────────────────┐
│  Frontend: UI Update                │
│  • Recording Card aktualisieren     │
│  • Buttons aktivieren               │
│  • Display Panel anzeigen           │
└─────────────────────────────────────┘
```

## Komponenten-Details

### Frontend (app/page.tsx)

```
HomePage Component
├── State Management
│   ├── isRecording: boolean
│   ├── recordings: Recording[]
│   ├── activeResult: {text, title}
│   ├── isModelAvailable: boolean
│   ├── downloadProgress: number
│   └── selectedPrompt: string
│
├── UI Sections
│   ├── Loading Overlay (Model Download)
│   │   ├── Microphone Icon (animated)
│   │   ├── Progress Bar
│   │   └── Cancel Button
│   │
│   ├── Display Panel (Transcription/AI)
│   │   ├── Panel Title
│   │   ├── Panel Body (scrollable)
│   │   └── Close Button
│   │
│   ├── Main Content
│   │   ├── Prompt Selector Dropdown
│   │   ├── History Stack (recordings)
│   │   │   ├── Current Recording (if active)
│   │   │   └── Saved Recordings
│   │   │       ├── Play Button
│   │   │       ├── Transcription Button
│   │   │       ├── AI Button
│   │   │       ├── Refresh Button
│   │   │       └── Delete Button
│   │   │
│   │   └── Record Button (bottom)
│   │
│   └── Error Overlay
│       ├── Error Icon
│       ├── Error Message
│       └── Close Button
│
└── Event Handlers
    ├── startRecording()
    ├── stopRecording()
    ├── playRecording(id)
    ├── deleteRecording(id)
    ├── reEnrichWithPrompt(id)
    └── checkAndDownloadModel()
```

### Backend (Rust Modules)

```
src-tauri/src/
│
├── main.rs
│   ├── get_app_dir() → PathBuf
│   ├── save_and_queue_recording(samples) → String
│   ├── get_all_recordings() → Vec<Recording>
│   ├── get_recording_audio(id) → Vec<u8>
│   ├── delete_recording(id) → Result
│   ├── re_enrich_with_prompt(id, prompt) → String
│   ├── get_prompt_templates() → Vec<String>
│   └── check_model() → Result
│
├── audio.rs
│   ├── save_audio_as_wav(samples, path) → Result
│   └── WAV Header Generation
│
├── whisper.rs
│   ├── ensure_model() → Result
│   │   ├── Download from HuggingFace
│   │   ├── Progress tracking
│   │   └── Timeout handling (300s)
│   │
│   └── transcribe_audio(path) → Result<String>
│       ├── WhisperContext::new()
│       ├── Audio preprocessing
│       └── Transcription execution
│
├── llm.rs
│   ├── enrich_transcription(text, prompt) → Result<String>
│   │   ├── HTTP POST to Ollama
│   │   ├── JSON payload
│   │   └── Response parsing
│   │
│   └── Ollama API Integration
│
└── config.rs
    ├── load_config() → Config
    ├── Config struct
    │   ├── ollama_url
    │   ├── ollama_model
    │   └── prompt_templates
    │
    └── JSON parsing
```

## Technologie-Stack

```
┌─────────────────────────────────────────────────────────────────┐
│                        TECHNOLOGIEN                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Frontend:                                                      │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ • Next.js 14 (React Framework)                         │    │
│  │ • TypeScript                                           │    │
│  │ • Tauri API (@tauri-apps/api)                          │    │
│  │ • CSS-in-JS (styled-jsx)                               │    │
│  │ • Web Audio API (MediaRecorder, AudioContext)          │    │
│  └────────────────────────────────────────────────────────┘    │
│                                                                 │
│  Backend:                                                       │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ • Rust (Edition 2021)                                  │    │
│  │ • Tauri 2.0 (Desktop Framework)                        │    │
│  │ • whisper-rs 0.15.1 (Speech-to-Text)                   │    │
│  │ • reqwest 0.12 (HTTP Client)                           │    │
│  │ • tokio (Async Runtime)                                │    │
│  │ • serde/serde_json (Serialization)                     │    │
│  │ • hound 3.5 (WAV File Handling)                        │    │
│  │ • tauri-plugin-global-shortcut (Hotkeys)               │    │
│  └────────────────────────────────────────────────────────┘    │
│                                                                 │
│  External Services:                                             │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ • Whisper.cpp (ggml-small.bin)                         │    │
│  │ • Ollama (llama3.2 Model)                              │    │
│  │ • HuggingFace (Model Download)                         │    │
│  └────────────────────────────────────────────────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Verzeichnisstruktur

```
voice-intel-client/
│
├── app/                          # Next.js Frontend
│   ├── page.tsx                  # Haupt-UI-Komponente
│   ├── layout.tsx                # App Layout
│   ├── worker.ts                 # Web Worker (Browser-Modus)
│   └── package.json
│
├── src-tauri/                    # Rust Backend
│   ├── src/
│   │   ├── main.rs               # Entry Point, Commands
│   │   ├── audio.rs              # Audio-Verarbeitung
│   │   ├── whisper.rs            # Transkription
│   │   ├── llm.rs                # KI-Anreicherung
│   │   └── config.rs             # Konfiguration
│   │
│   ├── icons/                    # App Icons
│   ├── capabilities/             # Tauri Permissions
│   ├── Cargo.toml                # Rust Dependencies
│   └── tauri.conf.json           # Tauri Config
│
├── public/                       # Statische Assets
│   ├── transkription.png
│   └── transkription-ai.png
│
├── models/                       # Whisper Model (Runtime)
│   └── ggml-small.bin            # ~500 MB
│
├── recordings/                   # Audio-Aufnahmen (Runtime)
│   └── *.wav                     # 16kHz Mono WAV
│
├── config.json                   # App-Konfiguration
│   ├── ollama_url
│   ├── ollama_model
│   └── prompt_templates (1-4)
│
├── package.json                  # Node Dependencies
├── next.config.js                # Next.js Config
├── tsconfig.json                 # TypeScript Config
└── README.md                     # Dokumentation
```

## Sicherheit & Performance

```
┌─────────────────────────────────────────────────────────────────┐
│                    SICHERHEIT & OPTIMIERUNG                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Sicherheit:                                                    │
│  • CSP (Content Security Policy) aktiviert                     │
│  • Tauri Capabilities & Permissions                            │
│  • Keine externe Datenübertragung (außer Model-Download)       │
│  • Lokale Verarbeitung aller Audio-Daten                       │
│  • Mikrofon-Zugriff nur auf Anfrage                            │
│                                                                 │
│  Performance:                                                   │
│  • Async/Await für nicht-blockierende Operationen              │
│  • Lazy Loading des Whisper-Models                             │
│  • Audio-Blob-Caching im Frontend                              │
│  • Optimierte Release-Builds (LTO, Strip)                      │
│  • Event-basierte Kommunikation (keine Polling)                │
│                                                                 │
│  Ressourcen:                                                    │
│  • Whisper Model: ~500 MB Speicher                             │
│  • Audio-Dateien: ~1 MB pro Minute                             │
│  • Ollama: Externe Ressource (localhost)                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Deployment

```
Build Process:
┌─────────────────┐
│  npm run build  │  → Next.js Static Export (out/)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ tauri build     │  → Rust Compilation + Bundle
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│  release/                               │
│  ├── voice-intel-app.exe (Windows)      │
│  ├── config.json                        │
│  └── voice-intel-windows-portable.zip   │
└─────────────────────────────────────────┘

Runtime:
• Executable Directory = Base Path
• models/ wird automatisch erstellt
• recordings/ wird automatisch erstellt
• config.json muss vorhanden sein
```

