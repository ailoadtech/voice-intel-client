// Disable console window on Windows in release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio;
mod whisper;
mod llm;
mod config;

use serde::Serialize;
use tauri::{Manager, async_runtime, Emitter};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, Modifiers, Code, ShortcutState};
use std::time::Duration;
use std::path::{Path, PathBuf};

// Get the base directory for app data
fn get_app_dir() -> PathBuf {
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
    audio::save_recording(&samples).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_recording_audio(id: String) -> Result<Vec<u8>, String> {
    let app_dir = get_app_dir();
    let processed_path = app_dir.join("recordings").join(format!("{}.processed", id));
    let rec_path = app_dir.join("recordings").join(format!("{}.rec", id));

    let path = if processed_path.exists() {
        processed_path
    } else if rec_path.exists() {
        rec_path
    } else {
        return Err("Recording not found".to_string());
    };

    tokio::fs::read(path).await.map_err(|e| e.to_string())
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
    whisper::ensure_model().map_err(|e| e.to_string())?;
    Ok(true)
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
    let ctrl_shift_space = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space);

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new()
            .with_handler(move |app, shortcut, event| {
                if shortcut == &ctrl_shift_space && event.state() == ShortcutState::Pressed {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.emit("hotkey-triggered", ());
                    }
                }
            })
            .build())
        .setup(move |app| {
            app.global_shortcut().register(ctrl_shift_space)?;

            let app_handle = app.handle().clone();

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
                        match whisper::transcribe_file(&stem) {
                            Ok(transcript) => {
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
                                    }
                                }
                            }
                            Err(e) => eprintln!("Whisper error: {}", e),
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
        .invoke_handler(tauri::generate_handler![save_and_queue_recording, get_recording_audio, delete_recording, check_model, get_all_recordings, get_prompt_templates, re_enrich_with_prompt])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
