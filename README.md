# Voice Intelligence App

Eine Desktop-Anwendung zur Sprachaufnahme mit automatischer Transkription und KI-gestützter Textverbesserung.

## Übersicht

Voice Intelligence ist eine Tauri-basierte Desktop-Anwendung, die Sprachaufnahmen in Echtzeit transkribiert und optional mit einem LLM (Large Language Model) anreichert. Die App nutzt Whisper für die Sprachtranskription und kann mit Ollama für die KI-gestützte Textverarbeitung integriert werden.

## Hauptfunktionen

- **Sprachaufnahme**: Aufnahme von Audio über das Mikrofon mit Live-Timer
- **Automatische Transkription**: Konvertierung von Sprache zu Text mittels Whisper
- **KI-Anreicherung**: Optionale Textverbesserung durch lokales LLM (Ollama)
- **Mehrere Prompt-Templates**: Verschiedene Verarbeitungsstile (Verbesserung, Zusammenfassung, etc.)
- **Aufnahme-Historie**: Verwaltung aller Aufnahmen mit Wiedergabe-Funktion
- **Global Shortcut**: Schnellzugriff via `Strg+Shift+Leertaste`
- **Browser-Modus**: Funktioniert auch im Browser mit eingeschränkten Features

## Technologie-Stack

### Frontend
- **Next.js 14** - React Framework
- **TypeScript** - Typsichere Entwicklung
- **Xenova Transformers** - Browser-basierte ML-Modelle

### Backend (Tauri)
- **Rust** - Performante native Anwendung
- **Whisper-rs** - Sprachtranskription
- **Reqwest** - HTTP-Client für LLM-Integration
- **Hound** - Audio-Verarbeitung
- **Tauri 2.0** - Desktop-Framework

## Installation

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
    "model": "llama3.2:latest",
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
3. **Transkription**: Audio wird automatisch mit Whisper transkribiert
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
- **llm.rs**: LLM-Integration (Ollama)
- **config.rs**: Konfigurationsverwaltung

### Frontend (`app/`)

- **page.tsx**: Haupt-UI-Komponente
- **layout.tsx**: App-Layout
- **worker.ts**: Web Worker für Browser-Modus

## Fehlerbehandlung

Die App ist robust gegen häufige Fehler:

- **LLM nicht erreichbar**: Speichert Original-Transkription statt zu crashen
- **Mikrofon-Zugriff verweigert**: Zeigt hilfreiche Fehlermeldung
- **Modell nicht gefunden**: Lädt Whisper-Modell automatisch herunter

## Shortcuts

- **Strg+Alt+Leertaste**: Aufnahme starten/stoppen (global)

## Browser-Kompatibilität

Die App funktioniert auch im Browser mit eingeschränkten Features:
- Transkription via Xenova Transformers
- Keine LLM-Anreicherung
- Keine persistente Speicherung

## Entwicklung

### Projekt-Struktur

```
voice-intel-client/
├── app/                   # Next.js Frontend
├── src-tauri/             # Rust Backend
│   ├── src/               # Rust Quellcode
│   ├── icons/             # App-Icons
│   └── Cargo.toml         # Rust Dependencies
├── models/                # Whisper-Modelle
├── recordings/            # Aufnahmen (wird erstellt)
├── public/                # Statische Assets
└── config.json            # App-Konfiguration
```

### Build-Skripte

- `build.sh`: Linux/Mac Build-Skript
- `src-tauri/build_windows.sh`: Windows Build-Skript
- GitHub Actions: [Build Windows EXE](https://github.com/ailoadtech/voice-intel-client/blob/main/.github/workflows/build.yml)

### Known Issues

- Icon replacement for voice-intel-app.exe 
- Many

### About

Ich habe eine Voice Recording Applikation für Windows gebaut.
Es nimmt die Eingaben über das Mikrofon auf und erstellt mit Hilfe eines lokalen Whisper
Modell eine Transkription. Weiterhin gibt es eine zweite Transkription die mit Hilfe eines
LLM von meinem Olama Server angereichert wird. Man kann die Prompts konfigurieren 
und in der Oberfläche auswählen.

Für die Architektur habe ich Qwen3-Max Thinking benutzt das auch den ersten Code erstellt hat.
Dann viele Änderungen mit Hilfe von Antigravity durchgeführt und danach dann Kiro (Claude) für das Bugfixing benutzt.
Leider ist das aber nicht so erfolgreich wie gedacht.

Die größten Probleme hat mir die Umgebung gemacht. Ich habe zuerst alles auf meiner AWS EC2
mit einem Dockerfile aufgebaut, was nicht die richtige Entscheidung war.
Dann habe ich alles auf meinem Windows neu aufgebaut, um zum Kompilieren.
Aber auf Grund von verschiedenen Visual Studios und Code und Windows Dependencies hat das alles nicht funktioniert.
Letzter Versuch war dann Github Action zu benutzen und nach einigen Iterationen macht es nun einen Build der 13 Minuten dauert.

Die Aufgabe ist meine erste Application rein mit KI und ich habe dabei sehr viel gelernt.

## Credits

ailoadtech made this with joy and Qwen3-Max Thinking, Google Antigravity and Kiro, Verdent Minimax, Opus, Stepfun
....-/. ...- . .-. .-.. .- ... -