// Enable console window temporarily for debugging
// #![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio;
mod whisper;
mod llm;
mod config;
mod logger;

use serde::Serialize;
use tauri::{Manager, async_runtime, Emitter};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, Modifiers, Code, ShortcutState};
use std::time::Duration;
use std::path::Path;
use crate::logger::get_app_dir;

#[derive(Clone, Serialize)]
struct ProcessPayload {
    id: String,
    text: String,
}

#[derive(Clone, Serialize)]
struct Recording {
    id: String,
    date: String,
    time: String,
    duration: i32,
    transcription: Option<String>,
    enrichment: Option<String>,
    status: String,
}

// Speichert Audiodaten in eine Datei und reiht sie in die Warteschlange ein.
#[tauri::command]
async fn save_and_queue_recording(samples: Vec<i16>) -> Result<String, String> {
    logger::Logger::log(&format!("save_and_queue_recording called with {} samples", samples.len()));
    
    if samples.is_empty() {
        logger::Logger::log_error("save_and_queue_recording", "No samples provided");
        return Err("No audio samples provided".to_string());
    }
    
    logger::Logger::log("Calling audio::save_recording...");
    match audio::save_recording(&samples) {
        Ok(id) => {
            logger::Logger::log(&format!("Recording saved successfully with ID: {}", id));
            Ok(id)
        }
        Err(e) => {
            logger::Logger::log_error("save_and_queue_recording", &e.to_string());
            eprintln!("Failed to save recording: {}", e);
            Err(e.to_string())
        }
    }
}

// Log frontend messages to the Rust log file
#[tauri::command]
async fn log_frontend(message: String) -> Result<(), String> {
    logger::Logger::log(&format!("[FRONTEND] {}", message));
    Ok(())
}

#[tauri::command]
async fn get_recording_audio(id: String) -> Result<Vec<u8>, String> {
    println!("=== GET_RECORDING_AUDIO START ===");
    println!("Requested recording ID: {}", id);
    
    let app_dir = get_app_dir();
    println!("App directory: {:?}", app_dir);
    
    let recordings_dir = app_dir.join("recordings");
    println!("Recordings directory: {:?}", recordings_dir);
    
    let processed_path = recordings_dir.join(format!("{}.processed", id));
    let rec_path = recordings_dir.join(format!("{}.rec", id));
    
    println!("Checking for processed file: {:?}", processed_path);
    println!("  Exists: {}", processed_path.exists());
    
    println!("Checking for rec file: {:?}", rec_path);
    println!("  Exists: {}", rec_path.exists());

    let path = if processed_path.exists() {
        println!("Using processed file: {:?}", processed_path);
        processed_path
    } else if rec_path.exists() {
        println!("Using rec file: {:?}", rec_path);
        rec_path
    } else {
        println!("✗ ERROR: Recording not found!");
        println!("  Searched for ID: {}", id);
        println!("  In directory: {:?}", recordings_dir);
        
        // List all files in recordings directory for debugging
        if let Ok(entries) = std::fs::read_dir(&recordings_dir) {
            println!("  Files in recordings directory:");
            for entry in entries.filter_map(|e| e.ok()) {
                println!("    - {:?}", entry.file_name());
            }
        }
        
        return Err(format!("Recording not found: {}", id));
    };

    println!("Reading file: {:?}", path);
    match tokio::fs::read(&path).await {
        Ok(data) => {
            println!("✓ Successfully read {} bytes from file", data.len());
            println!("=== GET_RECORDING_AUDIO END ===");
            Ok(data)
        }
        Err(e) => {
            println!("✗ ERROR reading file: {}", e);
            println!("=== GET_RECORDING_AUDIO END ===");
            Err(e.to_string())
        }
    }
}

#[tauri::command]
async fn delete_recording(id: String) -> Result<(), String> {
    let app_dir = get_app_dir();
    let extensions = ["rec", "processed", "whisper.txt", "enriched.txt"];
    for ext in extensions {
        let path = app_dir.join("recordings").join(format!("{}.{}", id, ext));
        if path.exists() {
            let _ = std::fs::remove_file(path);
        }
    }
    Ok(())
}

