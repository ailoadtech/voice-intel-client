// src-tauri/src/audio.rs
use std::fs;
use std::path::PathBuf;
use hound::{WavSpec, WavWriter};

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

// Speichert Audiosamples als WAV-Datei mit einem Unix-Zeitstempel im Verzeichnis 'recordings'.
pub fn save_recording(samples: &[i16]) -> Result<String, Box<dyn std::error::Error>> {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)?
        .as_secs()
        .to_string();
    
    let app_dir = get_app_dir();
    let recordings_dir = app_dir.join("recordings");
    
    // Ensure recordings directory exists
    if !recordings_dir.exists() {
        fs::create_dir_all(&recordings_dir)?;
        println!("Created recordings directory at: {:?}", recordings_dir);
    }
    
    let path = recordings_dir.join(format!("{}.rec", timestamp));
    println!("Saving recording to: {:?}", path);
    
    let spec = WavSpec {
        channels: 1,
        sample_rate: 16000,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = WavWriter::create(&path, spec)?;
    for &sample in samples {
        writer.write_sample(sample)?;
    }
    writer.finalize()?;
    println!("Recording saved successfully: {}", timestamp);
    Ok(timestamp)
}