// src-tauri/src/whisper.rs
use std::fs;
use whisper_rs::{WhisperContext, WhisperContextParameters, FullParams, SamplingStrategy};

const MODEL_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin";
const MODEL_PATH: &str = "models/ggml-small.bin";

// Stellt sicher, dass das Whisper-Modell heruntergeladen und im lokalen Verzeichnis verfügbar ist.
pub fn ensure_model() -> Result<(), Box<dyn std::error::Error>> {
    if !std::path::Path::new(MODEL_PATH).exists() {
        fs::create_dir_all("models")?;
        println!("Downloading Whisper small model...");
        let resp = reqwest::blocking::get(MODEL_URL)?;
        let data = resp.bytes()?;
        fs::write(MODEL_PATH, data)?;
    }
    Ok(())
}

// Öffentliche Funktion zur Transkription einer Audiodatei basierend auf einem Zeitstempel.
pub fn transcribe_file(timestamp: &str) -> Result<String, String> {
    inner_transcribe(timestamp).map_err(|e| e.to_string())
}

// Interne Logik zur Verarbeitung der Audiodatei mit dem Whisper-Modell.
fn inner_transcribe(timestamp: &str) -> Result<String, Box<dyn std::error::Error>> {
    ensure_model()?;
    let rec_path = format!("recordings/{}.rec", timestamp);
    let out_path = format!("recordings/{}.whisper.txt", timestamp);

    let params = WhisperContextParameters::default();
    let ctx = WhisperContext::new_with_params(MODEL_PATH, params)?;
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
                text.push_str(segment_text);
                text.push(' ');
            }
        }
    }
    let transcript = text.trim().to_string();

    fs::write(&out_path, &transcript)?;
    Ok(transcript)
}