#[tauri::command]
async fn check_model() -> Result<bool, String> {
    logger::Logger::log("check_model command called");
    
    // Run blocking operation in a blocking thread
    let result = tokio::task::spawn_blocking(|| {
        logger::Logger::log("Starting model check/download in blocking thread");
        whisper::ensure_model()
    }).await;
    
    match result {
        Ok(Ok(())) => {
            logger::Logger::log("Model check/download completed successfully");
            Ok(true)
        }
        Ok(Err(e)) => {
            logger::Logger::log_error("check_model", &e);
            Err(e)
        }
        Err(e) => {
            let err_msg = format!("Task error: {}", e);
            logger::Logger::log_error("check_model task join", &err_msg);
            Err(err_msg)
        }
    }
}

#[tauri::command]
async fn get_prompt_templates() -> Result<Vec<String>, String> {
    let config = config::AppConfig::load_or_create()?;
    let templates = config.llm.get_prompt_templates();
    let mut names: Vec<String> = templates.keys().cloned().collect();
    names.sort();
    Ok(names)
}

#[tauri::command]
async fn re_enrich_with_prompt(id: String, prompt_name: String) -> Result<String, String> {
    let app_dir = get_app_dir();
    let whisper_path = app_dir.join("recordings").join(format!("{}.whisper.txt", id));
    let transcript = tokio::fs::read_to_string(&whisper_path).await
        .map_err(|e| format!("Failed to read transcription: {}", e))?;
    
    let config = config::AppConfig::load_or_create()?;
    let enriched = llm::enrich_and_save(&transcript, &id, &config.llm, Some(&prompt_name)).await?;
    Ok(enriched)
}

#[tauri::command]
async fn get_all_recordings() -> Result<Vec<Recording>, String> {
    let mut recordings = Vec::new();
    let app_dir = get_app_dir();
    let recordings_dir = app_dir.join("recordings");
    
    // Ensure recordings directory exists
    if !recordings_dir.exists() {
        std::fs::create_dir_all(&recordings_dir).map_err(|e| e.to_string())?;
        return Ok(recordings);
    }
    
    if let Ok(entries) = std::fs::read_dir(&recordings_dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            
            // Look for .rec or .processed files
            if let Some(ext) = path.extension() {
                if ext == "rec" || ext == "processed" {
                    if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                        let id = stem.to_string();
                        
                        // Read transcription if exists
                        let whisper_path = recordings_dir.join(format!("{}.whisper.txt", id));
                        let transcription = std::fs::read_to_string(&whisper_path).ok();
                        
                        // Read enrichment if exists
                        let enriched_path = recordings_dir.join(format!("{}.enriched.txt", id));
                        let enrichment = std::fs::read_to_string(&enriched_path).ok();
                        
                        // Determine status
                        let status = if enrichment.is_some() {
                            "completed"
                        } else if transcription.is_some() {
                            "enriching"
                        } else if ext == "rec" {
                            "transcribing"
                        } else if ext == "processed" && transcription.is_none() {
                            "transcribing"
                        } else {
                            "idle"
                        };
                        
                        // Get audio duration
                        let duration = get_audio_duration(&path).unwrap_or(0);
                        
                        // Convert timestamp to date/time
                        let timestamp: u64 = id.parse().unwrap_or(0);
                        let datetime = chrono::DateTime::from_timestamp(timestamp as i64, 0)
                            .unwrap_or_else(|| chrono::Utc::now());
                        let date = datetime.format("%d.%m.%Y").to_string();
                        let time = datetime.format("%H:%M h").to_string();
                        
                        recordings.push(Recording {
                            id,
                            date,
                            time,
                            duration,
                            transcription,
                            enrichment,
                            status: status.to_string(),
                        });
                    }
                }
            }
        }
    }
    
    Ok(recordings)
}

