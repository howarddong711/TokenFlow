use serde::Serialize;

use crate::providers::trae::detect_local_session;

#[derive(Debug, Clone, Serialize)]
pub struct TraeLocalSessionImport {
    pub email: Option<String>,
    pub username: Option<String>,
    pub plan: Option<String>,
}

#[tauri::command]
pub async fn import_trae_local_session() -> Result<TraeLocalSessionImport, String> {
    let session = detect_local_session()
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "No signed-in Trae desktop session was detected.".to_string())?;

    Ok(TraeLocalSessionImport {
        email: session.email,
        username: session.username,
        plan: Some("Trae local session".to_string()),
    })
}
