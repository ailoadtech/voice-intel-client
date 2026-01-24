// src-tauri/src/logger.rs
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;

const LOG_PATH: &str = r"c:\temp\mylog.txt";

pub struct Logger;

impl Logger {
    pub fn init() {
        // Ensure the temp directory exists
        if let Some(parent) = std::path::Path::new(LOG_PATH).parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        
        // Write startup marker
        Self::log("=== APPLICATION STARTED ===");
        Self::log(&format!("Executable: {:?}", std::env::current_exe().unwrap_or_default()));
        Self::log(&format!("Working directory: {:?}", std::env::current_dir().unwrap_or_default()));
    }

    pub fn log(message: &str) {
        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
        let log_line = format!("[{}] {}\n", timestamp, message);
        
        // Print to console as well
        print!("{}", log_line);
        
        // Write to file
        if let Ok(mut file) = OpenOptions::new()
            .create(true)
            .append(true)
            .open(LOG_PATH)
        {
            let _ = file.write_all(log_line.as_bytes());
            let _ = file.flush();
        }
    }

    pub fn log_error(context: &str, error: &str) {
        Self::log(&format!("ERROR [{}]: {}", context, error));
    }

    pub fn log_model_download_start() {
        Self::log("MODEL DOWNLOAD: Starting download of Whisper model");
        Self::log(&format!("MODEL DOWNLOAD: URL = {}", super::whisper::MODEL_URL));
    }

    pub fn log_model_download_progress(bytes: usize) {
        let mb = bytes as f64 / 1024.0 / 1024.0;
        Self::log(&format!("MODEL DOWNLOAD: Downloaded {:.2} MB ({} bytes)", mb, bytes));
    }

    pub fn log_model_download_complete(path: &PathBuf, size: u64) {
        let mb = size as f64 / 1024.0 / 1024.0;
        Self::log(&format!("MODEL DOWNLOAD: Complete - saved to {:?}", path));
        Self::log(&format!("MODEL DOWNLOAD: File size = {:.2} MB ({} bytes)", mb, size));
    }

    pub fn log_model_exists(path: &PathBuf) {
        Self::log(&format!("MODEL CHECK: Model already exists at {:?}", path));
    }
}