fn get_audio_duration(path: &Path) -> Result<i32, Box<dyn std::error::Error>> {
    let reader = hound::WavReader::open(path)?;
    let spec = reader.spec();
    let duration = reader.duration() as f32 / spec.sample_rate as f32;
    Ok(duration.round() as i32)
}

// Einstiegspunkt der Anwendung: Initialisiert Plugins, Shortcuts und den Hintergrund-Worker.
fn main() {
    // Initialize logger first
    logger::Logger::init();
    logger::Logger::log("Initializing Tauri application");
    
    let ctrl_shift_space = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space);
    let ctrl_shift_space_clone = ctrl_shift_space.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new()
            .with_handler(move |app, shortcut, event| {
                if shortcut == &ctrl_shift_space_clone && event.state() == ShortcutState::Pressed {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.emit("hotkey-triggered", ());
                    }
                }
            })
            .build())
        .setup(move |app| {
            logger::Logger::log("Running setup function");
            
            // Create necessary directories at startup
            let app_dir = get_app_dir();
            logger::Logger::log(&format!("App directory: {:?}", app_dir));
            
            let models_dir = app_dir.join("models");
            let recordings_dir = app_dir.join("recordings");
            
            // Create models directory
            if !models_dir.exists() {
                logger::Logger::log(&format!("Creating models directory: {:?}", models_dir));
                if let Err(e) = std::fs::create_dir_all(&models_dir) {
                    let err_msg = format!("Failed to create models directory: {}", e);
                    logger::Logger::log_error("setup", &err_msg);
                    eprintln!("{}", err_msg);
                } else {
                    logger::Logger::log(&format!("Created models directory at: {:?}", models_dir));
                }
            } else {
                logger::Logger::log(&format!("Models directory already exists at: {:?}", models_dir));
            }
            
            // Create recordings directory
            if !recordings_dir.exists() {
                logger::Logger::log(&format!("Creating recordings directory: {:?}", recordings_dir));
                if let Err(e) = std::fs::create_dir_all(&recordings_dir) {
                    let err_msg = format!("Failed to create recordings directory: {}", e);
                    logger::Logger::log_error("setup", &err_msg);
                    eprintln!("{}", err_msg);
                } else {
                    logger::Logger::log(&format!("Created recordings directory at: {:?}", recordings_dir));
                }
            } else {
                logger::Logger::log(&format!("Recordings directory already exists at: {:?}", recordings_dir));
            }
            
            logger::Logger::log("Registering global shortcut");
            app.global_shortcut().register(ctrl_shift_space)?;

            let app_handle = app.handle().clone();
            
            // Check if model exists first, only show splash if downloading
            logger::Logger::log("Checking if model exists...");
            let model_path = whisper::get_model_path();
            let model_exists = model_path.exists();
            logger::Logger::log(&format!("Model exists: {}", model_exists));
            
            if !model_exists {
                // Model doesn't exist, emit event to show splash screen
                logger::Logger::log("Model not found, will download - emitting model_checking event");
                let _ = app.handle().emit("model_checking", ());
            } else {
                // Model already exists, emit model_ready immediately
                logger::Logger::log("Model already exists - emitting model_ready event");
                let _ = app.handle().emit("model_ready", ());
            }
            
            // Check and download model on startup
            let app_handle_model = app.handle().clone();
            async_runtime::spawn(async move {
                logger::Logger::log("Starting model check in background task");
                match tokio::task::spawn_blocking(|| {
                    whisper::ensure_model()
                }).await {
                    Ok(Ok(())) => {
                        logger::Logger::log("Model check completed successfully on startup");
                        
                        // Double-check that the model file actually exists before emitting ready event
                        let model_path = whisper::get_model_path();
                        if model_path.exists() {
                            logger::Logger::log(&format!("Model file verified at: {:?}", model_path));
                            
                            // Additional verification: check file size
                            if let Ok(metadata) = std::fs::metadata(&model_path) {
                                let size_mb = metadata.len() / 1_048_576;
                                logger::Logger::log(&format!("Model file size: {} MB", size_mb));
                                
                                if size_mb < 100 {
                                    logger::Logger::log_error("Model verification", "Model file is too small, may be corrupted");
                                    let _ = app_handle_model.emit("model_failed", "Model file is too small or corrupted".to_string());
                                    return;
                                }
                            }
                            
                            // Emit event to frontend that model is ready
                            logger::Logger::log("Emitting model_ready event to frontend");
                            let _ = app_handle_model.emit("model_ready", ());
                        } else {
                            logger::Logger::log_error("Model verification", "Model file does not exist after ensure_model completed");
                            let _ = app_handle_model.emit("model_failed", "Model file not found after download".to_string());
                        }
                    }
                    Ok(Err(e)) => {
                        logger::Logger::log_error("startup model check", &e);
                        let _ = app_handle_model.emit("model_failed", e);
                    }
                    Err(e) => {
                        let err_msg = format!("Model check task error: {}", e);
                        logger::Logger::log_error("startup model check task", &err_msg);
                        let _ = app_handle_model.emit("model_failed", err_msg);
                    }
                }
            });

            logger::Logger::log("Spawning background worker");
            // Spawn background worker
            async_runtime::spawn(async move {
                loop {
                    let app_dir = get_app_dir();
                    let recordings_dir = app_dir.join("recordings");
                    
                    let mut rec_files = Vec::new();
                    if let Ok(entries) = std::fs::read_dir(&recordings_dir) {
                        for entry in entries.filter_map(|e| e.ok()) {
                            let path = entry.path();
                            if path.extension().map_or(false, |ext| ext == "rec") {
                                if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                                    rec_files.push((stem.to_string(), path));
                                }
                            }
                        }
                    }

                    // Sort by timestamp (oldest first) to process in order
                    rec_files.sort_by_key(|(stem, _)| stem.parse::<u64>().unwrap_or(0));

                    for (stem, path) in rec_files {
                        tokio::time::sleep(Duration::from_millis(300)).await;
                        logger::Logger::log(&format!("=== TRANSCRIPTION START: {} ===", stem));
                        match whisper::transcribe_file(&stem) {
                            Ok(transcript) => {
                                logger::Logger::log(&format!("=== TRANSCRIPTION END: {} ===", stem));
                                // Emit transcription immediately
                                let _ = app_handle.emit("transcription_ready", ProcessPayload {
                                    id: stem.to_string(),
                                    text: transcript.clone(),
                                });

                                let config_res = config::AppConfig::load_or_create();
                                if let Ok(cfg) = config_res {
                                    if let Ok(enriched) = llm::enrich_and_save(&transcript, &stem, &cfg.llm, None).await {
                                        // Emit enrichment result
                                        let _ = app_handle.emit("enriched_ready", ProcessPayload {
                                            id: stem.to_string(),
                                            text: enriched,
                                        });
                                    } else {
                                        logger::Logger::log_error(&format!("Enrichment for {}", stem), "Failed to enrich transcript");
                                    }
                                } else {
                                    logger::Logger::log_error(&format!("Config load for {}", stem), "Failed to load config");
                                }
                            }
                            Err(e) => {
                                logger::Logger::log_error(&format!("Whisper for {}", stem), &e);
                                eprintln!("Whisper error for {}: {}", stem, e);
                                // Emit error event so frontend knows transcription failed
                                let _ = app_handle.emit("transcription_failed", ProcessPayload {
                                    id: stem.to_string(),
                                    text: format!("Transkription fehlgeschlagen: {}", e),
                                });
                            }
                        }
                        // Rename .rec file so it's not processed again
                        let processed_path = path.with_extension("processed");
                        let _ = std::fs::rename(path, processed_path);
                    }
                    tokio::time::sleep(Duration::from_secs(2)).await;
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![save_and_queue_recording, get_recording_audio, delete_recording, check_model, get_all_recordings, get_prompt_templates, re_enrich_with_prompt, log_frontend])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
