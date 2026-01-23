// src-tauri/src/llm.rs
use std::fs;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};

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

#[derive(Serialize)]
struct OllamaRequest {
    model: String,
    prompt: String,
    stream: bool,
}

#[derive(Deserialize)]
struct OllamaResponse {
    response: String,
}

// Sendet die Transkription an ein lokales LLM (Ollama), um den Text zu strukturieren und zu verbessern.
pub async fn enrich_and_save(
    transcript: &str,
    timestamp: &str,
    config: &super::config::LlmConfig,
    prompt_name: Option<&str>,
) -> Result<String, String> {
    inner_enrich_and_save(transcript, timestamp, config, prompt_name).await.map_err(|e| e.to_string())
}

async fn inner_enrich_and_save(
    transcript: &str,
    timestamp: &str,
    config: &super::config::LlmConfig,
    prompt_name: Option<&str>,
) -> Result<String, Box<dyn std::error::Error>> {
    let app_dir = get_app_dir();
    let out_path = app_dir.join("recordings").join(format!("{}.enriched.txt", timestamp));
    
    if !config.enabled {
        fs::write(&out_path, transcript)?;
        return Ok(transcript.to_string());
    }
    
    // Get the appropriate template based on prompt_name
    let template = if let Some(name) = prompt_name {
        config.get_template_by_name(name).unwrap_or_else(|| config.prompt_template1.clone())
    } else {
        config.prompt_template1.clone()
    };
    
    let prompt = template.replace("{{text}}", transcript);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(config.timeout_seconds))
        .build()?;
    
    // Try to send request to LLM, but handle connection errors gracefully
    match client
        .post(format!("{}/api/generate", config.url.trim_end_matches('/')))
        .json(&OllamaRequest {
            model: config.model.clone(),
            prompt,
            stream: false,
        })
        .send()
        .await
    {
        Ok(response) => {
            match response.json::<OllamaResponse>().await {
                Ok(res) => {
                    let enriched = res.response.trim().to_string();
                    fs::write(&out_path, &enriched)?;
                    Ok(enriched)
                }
                Err(e) => {
                    eprintln!("Failed to parse LLM response: {}. Saving original transcript.", e);
                    fs::write(&out_path, transcript)?;
                    Ok(transcript.to_string())
                }
            }
        }
        Err(e) => {
            eprintln!("Failed to connect to LLM at {}: {}. Saving original transcript.", config.url, e);
            fs::write(&out_path, transcript)?;
            Ok(transcript.to_string())
        }
    }
}
