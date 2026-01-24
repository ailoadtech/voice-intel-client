// src-tauri/src/audio.rs
use std::fs;
use std::path::PathBuf;
use hound::{WavSpec, WavWriter};

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

// Speichert Audiosamples als WAV-Datei mit einem Unix-Zeitstempel im Verzeichnis 'recordings'.
pub fn save_recording(samples: &[i16]) -> Result<String, Box<dyn std::error::Error>> {
    println!("save_recording called with {} samples", samples.len());
    
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)?
        .as_secs()
        .to_string();
    
    let app_dir = get_app_dir();
    let recordings_dir = app_dir.join("recordings");
    
    println!("App directory: {:?}", app_dir);
    println!("Recordings directory: {:?}", recordings_dir);
    
    // Ensure recordings directory exists
    if !recordings_dir.exists() {
        println!("Recordings directory does not exist, creating...");
        fs::create_dir_all(&recordings_dir)?;
        println!("Created recordings directory at: {:?}", recordings_dir);
    } else {
        println!("Recordings directory already exists");
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
    println!("WavWriter created successfully");
    
    for &sample in samples {
        writer.write_sample(sample)?;
    }
    println!("All {} samples written", samples.len());
    
    writer.finalize()?;
    println!("Recording finalized and saved successfully: {}", timestamp);
    
    // Verify file was created
    if path.exists() {
        let metadata = std::fs::metadata(&path)?;
        println!("File verified - size: {} bytes", metadata.len());
    } else {
        println!("WARNING: File was not created at {:?}", path);
    }
    
    Ok(timestamp)
}