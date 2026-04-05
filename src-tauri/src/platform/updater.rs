#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReleaseChannel {
    GitHub,
    MacAppStore,
    Unknown,
}

impl ReleaseChannel {
    pub fn parse(raw: &str) -> Self {
        let normalized = raw.trim().to_ascii_lowercase();
        match normalized.as_str() {
            "github" | "gh" | "direct" => Self::GitHub,
            "mac_app_store" | "mac-app-store" | "mas" | "appstore" | "app_store" => {
                Self::MacAppStore
            }
            _ => Self::Unknown,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::GitHub => "github",
            Self::MacAppStore => "mac_app_store",
            Self::Unknown => "unknown",
        }
    }

    pub fn in_app_updates_enabled(self) -> bool {
        !matches!(self, Self::MacAppStore)
    }
}

pub fn current_release_channel() -> ReleaseChannel {
    if let Ok(value) = std::env::var("TOKENFLOW_RELEASE_CHANNEL") {
        return ReleaseChannel::parse(&value);
    }

    if let Some(value) = option_env!("TOKENFLOW_RELEASE_CHANNEL") {
        return ReleaseChannel::parse(value);
    }

    // Default to GitHub/direct behavior to keep local development and
    // non-App-Store desktop builds update-capable unless explicitly overridden.
    ReleaseChannel::GitHub
}

#[cfg(test)]
mod tests {
    use super::ReleaseChannel;

    #[test]
    fn parse_release_channel_aliases() {
        assert_eq!(ReleaseChannel::parse("github"), ReleaseChannel::GitHub);
        assert_eq!(ReleaseChannel::parse("GH"), ReleaseChannel::GitHub);
        assert_eq!(ReleaseChannel::parse("mas"), ReleaseChannel::MacAppStore);
        assert_eq!(
            ReleaseChannel::parse("mac-app-store"),
            ReleaseChannel::MacAppStore
        );
        assert_eq!(
            ReleaseChannel::parse("unknown-value"),
            ReleaseChannel::Unknown
        );
    }

    #[test]
    fn app_store_disables_in_app_updates() {
        assert!(ReleaseChannel::GitHub.in_app_updates_enabled());
        assert!(!ReleaseChannel::MacAppStore.in_app_updates_enabled());
        assert!(ReleaseChannel::Unknown.in_app_updates_enabled());
    }
}
