// src-tauri/src/audio.rs
use std::fs;
use hound::{WavSpec, WavWriter};

// Speichert Audiosamples als WAV-Datei mit einem Unix-Zeitstempel im Verzeichnis 'recordings'.
pub fn save_recording(samples: &[i16]) -> Result<String, Box<dyn std::error::Error>> {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)?
        .as_secs()
        .to_string();
    fs::create_dir_all("recordings")?;
    let path = format!("recordings/{}.rec", timestamp);
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
    Ok(timestamp)
}