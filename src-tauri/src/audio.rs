// src-tauri/src/audio.rs
use std::fs;
use hound::{WavSpec, WavWriter};
use crate::logger::get_app_dir;

// Speichert Audiosamples als WAV-Datei mit einem Unix-Zeitstempel im Verzeichnis 'recordings'.
pub fn save_recording(samples: &[i16]) -> Result<String, Box<dyn std::error::Error>> {
    println!("=== RECORDING END ===");
    println!("save_recording called with {} samples", samples.len());
    
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)?
        .as_secs()
        .to_string();
    
    let app_dir = get_app_dir();
    let recordings_dir = app_dir.join("recordings");
    
    println!("App directory (absolute path): {:?}", app_dir);
    println!("Recordings directory (absolute path): {:?}", recordings_dir);
    
    // Ensure recordings directory exists
    if !recordings_dir.exists() {
        println!("Recordings directory does not exist, creating...");
        fs::create_dir_all(&recordings_dir)?;
        println!("Created recordings directory at: {:?}", recordings_dir);
    } else {
        println!("Recordings directory already exists at: {:?}", recordings_dir);
    }
    
    let path = recordings_dir.join(format!("{}.rec", timestamp));
    println!("Full file path for recording: {:?}", path);
    println!("Timestamp ID: {}", timestamp);
    
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
    println!("Recording finalized and saved successfully");
    
    // Verify file was created
    if path.exists() {
        let metadata = std::fs::metadata(&path)?;
        println!("✓ FILE VERIFIED - EXISTS ON DISK");
        println!("  Path: {:?}", path);
        println!("  Size: {} bytes", metadata.len());
        println!("  Timestamp ID returned: {}", timestamp);
        println!("=== RECORDING SAVED ===");
    } else {
        println!("✗ WARNING: File was NOT created at {:?}", path);
        return Err("File verification failed - file does not exist after write".into());
    }
    
    Ok(timestamp)
}