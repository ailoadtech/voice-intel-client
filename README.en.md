# Voice Intelligence App

A desktop application for voice recording with automatic transcription and AI-powered text improvement.

## Overview

Voice Intelligence is a Tauri-based desktop application that transcribes voice recordings in real-time and optionally enriches them with an LLM (Large Language Model). The app uses Whisper for speech transcription and can be integrated with Ollama for AI-powered text processing.

## Core Features

- **Live voice recording**: Record audio via microphone with live timer
- **Automatic local transcription**: Convert speech to text using Whisper
- **Optional AI enrichment**: Optional text enhancement through local LLM (Ollama, Openrouter)
- **Configurable prompt templates**: Various processing styles (improvement, summarization, style, etc.)
- **Recording history**: Manage all recordings with playback function
- **Global Shortcut**: `Ctrl+Alt+Space`
- **Browser Mode**: Browser mode with limited features

## Technology Stack

### Frontend
- **Next.js 14** - React Framework
- **TypeScript** - Type-safe development

### Backend (Tauri)
- **Rust** - High-performance native application
- **Whisper-rs** - Speech transcription
- **Reqwest** - HTTP client for LLM integration
- **Hound** - Audio processing
- **Tauri 2.0** - Desktop framework

### Prerequisites

- **Node.js** (v18 or higher)
- **Rust** (latest stable version)
- **Ollama** (optional, for AI enrichment)

### Steps

1. Clone repository:
```bash
git clone <repository-url>
cd voice-intel-client
```

2. Install dependencies:
```bash
npm install
```

3. Download Whisper model:
   - The model `ggml-small.bin` is automatically downloaded on first launch
   - Alternatively, manually place it in the `models/` folder

4. Install Ollama (optional):
```bash
# Download Ollama from https://ollama.ai
ollama pull llama3.2:latest
```

## Configuration

Configuration is done via the `config.json` file:

```json
{
  "llm": {
    "enabled": true,
    "url": "http://127.0.0.1:11434",
    "model": "llama3.2:1b",
    "timeout_seconds": 60,
    "Prompt1": "Improve the following text...",
    "Prompt2": "Summarize the text...",
    "Prompt3": "Write the text in the style of...",
    "Prompt4": "Bullshit Bingo..."
  }
}
```

### Configuration Options

- **enabled**: Enable/disable LLM enrichment
- **url**: Ollama server URL (default: localhost:11434)
- **model**: LLM model to use
- **timeout_seconds**: Timeout for LLM requests
- **Prompt1-4**: Custom prompt templates

## Usage

### Development Mode

```bash
npm run dev
```

Starts the Next.js development server on port 3000.

### Start Tauri App

```bash
npm run tauri dev
```

Starts the desktop application in development mode.

### Production Build

```bash
npm run build
npm run tauri build
```

Creates a production-ready desktop application.

## How It Works

### Recording Workflow

1. **Start recording**: Click the red record button or `Ctrl+Shift+Space`
2. **Stop recording**: Click again or use shortcut
3. **Transcription**: Audio is automatically transcribed locally with Whisper
4. **Enrichment**: Optionally, text is enhanced by the LLM
5. **Display**: Both versions (original & AI) are available

### File Structure

Recordings are stored in the `recordings/` folder:

- `{timestamp}.rec` - Raw audio recording
- `{timestamp}.processed` - Processed audio file
- `{timestamp}.whisper.txt` - Transcription
- `{timestamp}.enriched.txt` - AI-enriched text

## Architecture

### Rust Backend (`src-tauri/src/`)

- **main.rs**: Main entry point, event loop, Tauri commands
- **audio.rs**: Audio recording and processing
- **whisper.rs**: Whisper integration for transcription
- **llm.rs**: LLM integration (Ollama/Openrouter)
- **config.rs**: Configuration management
- **logger.rs**: Logging system with file and console output

### Tauri 2.0 Configuration (`src-tauri/`)

- **Cargo.toml**: Rust dependencies and build configuration
- **tauri.conf.json**: Tauri application configuration
- **build.rs**: Build script for Tauri
- **capabilities/default.json**: Capability definitions for Tauri 2.0
- **permissions/main.json**: Permissions for Tauri commands
- **gen/schemas/**: Generated Tauri schemas
- **icons/**: App icons for various platforms

### Frontend (`app/`)

- **page.tsx**: Main UI component
- **layout.tsx**: App layout
- **worker.ts**: Web worker for browser mode

## Error Handling

- **LLM unreachable**: Saves original transcription instead of crashing
- **Microphone access denied**: Shows an error message
- **Model not found**: Automatically downloads Whisper model on startup

## Shortcuts

- **Ctrl+Alt+Space**: Start/stop recording (global)

### Project Structure

```
voice-intel-client/
├── app/                       # Next.js Frontend
│   ├── layout.tsx            # App layout
│   ├── page.tsx              # Main UI component
│   └── worker.ts             # Web worker for browser mode
├── src-tauri/                # Rust Backend (Tauri 2.0)
│   ├── src/                  # Rust source code
│   │   ├── audio.rs          # Audio recording
│   │   ├── config.rs         # Configuration management
│   │   ├── llm.rs            # LLM integration
│   │   ├── logger.rs         # Logging system
│   │   ├── main.rs           # Main entry point
│   │   └── whisper.rs        # Whisper transcription
│   ├── capabilities/
│   │   └── default.json      # Tauri capability definitions
│   ├── gen/
│   │   └── schemas/          # Generated Tauri schemas
│   ├── icons/                # App icons (android/, ios/)
│   ├── permissions/
│   │   └── main.json         # Tauri permissions
│   ├── build.rs              # Build script
│   ├── Cargo.toml            # Rust dependencies
│   └── tauri.conf.json       # Tauri configuration
├── public/                   # Static assets
├── models/                   # Whisper models (created)
├── recordings/               # Recordings (created)
├── config.json               # App configuration (created)
├── package.json              # Node.js dependencies
├── next.config.js            # Next.js configuration
└── tsconfig.json             # TypeScript configuration
```

### Build Scripts
GitHub Actions: [Build Windows EXE](https://github.com/ailoadtech/voice-intel-client/blob/main/.github/workflows/build.yml)

### Project Goal
Voice Intelligence was designed as an AI-native desktop application.
Project goals:
- Local speech processing without cloud dependencies
- Combination of Rust performance and web frontend
- Integration of modern LLM systems into desktop workflows
- Reproducible Windows build pipeline

### About
I built a voice recording application for Windows.
It captures input via microphone and creates a transcription using a local Whisper model. 
Additionally, there is a second transcription, which is enriched using an LLM from an Ollama server. 
Alternatively, Openrouter with API key can be used. The prompts can be configured and selected in the UI.

For the architecture, I used Qwen3-Max Thinking, which also created the initial code.
Then many changes were made with the help of Antigravity and afterwards used Kiro.dev (Claude) for bug fixing.
But that didn't go as successfully as planned.

The biggest problems were the environment. First, I set everything up on my AWS EC2 with Docker,
which was not the right decision. Then I did everything again on my Windows to compile the .exe.
But due to different Visual Studio and VS Code versions, nothing worked with the Windows dependencies.
The last attempt was to use GitHub Actions and after several iterations it also makes a build after 10 minutes of runtime.
This task was one of my first applications purely with AI and I learned a lot.

## Credits

ailoadtech made this with joy and Qwen3-Max Thinking, Google Antigravity and Kiro, Verdent Minimax & Opus, and finally Stepfun via Openrouter
....- / -..-. / . ...- . .-. .-.. .- ... -
