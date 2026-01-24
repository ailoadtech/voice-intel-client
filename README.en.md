# Voice Intelligence App

A desktop application for voice recording with automatic transcription and AI-powered text enhancement.

## Overview

Voice Intelligence is a Tauri-based desktop application that transcribes voice recordings in real-time and optionally enriches them with an LLM (Large Language Model). The app uses Whisper for speech transcription and can be integrated with Ollama for AI-powered text processing.

## Key Features

- **Voice Recording**: Record audio via microphone with live timer
- **Automatic Transcription**: Convert speech to text using Whisper
- **AI Enhancement**: Optional text improvement through local LLM (Ollama)
- **Multiple Prompt Templates**: Various processing styles (improvement, summarization, etc.)
- **Recording History**: Manage all recordings with playback functionality
- **Global Shortcut**: Quick access via `Ctrl+Shift+Space`
- **Browser Mode**: Works in browser with limited features

## Technology Stack

### Frontend
- **Next.js 14** - React Framework
- **TypeScript** - Type-safe development
- **Xenova Transformers** - Browser-based ML models

### Backend (Tauri)
- **Rust** - High-performance native application
- **Whisper-rs** - Speech transcription
- **Reqwest** - HTTP client for LLM integration
- **Hound** - Audio processing
- **Tauri 2.0** - Desktop framework

## Installation

### Prerequisites

- **Node.js** (v18 or higher)
- **Rust** (latest stable version)
- **Ollama** (optional, for AI enhancement)

### Steps

1. Clone repository:
```bash
git clone https://github.com/ailoadtech/voice-intel-client.git
cd voice-intel-client
```

2. Install dependencies:
```bash
npm install
```

3. Download Whisper model:
   - The model `ggml-small.bin` is automatically downloaded on first start
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
    "model": "llama3.2:latest",
    "timeout_seconds": 60,
    "Prompt1": "Improve the following text...",
    "Prompt2": "Summarize the text...",
    "Prompt3": "Rewrite the text in the style of...",
    "Prompt4": "Bullshit Bingo..."
  }
}
```

### Configuration Options

- **enabled**: Enable/disable LLM enhancement
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

1. **Start Recording**: Click the red record button or press `Ctrl+Shift+Space`
2. **Stop Recording**: Click again or use shortcut
3. **Transcription**: Audio is automatically transcribed with Whisper
4. **Enhancement**: Optionally, text is improved by the LLM
5. **Display**: Both versions (original & AI) are available

### File Structure

Recordings are saved in the `recordings/` folder:

- `{timestamp}.rec` - Raw audio recording
- `{timestamp}.processed` - Processed audio file
- `{timestamp}.whisper.txt` - Transcription
- `{timestamp}.enriched.txt` - AI-enhanced text

## Architecture

### Rust Backend (`src-tauri/src/`)

- **main.rs**: Main entry point, event loop, Tauri commands
- **audio.rs**: Audio recording and processing
- **whisper.rs**: Whisper integration for transcription
- **llm.rs**: LLM integration (Ollama)
- **config.rs**: Configuration management

### Frontend (`app/`)

- **page.tsx**: Main UI component
- **layout.tsx**: App layout
- **worker.ts**: Web worker for browser mode

## Error Handling

The app is robust against common errors:

- **LLM unreachable**: Saves original transcription instead of crashing
- **Microphone access denied**: Shows helpful error message
- **Model not found**: Automatically downloads Whisper model

## Shortcuts

- **Ctrl+Shift+Space**: Start/stop recording (global)
- **ESC**: Abort Whisper model download

## Browser Compatibility

The app also works in the browser with limited features:
- Transcription via Xenova Transformers
- No LLM enhancement
- No persistent storage

## Development

### Project Structure

```
voice-intel-client/
├── app/                   # Next.js Frontend
├── src-tauri/             # Rust Backend
│   ├── src/               # Rust source code
│   ├── icons/             # App icons
│   └── Cargo.toml         # Rust dependencies
├── models/                # Whisper models
├── recordings/            # Recordings (created at runtime)
├── public/                # Static assets
└── config.json            # App configuration
```

### Build Scripts

- `build.sh`: Linux/Mac build script
- `src-tauri/build_windows.sh`: Windows build script
- GitHub Actions: [Build Windows EXE](https://github.com/ailoadtech/voice-intel-client/blob/main/.github/workflows/build.yml)

### Known Issues

- Icon replacement for voice-intel-app.exe 

## Credits

ailoadtech made this with Qwen3-Max Thinking, Google Antigravity and Kiro
....-/. ...- . .-. .-.. .- ... -
