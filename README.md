# Voice Intelligence App

Eine Desktop-Anwendung zur Sprachaufnahme mit automatischer Transkription und KI-gestützter Textverbesserung.

## Übersicht

Voice Intelligence ist eine Tauri-basierte Desktop-Anwendung, die Sprachaufnahmen in Echtzeit transkribiert und optional mit einem LLM (Large Language Model) anreichert. Die App nutzt Whisper für die Sprachtranskription und kann mit Ollama für die KI-gestützte Textverarbeitung integriert werden.

## Kernfunktionen

- **Live-Sprachaufnahme**: Aufnahme von Audio über das Mikrofon mit Live-Timer
- **Automatische lokale Transkription**: Konvertierung von Sprache zu Text mittels Whisper
- **Optionale KI-Anreicherung**: Optionale Textveredelung durch lokales LLM (Ollama, Openrouter)
- **Konfigurierbare Prompt-Templates**: Verschiedene Verarbeitungsstile (Verbesserung, Zusammenfassung, Stil, etc.)
- **Aufnahme-Historie**: Verwaltung aller Aufnahmen mit Wiedergabe-Funktion
- **Global Shortcut**: `Strg+Alt+Leertaste`
- **Browser-Modus**: Browser Modus mit eingeschränkten Features

## Technologie-Stack

### Frontend
- **Next.js 14** - React Framework
- **TypeScript** - Typsichere Entwicklung

### Backend (Tauri)
- **Rust** - Performante native Anwendung
- **Whisper-rs** - Sprachtranskription
- **Reqwest** - HTTP-Client für LLM-Integration
- **Hound** - Audio-Verarbeitung
- **Tauri 2.0** - Desktop-Framework

### Voraussetzungen

- **Node.js** (v18 oder höher)
- **Rust** (neueste stabile Version)
- **Ollama** (optional, für KI-Anreicherung)

### Schritte

1. Repository klonen:
```bash
git clone <repository-url>
cd voice-intel-client
```

2. Dependencies installieren:
```bash
npm install
```

3. Whisper-Modell herunterladen:
   - Das Modell `ggml-small.bin` wird automatisch beim ersten Start heruntergeladen
   - Alternativ manuell in den Ordner `models/` legen

4. Ollama installieren (optional):
```bash
# Ollama von https://ollama.ai herunterladen
ollama pull llama3.2:latest
```

## Konfiguration

Die Konfiguration erfolgt über die Datei `config.json`:

```json
{
  "llm": {
    "enabled": true,
    "url": "http://127.0.0.1:11434",
    "model": "llama3.2:1b",
    "timeout_seconds": 60,
    "Prompt1": "Verbessere folgenden Text...",
    "Prompt2": "Fasse den Text zusammen...",
    "Prompt3": "Schreibe den Text im Stil von...",
    "Prompt4": "Bullshit Bingo..."
  }
}
```

### Konfigurationsoptionen

- **enabled**: LLM-Anreicherung aktivieren/deaktivieren
- **url**: Ollama-Server-URL (Standard: localhost:11434)
- **model**: Zu verwendendes LLM-Modell
- **timeout_seconds**: Timeout für LLM-Anfragen
- **Prompt1-4**: Benutzerdefinierte Prompt-Templates

## Verwendung

### Entwicklungsmodus

```bash
npm run dev
```

Startet den Next.js-Entwicklungsserver auf Port 3000.

### Tauri-App starten

```bash
npm run tauri dev
```

Startet die Desktop-Anwendung im Entwicklungsmodus.

### Produktions-Build

```bash
npm run build
npm run tauri build
```

Erstellt eine produktionsreife Desktop-Anwendung.

## Funktionsweise

### Aufnahme-Workflow

1. **Aufnahme starten**: Klick auf den roten Aufnahme-Button oder `Strg+Shift+Leertaste`
2. **Aufnahme stoppen**: Erneuter Klick oder Shortcut
3. **Transkription**: Audio wird automatisch mit Whisper lokal transkribiert
4. **Anreicherung**: Optional wird der Text durch das LLM verbessert
5. **Anzeige**: Beide Versionen (Original & KI) sind verfügbar

### Dateistruktur

Aufnahmen werden im Ordner `recordings/` gespeichert:

- `{timestamp}.rec` - Rohe Audioaufnahme
- `{timestamp}.processed` - Verarbeitete Audiodatei
- `{timestamp}.whisper.txt` - Transkription
- `{timestamp}.enriched.txt` - KI-angereicherter Text

## Architektur

### Rust Backend (`src-tauri/src/`)

- **main.rs**: Haupteinstiegspunkt, Event-Loop, Tauri-Commands
- **audio.rs**: Audio-Aufnahme und -Verarbeitung
- **whisper.rs**: Whisper-Integration für Transkription
- **llm.rs**: LLM-Integration (Ollama/Openrouter)
- **config.rs**: Konfigurationsverwaltung
- **logger.rs**: Logging-System mit Datei- und Konsolenausgabe

