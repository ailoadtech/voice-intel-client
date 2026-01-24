// src-tauri/src/whisper.rs
use std::fs;
use std::path::PathBuf;
use std::io::Write;
use whisper_rs::{WhisperContext, WhisperContextParameters, FullParams, SamplingStrategy};

const MODEL_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin";

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
    let model_path = get_model_path();
    let app_dir = get_app_dir();
    let log_path = app_dir.join("model_download.log");
    
    // Helper function to log to file
    let mut log_file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .ok();
    
    let log = |msg: &str| {
        println!("{}", msg);
        if let Some(ref mut file) = log_file {
            use std::io::Write;
            let _ = writeln!(file, "[{}] {}", chrono::Local::now().format("%Y-%m-%d %H:%M:%S"), msg);
        }
    };
    
    log("=== MODEL CHECK START ===");
    log(&format!("Model path: {:?}", model_path));
    log(&format!("Model exists: {}", model_path.exists()));
    
    if model_path.exists() {
        log(&format!("Whisper model already exists at: {:?}", model_path));
        log("=== MODEL CHECK END (already exists) ===");
        return Ok(());
    }
    
    log("Model not found, will download...");
    
    if let Some(parent) = model_path.parent() {
        log(&format!("Creating models directory: {:?}", parent));
        match fs::create_dir_all(parent) {
            Ok(_) => log("Models directory created successfully"),
            Err(e) => {
                let err_msg = format!("Failed to create models directory: {}", e);
                log(&err_msg);
                return Err(err_msg);
            }
        }
    }
    
    log(&format!("Downloading Whisper small model from: {}", MODEL_URL));
    log(&format!("Saving to: {:?}", model_path));
    
    log("Building HTTP client...");
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| {
            let err_msg = format!("Failed to build HTTP client: {}", e);
            log(&err_msg);
            err_msg
        })?;
    
    log("Sending HTTP GET request...");
    let response = client.get(MODEL_URL).send().map_err(|e| {
        let err_msg = format!("Failed to send HTTP request: {}", e);
        log(&err_msg);
        err_msg
    })?;
    
    log(&format!("Response status: {}", response.status()));
    
    if !response.status().is_success() {
        let err_msg = format!("Download failed with status: {}", response.status());
        log(&err_msg);
        return Err(err_msg);
    }
    
    log("Reading response bytes...");
    let bytes = response.bytes().map_err(|e| {
        let err_msg = format!("Failed to read response bytes: {}", e);
        log(&err_msg);
        err_msg
    })?;
    log(&format!("Downloaded {} bytes ({:.2} MB)", bytes.len(), bytes.len() as f64 / 1024.0 / 1024.0));
    
    log(&format!("Writing to file: {:?}", model_path));
    fs::write(&model_path, bytes).map_err(|e| {
        let err_msg = format!("Failed to write model file: {}", e);
        log(&err_msg);
        err_msg
    })?;
    
    log(&format!("Model saved successfully to: {:?}", model_path));
    
    // Verify file was written
    if model_path.exists() {
        let metadata = fs::metadata(&model_path).map_err(|e| e.to_string())?;
        log(&format!("File verified - size: {} bytes ({:.2} MB)", metadata.len(), metadata.len() as f64 / 1024.0 / 1024.0));
    } else {
        let err_msg = "File was not created!";
        log(err_msg);
        return Err(err_msg.to_string());
    }
    
    log("=== MODEL CHECK END (download complete) ===");
    
    Ok(())
}

// Öffentliche Funktion zur Transkription einer Audiodatei basierend auf einem Zeitstempel.
pub fn transcribe_file(timestamp: &str) -> Result<String, String> {
    inner_transcribe(timestamp).map_err(|e| e.to_string())
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