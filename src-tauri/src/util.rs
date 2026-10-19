//! Small helpers shared by several modules.

use std::time::{SystemTime, UNIX_EPOCH};

/// Current Unix time in milliseconds, as used by `createdAt`/`updatedAt`/`connectedAt`.
pub fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}
