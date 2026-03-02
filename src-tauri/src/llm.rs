// src-tauri/src/llm.rs
use std::fs;
use serde::{Deserialize, Serialize};
use crate::logger::get_app_dir;
use log::{info, error};

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

#[derive(Serialize, Deserialize)]
struct OpenRouterMessage {
    role: String,
    content: String,
}

#[derive(Serialize)]
struct OpenRouterRequest {
    model: String,
    messages: Vec<OpenRouterMessage>,
}

#[derive(Deserialize)]
struct OpenRouterResponse {
    choices: Vec<OpenRouterChoice>,
}

#[derive(Deserialize)]
struct OpenRouterChoice {
    message: OpenRouterMessage,
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
        info!("LLM enrichment disabled, saved transcript directly for timestamp {}", timestamp);
        return Ok(transcript.to_string());
    }
    
    info!("Starting LLM enrichment: timestamp={}, provider={}, model={}, transcript_len={}, prompt_name={:?}",
        timestamp, config.provider, config.model, transcript.len(), prompt_name);
    
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
    
    // Route to different provider based on config
    let provider = config.provider.to_lowercase();
    
    if provider == "openrouter" {
        // OpenRouter request
        let request = client
            .post("https://openrouter.ai/api/v1/chat/completions")
            .header("Authorization", format!("Bearer {}", config.api_key))
            .header("Content-Type", "application/json")
            .json(&OpenRouterRequest {
                model: config.model.clone(),
                messages: vec![OpenRouterMessage {
                    role: "user".to_string(),
                    content: prompt,
                }],
            });
        
        match request.send().await {
            Ok(response) => {
                match response.json::<OpenRouterResponse>().await {
                    Ok(res) => {
                        if let Some(choice) = res.choices.first() {
                            let enriched = choice.message.content.trim().to_string();
                            fs::write(&out_path, &enriched)?;
                            info!("OpenRouter enrichment successful: timestamp={}, output_len={}", timestamp, enriched.len());
                            return Ok(enriched);
                        } else {
                            error!("OpenRouter returned no choices for timestamp {}", timestamp);
                            return Err("OpenRouter returned no choices".into());
                        }
                    }
                    Err(e) => {
                        error!("Failed to parse OpenRouter response for timestamp {}: {}", timestamp, e);
                        return Err(e.into());
                    }
                }
            }
            Err(e) => {
                error!("Failed to connect to OpenRouter for timestamp {}: {}", timestamp, e);
                return Err(e.into());
            }
        }
    }
    
    // Default: Ollama request
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
                    info!("Ollama enrichment successful: timestamp={}, output_len={}", timestamp, enriched.len());
                    Ok(enriched)
                }
                Err(e) => {
                    error!("Failed to parse Ollama response for timestamp {}: {}", timestamp, e);
                    return Err(e.into());
                }
            }
        }
        Err(e) => {
            error!("Failed to connect to Ollama at {} for timestamp {}: {}", config.url, timestamp, e);
            return Err(e.into());
        }
    }
}
