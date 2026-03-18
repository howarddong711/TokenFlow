//! Usage snapshot model - represents a point-in-time usage state for a provider

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::RateWindow;

/// A provider-native named rate window that should be preserved in the UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NamedRateWindow {
    /// Stable identifier for this provider-native window
    pub id: String,

    /// Display label shown in the UI
    pub label: String,

    /// Optional semantic kind (window, model, usage, credit)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,

    /// The underlying usage window
    pub window: RateWindow,
}

impl NamedRateWindow {
    pub fn new(id: impl Into<String>, label: impl Into<String>, window: RateWindow) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            kind: None,
            window,
        }
    }

    pub fn with_kind(mut self, kind: impl Into<String>) -> Self {
        self.kind = Some(kind.into());
        self
    }
}

/// A snapshot of usage data for a provider at a point in time
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageSnapshot {
    /// Primary rate window (usually session-based, e.g., 5-hour for Claude)
    pub primary: RateWindow,

    /// Secondary rate window (usually weekly/monthly)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secondary: Option<RateWindow>,

    /// Model-specific rate window (e.g., Opus quota for Claude)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_specific: Option<RateWindow>,

    /// Additional provider-native windows beyond the legacy primary/secondary/model slots
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extra_windows: Vec<NamedRateWindow>,

    /// When this snapshot was captured
    pub updated_at: DateTime<Utc>,

    /// Account email if available
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_email: Option<String>,

    /// Account organization if available
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_organization: Option<String>,

    /// Login method/plan info (e.g., "Claude Pro", "Claude Max")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub login_method: Option<String>,
}

impl UsageSnapshot {
    /// Create a new usage snapshot with just primary window
    pub fn new(primary: RateWindow) -> Self {
        Self {
            primary,
            secondary: None,
            model_specific: None,
            extra_windows: Vec::new(),
            updated_at: Utc::now(),
            account_email: None,
            account_organization: None,
            login_method: None,
        }
    }

    /// Builder pattern: set secondary window
    pub fn with_secondary(mut self, secondary: RateWindow) -> Self {
        self.secondary = Some(secondary);
        self
    }

    /// Builder pattern: set model-specific window
    pub fn with_model_specific(mut self, model_specific: RateWindow) -> Self {
        self.model_specific = Some(model_specific);
        self
    }

    /// Builder pattern: append a provider-native extra window
    pub fn with_extra_window(mut self, window: NamedRateWindow) -> Self {
        self.extra_windows.push(window);
        self
    }

    /// Builder pattern: append multiple provider-native windows
    pub fn with_extra_windows<I>(mut self, windows: I) -> Self
    where
        I: IntoIterator<Item = NamedRateWindow>,
    {
        self.extra_windows.extend(windows);
        self
    }

    /// Builder pattern: set account email
    pub fn with_email(mut self, email: impl Into<String>) -> Self {
        self.account_email = Some(email.into());
        self
    }

    /// Builder pattern: set organization
    pub fn with_organization(mut self, org: impl Into<String>) -> Self {
        self.account_organization = Some(org.into());
        self
    }

    /// Builder pattern: set login method
    pub fn with_login_method(mut self, method: impl Into<String>) -> Self {
        self.login_method = Some(method.into());
        self
    }

    /// Get the most restrictive (highest used) rate window
    pub fn most_restrictive(&self) -> &RateWindow {
        let mut most = &self.primary;

        if let Some(ref secondary) = self.secondary {
            if secondary.used_percent > most.used_percent {
                most = secondary;
            }
        }

        if let Some(ref model_specific) = self.model_specific {
            if model_specific.used_percent > most.used_percent {
                most = model_specific;
            }
        }

        for extra in &self.extra_windows {
            if extra.window.used_percent > most.used_percent {
                most = &extra.window;
            }
        }

        most
    }

    /// Check if any rate window is exhausted
    pub fn any_exhausted(&self) -> bool {
        self.primary.is_exhausted()
            || self.secondary.as_ref().is_some_and(|w| w.is_exhausted())
            || self
                .model_specific
                .as_ref()
                .is_some_and(|w| w.is_exhausted())
            || self.extra_windows.iter().any(|window| window.window.is_exhausted())
    }
}

/// Cost/credits snapshot for providers that support it
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CostSnapshot {
    /// Amount used in the current period
    pub used: f64,

    /// Limit for the current period (if any)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<f64>,

    /// Currency code (e.g., "USD")
    pub currency_code: String,

    /// Period description (e.g., "Monthly", "Daily")
    pub period: String,

    /// When the period resets
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resets_at: Option<DateTime<Utc>>,

    /// When this snapshot was captured
    pub updated_at: DateTime<Utc>,
}

impl CostSnapshot {
    /// Create a new cost snapshot
    pub fn new(used: f64, currency_code: impl Into<String>, period: impl Into<String>) -> Self {
        Self {
            used,
            limit: None,
            currency_code: currency_code.into(),
            period: period.into(),
            resets_at: None,
            updated_at: Utc::now(),
        }
    }

    /// Builder pattern: set limit
    pub fn with_limit(mut self, limit: f64) -> Self {
        self.limit = Some(limit);
        self
    }

    /// Builder pattern: set reset time
    pub fn with_resets_at(mut self, resets_at: DateTime<Utc>) -> Self {
        self.resets_at = Some(resets_at);
        self
    }

    /// Get remaining amount if limit is set
    pub fn remaining(&self) -> Option<f64> {
        self.limit.map(|l| (l - self.used).max(0.0))
    }

    /// Get usage percentage if limit is set
    pub fn used_percent(&self) -> Option<f64> {
        self.limit.map(|l| {
            if l > 0.0 {
                (self.used / l * 100.0).min(100.0)
            } else {
                100.0
            }
        })
    }

    /// Format the cost as a currency string
    pub fn format_used(&self) -> String {
        format_currency(self.used, &self.currency_code)
    }

    /// Format the limit as a currency string
    pub fn format_limit(&self) -> Option<String> {
        self.limit.map(|l| format_currency(l, &self.currency_code))
    }
}

/// Format a value as currency
fn format_currency(value: f64, currency_code: &str) -> String {
    match currency_code.to_uppercase().as_str() {
        "USD" => format!("${:.2}", value),
        "EUR" => format!("€{:.2}", value),
        "GBP" => format!("£{:.2}", value),
        _ => format!("{:.2} {}", value, currency_code),
    }
}

/// Combined fetch result containing usage and optional cost data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderFetchResult {
    /// Usage data
    pub usage: UsageSnapshot,

    /// Cost/credits data if available
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost: Option<CostSnapshot>,

    /// Label describing the data source (e.g., "oauth", "web", "cli")
    pub source_label: String,
}

impl ProviderFetchResult {
    /// Create a new fetch result
    pub fn new(usage: UsageSnapshot, source_label: impl Into<String>) -> Self {
        Self {
            usage,
            cost: None,
            source_label: source_label.into(),
        }
    }

    /// Builder pattern: set cost
    pub fn with_cost(mut self, cost: CostSnapshot) -> Self {
        self.cost = Some(cost);
        self
    }
}
