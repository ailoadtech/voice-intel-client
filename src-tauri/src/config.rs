// src-tauri/src/config.rs
use serde::{Deserialize, Serialize};
use std::fs;
use std::collections::HashMap;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct LlmConfig {
    pub enabled: bool,
    pub url: String,
    pub model: String,
    pub timeout_seconds: u64,
    pub prompt_template: String,
    #[serde(default)]
    pub prompt_template1: Option<String>,
    #[serde(default)]
    pub prompt_template2: Option<String>,
    #[serde(default)]
    pub prompt_template3: Option<String>,
}

impl LlmConfig {
    pub fn get_prompt_templates(&self) -> HashMap<String, String> {
        let mut templates = HashMap::new();
        templates.insert("Prompt 1".to_string(), self.prompt_template.clone());
        if let Some(t) = &self.prompt_template1 {
            templates.insert("Prompt 2".to_string(), t.clone());
        }
        if let Some(t) = &self.prompt_template2 {
            templates.insert("Prompt 3".to_string(), t.clone());
        }
        if let Some(t) = &self.prompt_template3 {
            templates.insert("Prompt 4".to_string(), t.clone());
        }
        templates
    }

    pub fn get_template_by_name(&self, name: &str) -> Option<String> {
        match name {
            "Prompt 1" => Some(self.prompt_template.clone()),
            "Prompt 2" => self.prompt_template1.clone(),
            "Prompt 3" => self.prompt_template2.clone(),
            "Prompt 4" => self.prompt_template3.clone(),
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
                url: "http://192.168.1.100:11434".to_string(),
                model: "llama3.2:latest".to_string(),
                timeout_seconds: 60,
                prompt_template: "Verbessere und strukturiere folgenden Text:\n\n{{text}}".to_string(),
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
        if !std::path::Path::new("config.json").exists() {
            let default = Self::default();
            fs::write("config.json", serde_json::to_string_pretty(&default)?)?;
        }
        let content = fs::read_to_string("config.json")?;
        Ok(serde_json::from_str(&content)?)
    }
}
