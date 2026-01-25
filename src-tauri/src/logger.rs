// src-tauri/src/logger.rs
use std::path::PathBuf;

pub struct Logger;

impl Logger {
    pub fn init() {
        // Logger disabled
    }

    pub fn log(_message: &str) {
        // Logger disabled
    }

    pub fn log_error(_context: &str, _error: &str) {
        // Logger disabled
    }

    pub fn log_model_download_start() {
        // Logger disabled
    }

    pub fn log_model_download_progress(_bytes: usize) {
        // Logger disabled
    }

    pub fn log_model_download_complete(_path: &PathBuf, _size: u64) {
        // Logger disabled
    }

    pub fn log_model_exists(_path: &PathBuf) {
        // Logger disabled
    }
}
