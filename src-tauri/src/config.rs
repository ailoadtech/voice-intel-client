// src-tauri/src/config.rs
use serde::{Deserialize, Serialize};
use std::fs;
use std::collections::HashMap;
use crate::logger::get_app_dir;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct LlmConfig {
    pub enabled: bool,
    pub provider: String,
    pub url: String,
    pub api_key: String,
    pub model: String,
    pub timeout_seconds: u64,
    pub prompt_template1: String,
    pub prompt_template2: String,
    pub prompt_template3: String,
    pub prompt_template4: String,
}

impl LlmConfig {
    pub fn get_prompt_templates(&self) -> HashMap<String, String> {
        let mut templates = HashMap::new();
        templates.insert("Prompt 1".to_string(), self.prompt_template1.clone());
        templates.insert("Prompt 2".to_string(), self.prompt_template2.clone());
        templates.insert("Prompt 3".to_string(), self.prompt_template3.clone());
        templates.insert("Prompt 4".to_string(), self.prompt_template4.clone());
        templates
    }

    pub fn get_template_by_name(&self, name: &str) -> Option<String> {
        match name {
            "Prompt 1" => Some(self.prompt_template1.clone()),
            "Prompt 2" => Some(self.prompt_template2.clone()),
            "Prompt 3" => Some(self.prompt_template3.clone()),
            "Prompt 4" => Some(self.prompt_template4.clone()),
            _ => None,
        }
    }
}

#[derive(Serialize, Deserialize, Debug)]
pub struct AppConfig {
    pub llm: LlmConfig,
}

impl Default for AppConfig {
    // Erstellt eine Standardkonfiguration für die Anwendung.
    fn default() -> Self {
        Self {
            llm: LlmConfig {
                enabled: true,
                provider: "ollama".to_string(),
                url: "http://127.0.0.1:11434".to_string(),
                api_key: "".to_string(),
                model: "llama3.2:latest".to_string(),
                timeout_seconds: 60,
                prompt_template1: "Verbessere folgenden Text sprachlich, füge Struktur hinzu und gib ihn als professionellen, formatierten Text zurück:\n\n{{text}}".to_string(),
                prompt_template2: "Fasse den Text zusammen als Bullet-Liste:\n\n{{text}}".to_string(),
                prompt_template3: "Schreibe den Text im Stil von Shakespeare:\n\n{{text}}".to_string(),
                prompt_template4: "Bullshit Bingo. Wenn ein Begriff aus der Kategorie Berufsleben/Management im transkriberten Text auftaucht, dann mache ihn in der enriched Version Fett:\n\n{{text}}".to_string(),
            },
        }
    }
}

impl AppConfig {
    // Lädt die Konfiguration aus der Datei oder erstellt eine neue Standarddatei, falls sie fehlt.
    pub fn load_or_create() -> Result<Self, String> {
        Self::inner_load_or_create().map_err(|e| e.to_string())
    }

    // Interne Logik zum Laden oder Erstellen der Konfigurationsdatei.
    fn inner_load_or_create() -> Result<Self, Box<dyn std::error::Error>> {
        let config_path = get_app_dir().join("config.json");
        
        if !config_path.exists() {
            let default = Self::default();
            fs::write(&config_path, serde_json::to_string_pretty(&default)?)?;
        }
        let content = fs::read_to_string(&config_path)?;
        Ok(serde_json::from_str(&content)?)
    }
}