### Tauri 2.0 Konfiguration (`src-tauri/`)

- **Cargo.toml**: Rust-Dependencies und Build-Konfiguration
- **tauri.conf.json**: Tauri-Anwendungskonfiguration
- **build.rs**: Build-Skript für Tauri
- **capabilities/default.json**: Capability-Definitionen für Tauri 2.0
- **permissions/main.json**: Berechtigungen für Tauri-Commands
- **gen/schemas/**: Generierte Tauri-Schemas
- **icons/**: App-Icons für verschiedene Plattformen

### Frontend (`app/`)

- **page.tsx**: Haupt-UI-Komponente
- **layout.tsx**: App-Layout
- **worker.ts**: Web Worker für Browser-Modus

## Fehlerbehandlung

- **LLM nicht erreichbar**: Speichert Original-Transkription statt zu crashen
- **Mikrofon-Zugriff verweigert**: Zeigt eine Fehlermeldung
- **Modell nicht gefunden**: Lädt Whisper-Modell beim Start automatisch nach

## Shortcuts

- **Strg+Alt+Leertaste**: Aufnahme starten/stoppen (global)

### Projekt-Struktur

```
voice-intel-client/
├── app/                       # Next.js Frontend
│   ├── layout.tsx            # App-Layout
│   ├── page.tsx              # Haupt-UI-Komponente
│   └── worker.ts             # Web Worker für Browser-Modus
├── src-tauri/                # Rust Backend (Tauri 2.0)
│   ├── src/                  # Rust Quellcode
│   │   ├── audio.rs          # Audio-Aufnahme
│   │   ├── config.rs         # Konfigurationsverwaltung
│   │   ├── llm.rs            # LLM-Integration
│   │   ├── logger.rs         # Logging-System
│   │   ├── main.rs           # Haupteinstiegspunkt
│   │   └── whisper.rs        # Whisper-Transkription
│   ├── capabilities/
│   │   └── default.json      # Tauri Capability-Definitionen
│   ├── gen/
│   │   └── schemas/          # Generierte Tauri-Schemas
│   ├── icons/                # App-Icons (android/, ios/)
│   ├── permissions/
│   │   └── main.json         # Tauri-Berechtigungen
│   ├── build.rs              # Build-Skript
│   ├── Cargo.toml            # Rust Dependencies
│   └── tauri.conf.json       # Tauri-Konfiguration
├── public/                   # Statische Assets
├── models/                   # Whisper-Modelle (wird erstellt)
├── recordings/               # Aufnahmen (wird erstellt)
├── config.json               # App-Konfiguration (wird erstellt)
├── package.json              # Node.js Dependencies
├── next.config.js            # Next.js Konfiguration
└── tsconfig.json             # TypeScript Konfiguration
```

### Build-Skripte
GitHub Actions: [Build Windows EXE](https://github.com/ailoadtech/voice-intel-client/blob/main/.github/workflows/build.yml)

### Projektziel
Voice Intelligence wurde als AI-native Desktop-Anwendung konzipiert.
Ziele des Projekts:
Lokale Sprachverarbeitung ohne Cloud-Abhängigkeit
Kombination aus Rust-Performance und Web-Frontend
Integration moderner LLM-Systeme in Desktop-Workflows
Reproduzierbare Windows-Build-Pipeline

### About
Ich habe eine Voice Recording Applikation für Windows gebaut.
Es nimmt die Eingaben über das Mikrofon auf und erstellt mit Hilfe eines lokalen Whisper
Modells eine Transkription. Weiterhin gibt es eine zweite Transkription,
die mit Hilfe eines LLM von einem Olama Server angereichert wird. Alternativ kann Openrouter mit API Key benutzt werden.
Man kann die Prompts konfigurieren und in der Oberfläche auswählen.

Für die Architektur habe ich Qwen3-Max Thinking benutzt, das auch den ersten Code erstellt hat.
Dann viele Änderungen mit Hilfe von Antigravity durchgeführt und danach mit Kiro.dev (Claude) für das Bugfixing benutzt.
Das ist aber nicht so erfolgreich verlaufen wie gedacht.

Die größten Probleme hat mir die Umgebung gemacht. Zuerst habe ich alles auf meiner AWS EC2 mit Docker aufgebaut,
was nicht die richtige Entscheidung war. Dann alles nochmal auf meinem Windows, um das .exe zum compilieren.
Aber auf Grund von verschiedenen Visual Studio und VS Code Versionen hat es mit den Windows Dependencies alles nicht funktioniert.
Letzter Versuch war dann noch Github Actions zu benutzen und nach einigen Iterationen macht es auch einen Build nach 10 Minuten Laufzeit.
Diese Aufgabe war eine meiner ersten Applikationen rein mit KI und ich habe sehr viel dazugelernt.

## Credits

ailoadtech made this with joy and Qwen3-Max Thinking, Google Antigravity and Kiro, Verdent Minimax & Opus, and finally Stepfun via Openrouter
....- / -..-. / . ...- . .-. .-.. .- ... -