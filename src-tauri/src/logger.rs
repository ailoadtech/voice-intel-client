// src-tauri/src/logger.rs
use std::path::PathBuf;
use std::fs::OpenOptions;
use std::io::Write;

pub struct Logger;

impl Logger {
    pub fn init() {
        // Create log file in app directory
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                let log_path = exe_dir.join("voice-intel.log");
                let _ = std::fs::write(&log_path, format!("=== Voice Intel Log Started ===\n"));
            }
        }
    }

    pub fn log(message: &str) {
        println!("{}", message);
        Self::write_to_file(message);
    }

    pub fn log_error(context: &str, error: &str) {
        let msg = format!("ERROR [{}]: {}", context, error);
        eprintln!("{}", msg);
        Self::write_to_file(&msg);
    }
    
    fn write_to_file(message: &str) {
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                let log_path = exe_dir.join("voice-intel.log");
                if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&log_path) {
                    let _ = writeln!(file, "{}", message);
                }
            }
        }
    }

    pub fn log_model_download_start() {
        Self::log("Starting model download...");
    }

    pub fn log_model_download_progress(bytes: usize) {
        Self::log(&format!("Downloaded {} bytes", bytes));
    }

    pub fn log_model_download_complete(path: &PathBuf, size: u64) {
        Self::log(&format!("Model download complete: {:?}, size: {} bytes", path, size));
    }

    pub fn log_model_exists(path: &PathBuf) {
        Self::log(&format!("Model already exists at: {:?}", path));
    }
}
