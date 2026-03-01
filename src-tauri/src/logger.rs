// src-tauri/src/logger.rs
use std::path::PathBuf;
use std::fs;
use std::path::Path;
use std::fs::OpenOptions;
use std::io::Write;
use log::{Log, Level, Metadata, Record, LevelFilter};

pub fn get_app_dir() -> PathBuf {
    // Check if config.json exists in executable directory first
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let exe_config = exe_dir.join("config.json");
            if exe_config.exists() {
                eprintln!("Config found in executable directory, using: {:?}", exe_dir);
                return exe_dir.to_path_buf();
            }
        }
    }
    
    // Determine user-specific data directory based on OS
    let data_dir = if cfg!(target_os = "windows") {
        // Windows: %APPDATA%\VoiceIntel
        std::env::var("APPDATA")
            .map(|p| PathBuf::from(p).join("VoiceIntel"))
            .ok()
    } else if cfg!(target_os = "macos") {
        // macOS: ~/Library/Application Support/VoiceIntel
        std::env::var("HOME")
            .map(|p| PathBuf::from(p).join("Library/Application Support/VoiceIntel"))
            .ok()
    } else {
        // Linux/Unix: $XDG_DATA_HOME or ~/.local/share/VoiceIntel
        if let Ok(xdg) = std::env::var("XDG_DATA_HOME") {
            Some(PathBuf::from(xdg).join("VoiceIntel"))
        } else if let Ok(home) = std::env::var("HOME") {
            Some(PathBuf::from(home).join(".local/share/VoiceIntel"))
        } else {
            None
        }
    };
    
    let app_dir = match data_dir {
        Some(dir) => dir,
        None => {
            // Fallback to executable directory
            if let Ok(exe_path) = std::env::current_exe() {
                if let Some(exe_dir) = exe_path.parent() {
                    exe_dir.to_path_buf()
                } else {
                    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
                }
            } else {
                std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
            }
        }
    };
    
    // Ensure the directory exists
    if !app_dir.exists() {
        if let Err(e) = fs::create_dir_all(&app_dir) {
            eprintln!("Failed to create app directory: {}", e);
        }
    }
    
    // Migrate data from old location (executable directory) if it exists and is different
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let old_dir = exe_dir.to_path_buf();
            if old_dir != app_dir {
                // Helper function to copy directory recursively
                fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
                    if !dst.exists() {
                        fs::create_dir_all(dst)?;
                    }
                    for entry in fs::read_dir(src)? {
                        let entry = entry?;
                        let ty = entry.file_type()?;
                        let src_path = entry.path();
                        let dst_path = dst.join(entry.file_name());
                        if ty.is_dir() {
                            copy_dir_all(&src_path, &dst_path)?;
                        } else {
                            fs::copy(&src_path, &dst_path)?;
                        }
                    }
                    Ok(())
                }
                
                // Migrate config.json
                let old_config = old_dir.join("config.json");
                let new_config = app_dir.join("config.json");
                if old_config.exists() && !new_config.exists() {
                    let _ = fs::copy(&old_config, &new_config);
                }
                
                // Migrate models directory
                let old_models = old_dir.join("models");
                let new_models = app_dir.join("models");
                if old_models.exists() && old_models.is_dir() && !new_models.exists() {
                    let _ = copy_dir_all(&old_models, &new_models);
                }
                
                // Migrate recordings directory
                let old_recordings = old_dir.join("recordings");
                let new_recordings = app_dir.join("recordings");
                if old_recordings.exists() && old_recordings.is_dir() && !new_recordings.exists() {
                    let _ = copy_dir_all(&old_recordings, &new_recordings);
                }
            }
        }
    }
    
    app_dir
}

pub struct Logger;

// Static instance to ensure the logger lives for the entire program lifetime
static LOGGER: Logger = Logger;

impl Logger {
    pub fn init() {
        // Write header to log file
        let app_dir = get_app_dir();
        let log_path = app_dir.join("voice-intel.log");
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&log_path) {
            let _ = writeln!(file, "\n=== Voice Intel Log Started at {} ===", chrono::Local::now().format("%Y-%m-%d %H:%M:%S"));
        }
        // Set global logger for the `log` crate
        let _ = log::set_logger(&LOGGER);
        log::set_max_level(LevelFilter::Info);
    }

    pub fn log(message: &str) {
        log::info!("{}", message);
    }

    pub fn log_error(context: &str, error: &str) {
        log::error!("ERROR [{}]: {}", context, error);
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

impl Log for Logger {
    fn enabled(&self, metadata: &Metadata) -> bool {
        metadata.level() <= log::LevelFilter::Info
    }

    fn log(&self, record: &Record) {
        if self.enabled(record.metadata()) {
            // Write to log file
            let app_dir = get_app_dir();
            let log_path = app_dir.join("voice-intel.log");
            if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&log_path) {
                let _ = writeln!(file, "{}", record.args());
            }
            // Print to console (stdout or stderr)
            match record.level() {
                Level::Error => eprintln!("{}", record.args()),
                _ => println!("{}", record.args()),
            }
        }
    }

    fn flush(&self) {}
}