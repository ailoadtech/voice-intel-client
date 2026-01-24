// src-tauri/src/whisper.rs
use std::fs;
use std::path::PathBuf;
use whisper_rs::{WhisperContext, WhisperContextParameters, FullParams, SamplingStrategy};

pub const MODEL_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin";

// Get the base directory for app data
pub fn get_app_dir() -> PathBuf {
    // Always use executable directory for portable app
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            println!("Using executable directory: {:?}", exe_dir);
            return exe_dir.to_path_buf();
        }
    }
    
    // Fallback to current directory
    println!("WARNING: Could not determine executable directory, using current directory");
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

// Get the model path
pub fn get_model_path() -> PathBuf {
    get_app_dir().join("models").join("ggml-small.bin")
}

// Stellt sicher, dass das Whisper-Modell heruntergeladen und im lokalen Verzeichnis verfügbar ist.
pub fn ensure_model() -> Result<(), String> {
    use crate::logger::Logger;
    
    let model_path = get_model_path();
    
    Logger::log("=== MODEL CHECK START ===");
    Logger::log(&format!("Model path: {:?}", model_path));
    Logger::log(&format!("Model exists: {}", model_path.exists()));
    
    if model_path.exists() {
        Logger::log_model_exists(&model_path);
        Logger::log("=== MODEL CHECK END (already exists) ===");
        return Ok(());
    }
    
    Logger::log("Model not found, will download...");
    
    if let Some(parent) = model_path.parent() {
        Logger::log(&format!("Creating models directory: {:?}", parent));
        match fs::create_dir_all(parent) {
            Ok(_) => Logger::log("Models directory created successfully"),
            Err(e) => {
                let err_msg = format!("Failed to create models directory: {}", e);
                Logger::log_error("ensure_model", &err_msg);
                return Err(err_msg);
            }
        }
    }
    
    Logger::log_model_download_start();
    Logger::log(&format!("Saving to: {:?}", model_path));
    
    Logger::log("Building HTTP client...");
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| {
            let err_msg = format!("Failed to build HTTP client: {}", e);
            Logger::log_error("HTTP client", &err_msg);
            err_msg
        })?;
    
    Logger::log("Sending HTTP GET request...");
    let response = client.get(MODEL_URL).send().map_err(|e| {
        let err_msg = format!("Failed to send HTTP request: {}", e);
        Logger::log_error("HTTP request", &err_msg);
        err_msg
    })?;
    
    Logger::log(&format!("Response status: {}", response.status()));
    
    if !response.status().is_success() {
        let err_msg = format!("Download failed with status: {}", response.status());
        Logger::log_error("HTTP response", &err_msg);
        return Err(err_msg);
    }
    
    Logger::log("Reading response bytes...");
    let bytes = response.bytes().map_err(|e| {
        let err_msg = format!("Failed to read response bytes: {}", e);
        Logger::log_error("Response bytes", &err_msg);
        err_msg
    })?;
    
    Logger::log_model_download_progress(bytes.len());
    
    Logger::log(&format!("Writing to file: {:?}", model_path));
    fs::write(&model_path, bytes).map_err(|e| {
        let err_msg = format!("Failed to write model file: {}", e);
        Logger::log_error("File write", &err_msg);
        err_msg
    })?;
    
    Logger::log(&format!("Model saved successfully to: {:?}", model_path));
    
    // Verify file was written
    if model_path.exists() {
        let metadata = fs::metadata(&model_path).map_err(|e| {
            let err_msg = format!("Failed to read file metadata: {}", e);
            Logger::log_error("File metadata", &err_msg);
            err_msg
        })?;
        Logger::log_model_download_complete(&model_path, metadata.len());
    } else {
        let err_msg = "File was not created!";
        Logger::log_error("File verification", err_msg);
        return Err(err_msg.to_string());
    }
    
    Logger::log("=== MODEL CHECK END (download complete) ===");
    
    Ok(())
}

// Öffentliche Funktion zur Transkription einer Audiodatei basierend auf einem Zeitstempel.
pub fn transcribe_file(timestamp: &str) -> Result<String, String> {
    use crate::logger::Logger;
    
    Logger::log(&format!("TRANSCRIPTION: Starting transcription for file: {}", timestamp));
    
    match inner_transcribe(timestamp) {
        Ok(text) => {
            Logger::log(&format!("TRANSCRIPTION: Success for {} - {} characters", timestamp, text.len()));
            Ok(text)
        }
        Err(e) => {
            Logger::log_error(&format!("TRANSCRIPTION for {}", timestamp), &e);
            Err(e.to_string())
        }
    }
}

