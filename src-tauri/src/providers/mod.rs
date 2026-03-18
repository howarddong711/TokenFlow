//! Provider implementations

#![allow(dead_code)]

pub mod amp;
pub mod antigravity;
pub mod augment;
pub mod claude;
pub mod codex;
pub mod copilot;
pub mod cursor;
pub mod factory;
pub mod gemini;
pub mod iflow;
pub mod jetbrains;
pub mod kimi;
pub mod kimik2;
pub mod kiro;
pub mod minimax;
pub mod ollama;
pub mod openai;
pub mod opencode;
pub mod openrouter;
pub mod qwen;
pub mod synthetic;
pub mod trae;
pub mod vertexai;
pub mod warp;
pub mod zai;

// Re-export provider implementations
pub use amp::AmpProvider;
pub use antigravity::AntigravityProvider;
pub use augment::AugmentProvider;
pub use claude::ClaudeProvider;
pub use codex::CodexProvider;
pub use copilot::CopilotProvider;
pub use cursor::CursorProvider;
pub use factory::FactoryProvider;
pub use gemini::GeminiProvider;
pub use iflow::IflowProvider;
pub use jetbrains::JetBrainsProvider;
pub use kimi::KimiProvider;
pub use kimik2::KimiK2Provider;
pub use kiro::KiroProvider;
pub use minimax::MiniMaxProvider;
pub use ollama::OllamaProvider;
pub use opencode::OpenCodeProvider;
pub use openrouter::OpenRouterProvider;
pub use qwen::QwenProvider;
pub use synthetic::SyntheticProvider;
pub use trae::TraeProvider;
pub use vertexai::VertexAIProvider;
pub use warp::WarpProvider;
pub use zai::ZaiProvider;

use crate::core::{Provider, ProviderId};

pub fn build_provider(id: ProviderId) -> Box<dyn Provider> {
    match id {
        ProviderId::Amp => Box::new(AmpProvider::new()),
        ProviderId::Antigravity => Box::new(AntigravityProvider::new()),
        ProviderId::Augment => Box::new(AugmentProvider::new()),
        ProviderId::Claude => Box::new(ClaudeProvider::new()),
        ProviderId::Codex => Box::new(CodexProvider::new()),
        ProviderId::Copilot => Box::new(CopilotProvider::new()),
        ProviderId::Cursor => Box::new(CursorProvider::new()),
        ProviderId::Factory => Box::new(FactoryProvider::new()),
        ProviderId::Gemini => Box::new(GeminiProvider::new()),
        ProviderId::Iflow => Box::new(IflowProvider::new()),
        ProviderId::JetBrains => Box::new(JetBrainsProvider::new()),
        ProviderId::Kimi => Box::new(KimiProvider::new()),
        ProviderId::KimiK2 => Box::new(KimiK2Provider::new()),
        ProviderId::Kiro => Box::new(KiroProvider::new()),
        ProviderId::MiniMax => Box::new(MiniMaxProvider::new()),
        ProviderId::Ollama => Box::new(OllamaProvider::new()),
        ProviderId::OpenCode => Box::new(OpenCodeProvider::new()),
        ProviderId::OpenRouter => Box::new(OpenRouterProvider::new()),
        ProviderId::Qwen => Box::new(QwenProvider::new()),
        ProviderId::Synthetic => Box::new(SyntheticProvider::new()),
        ProviderId::Trae => Box::new(TraeProvider::new()),
        ProviderId::VertexAI => Box::new(VertexAIProvider::new()),
        ProviderId::Warp => Box::new(WarpProvider::new()),
        ProviderId::Zai => Box::new(ZaiProvider::new()),
    }
}
