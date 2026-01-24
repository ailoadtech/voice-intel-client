// src-tauri/src/whisper.rs
use std::fs;
use std::path::PathBuf;
use whisper_rs::{WhisperContext, WhisperContextParameters, FullParams, SamplingStrategy};

const MODEL_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin";

// Get the base directory for app data
pub fn get_app_dir() -> PathBuf {
    // In development, use current directory
    // In production, use executable directory
    if cfg!(debug_assertions) {
        // Development mode - use current working directory
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    } else {
        // Production mode - use executable directory
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                return exe_dir.to_path_buf();
            }
        }
        PathBuf::from(".")
    }
}

// Get the model path
pub fn get_model_path() -> PathBuf {
    get_app_dir().join("models").join("ggml-small.bin")
}

// Stellt sicher, dass das Whisper-Modell heruntergeladen und im lokalen Verzeichnis verfügbar ist.
pub fn ensure_model() -> Result<(), Box<dyn std::error::Error>> {
    let model_path = get_model_path();
    
    if model_path.exists() {
        println!("Whisper model already exists at: {:?}", model_path);
        return Ok(());
    }
    
    if let Some(parent) = model_path.parent() {
        fs::create_dir_all(parent)?;
        println!("Created models directory at: {:?}", parent);
    }
    
    println!("Downloading Whisper small model from: {}", MODEL_URL);
    println!("Saving to: {:?}", model_path);
    
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()?;
    
    let response = client.get(MODEL_URL).send()?;
    
    if !response.status().is_success() {
        return Err(format!("Download failed with status: {}", response.status()).into());
    }
    
    let bytes = response.bytes()?;
    println!("Downloaded {} bytes", bytes.len());
    
    fs::write(&model_path, bytes)?;
    println!("Model saved successfully to: {:?}", model_path);
    
    Ok(())
}

// Öffentliche Funktion zur Transkription einer Audiodatei basierend auf einem Zeitstempel.
pub fn transcribe_file(timestamp: &str) -> Result<String, String> {
    inner_transcribe(timestamp).map_err(|e| e.to_string())
}

// Filtert Whisper-Halluzinationen und ungültige Transkriptionen
fn is_valid_transcription(text: &str) -> bool {
    let text_lower = text.to_lowercase().trim();
    
    // Leere oder sehr kurze Texte
    if text_lower.is_empty() || text_lower.len() < 3 {
        return false;
    }
    
    // Bekannte Whisper-Halluzinationen
    let hallucinations = [
        "musik",
        "music",
        "untertitel",
        "subtitle",
        "danke",
        "thank you",
        "thanks for watching",
        "sie lacht",
        "sie ist auf die beine",
        "sie hinsichtlich der beine",
        "lacht",
        "applaus",
        "applause",
        "beifall",
        "copyright",
        "www.",
        "http",
    ];
    
    // Prüfe auf Halluzinationen
    for hallucination in &hallucinations {
        if text_lower.contains(hallucination) {
            return false;
        }
    }
    
    // Prüfe auf Muster wie "* Text *" oder "(Text)"
    let trimmed = text.trim();
    if (trimmed.starts_with('*') && trimmed.ends_with('*')) ||
       (trimmed.starts_with('(') && trimmed.ends_with(')')) ||
       (trimmed.starts_with('[') && trimmed.ends_with(']')) {
        return false;
    }
    
    // Prüfe ob der Text nur aus Sonderzeichen besteht
    let has_letters = text.chars().any(|c| c.is_alphabetic());
    if !has_letters {
        return false;
    }
    
    true
}

// Interne Logik zur Verarbeitung der Audiodatei mit dem Whisper-Modell.
fn inner_transcribe(timestamp: &str) -> Result<String, Box<dyn std::error::Error>> {
    ensure_model()?;
    let app_dir = get_app_dir();
    let rec_path = app_dir.join("recordings").join(format!("{}.rec", timestamp));
    let out_path = app_dir.join("recordings").join(format!("{}.whisper.txt", timestamp));

    let model_path = get_model_path();
    let params = WhisperContextParameters::default();
    let ctx = WhisperContext::new_with_params(model_path.to_str().unwrap(), params)?;
    let mut state = ctx.create_state()?;

    let mut reader = hound::WavReader::open(&rec_path)?;
    let spec = reader.spec();
    if spec.sample_rate != 16_000 || spec.channels != 1 {
        return Err("Audio must be 16kHz mono".into());
    }
    let samples_i16: Vec<i16> = reader.samples().collect::<Result<_, _>>()?;
    let samples_f32: Vec<f32> = samples_i16.iter().map(|s| *s as f32 / 32768.0).collect();

    let strategy = SamplingStrategy::Greedy { best_of: 1 };
    let mut params = FullParams::new(strategy);
    params.set_language(Some("de"));
    params.set_print_progress(false);
    params.set_print_realtime(false);

    state.full(params, &samples_f32)?;

    let mut text = String::new();
    let num_segments = state.full_n_segments();
    for i in 0..num_segments {
        if let Some(segment) = state.get_segment(i) {
            if let Ok(segment_text) = segment.to_str() {
                let cleaned = segment_text.trim();
                // Nur gültige Segmente hinzufügen
                if is_valid_transcription(cleaned) {
                    text.push_str(cleaned);
                    text.push(' ');
                }
            }
        }
    }
    let transcript = text.trim().to_string();
    
    // Wenn nach dem Filtern kein Text übrig ist, gebe einen Fehler zurück
    if transcript.is_empty() || !is_valid_transcription(&transcript) {
        return Err("Keine gültige Transkription erkannt (möglicherweise nur Hintergrundgeräusche)".into());
    }

    fs::write(&out_path, &transcript)?;
    Ok(transcript)
}