// Entfernt Halluzinationen aus dem Text
fn remove_hallucinations(text: &str) -> String {
    let mut cleaned = text.to_string();
    
    // Entferne Klammer-Inhalte wie "(Sie lacht.)", "(Musik)", etc.
    while let Some(start) = cleaned.find('(') {
        if let Some(end) = cleaned[start..].find(')') {
            cleaned.replace_range(start..start + end + 1, "");
        } else {
            break;
        }
    }
    
    // Entferne eckige Klammern wie "[Musik]", "[Applaus]", etc.
    while let Some(start) = cleaned.find('[') {
        if let Some(end) = cleaned[start..].find(']') {
            cleaned.replace_range(start..start + end + 1, "");
        } else {
            break;
        }
    }
    
    // Entferne Sternchen-Inhalte wie "* Musik *"
    while let Some(start) = cleaned.find('*') {
        if let Some(end) = cleaned[start + 1..].find('*') {
            cleaned.replace_range(start..start + end + 2, "");
        } else {
            break;
        }
    }
    
    // Entferne mehrfache Leerzeichen
    while cleaned.contains("  ") {
        cleaned = cleaned.replace("  ", " ");
    }
    
    cleaned.trim().to_string()
}

// Filtert Whisper-Halluzinationen und ungültige Transkriptionen
fn is_valid_transcription(text: &str) -> bool {
    let text_lower = text.to_lowercase();
    let text_lower = text_lower.trim();
    
    // Leere oder sehr kurze Texte
    if text_lower.is_empty() || text_lower.len() < 3 {
        return false;
    }
    
    // Bekannte Whisper-Halluzinationen (komplette Texte)
    let hallucinations = [
        "musik",
        "music",
        "untertitel",
        "subtitle",
        "danke",
        "thank you",
        "thanks for watching",
        "applaus",
        "applause",
        "beifall",
        "copyright",
        "www.",
        "http",
    ];
    
    // Prüfe auf Halluzinationen
    for hallucination in &hallucinations {
        if text_lower == *hallucination || text_lower.contains(&format!("* {} *", hallucination)) {
            return false;
        }
    }
    
    // Prüfe auf Muster wie "* Text *" oder "(Text)" als ganzer Text
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
fn inner_transcribe(timestamp: &str) -> Result<String, String> {
    ensure_model()?;
    let app_dir = get_app_dir();
    let rec_path = app_dir.join("recordings").join(format!("{}.rec", timestamp));
    let out_path = app_dir.join("recordings").join(format!("{}.whisper.txt", timestamp));

    let model_path = get_model_path();
    let params = WhisperContextParameters::default();
    let ctx = WhisperContext::new_with_params(model_path.to_str().unwrap(), params)
        .map_err(|e| e.to_string())?;
    let mut state = ctx.create_state().map_err(|e| e.to_string())?;

    let mut reader = hound::WavReader::open(&rec_path).map_err(|e| e.to_string())?;
    let spec = reader.spec();
    if spec.sample_rate != 16_000 || spec.channels != 1 {
        return Err("Audio must be 16kHz mono".to_string());
    }
    let samples_i16: Vec<i16> = reader.samples().collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;
    let samples_f32: Vec<f32> = samples_i16.iter().map(|s| *s as f32 / 32768.0).collect();

    let strategy = SamplingStrategy::Greedy { best_of: 1 };
    let mut params = FullParams::new(strategy);
    params.set_language(Some("de"));
    params.set_print_progress(false);
    params.set_print_realtime(false);

    state.full(params, &samples_f32).map_err(|e| e.to_string())?;

    let mut text = String::new();
    let num_segments = state.full_n_segments();
    for i in 0..num_segments {
        if let Some(segment) = state.get_segment(i) {
            if let Ok(segment_text) = segment.to_str() {
                let cleaned = remove_hallucinations(segment_text);
                // Nur gültige Segmente hinzufügen
                if is_valid_transcription(&cleaned) {
                    text.push_str(&cleaned);
                    text.push(' ');
                }
            }
        }
    }
    let transcript = text.trim().to_string();
    
    // Wenn nach dem Filtern kein Text übrig ist, gebe einen Fehler zurück
    if transcript.is_empty() || !is_valid_transcription(&transcript) {
        return Err("Keine gültige Transkription erkannt (möglicherweise nur Hintergrundgeräusche)".to_string());
    }

    fs::write(&out_path, &transcript).map_err(|e| e.to_string())?;
    Ok(transcript)
}