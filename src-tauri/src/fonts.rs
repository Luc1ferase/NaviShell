//! Font families installed on this machine, for the font picker in Settings.
//!
//! The scan parses the name tables of every font file the OS knows about, which takes a
//! few hundred milliseconds on a typical machine, so the result is cached for the lifetime
//! of the process. `fonts_list { refresh: true }` rescans after the user installed a font.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use serde::Serialize;

use crate::error::AppResult;

/// One installed font family.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontFamily {
    /// Family name as the font declares it (the English name when it has one), which is
    /// what CSS `font-family` expects.
    pub name: String,
    /// `true` when at least one face of the family declares itself fixed-pitch. CJK "mono"
    /// fonts with double-width ideographs often do not, hence the "show all fonts" option
    /// in the picker.
    pub monospaced: bool,
}

static CACHE: Mutex<Option<Arc<Vec<FontFamily>>>> = Mutex::new(None);

fn cache() -> std::sync::MutexGuard<'static, Option<Arc<Vec<FontFamily>>>> {
    CACHE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Blocking: loads every system font and folds the faces into families.
fn scan() -> Vec<FontFamily> {
    let mut db = fontdb::Database::new();
    db.load_system_fonts();

    // Keyed by the lower-cased name so the result is ordered case-insensitively and
    // "Foo" / "foo" variants of the same family collapse into one entry.
    let mut families: BTreeMap<String, FontFamily> = BTreeMap::new();
    for face in db.faces() {
        let Some((name, _language)) = face.families.first() else {
            continue;
        };
        let name = name.trim();
        // macOS ships hidden system faces (".SF NS Mono", ".Keyboard") that CSS cannot use.
        if name.is_empty() || name.starts_with('.') {
            continue;
        }
        let entry = families
            .entry(name.to_lowercase())
            .or_insert_with(|| FontFamily {
                name: name.to_string(),
                monospaced: false,
            });
        entry.monospaced |= face.monospaced;
    }
    families.into_values().collect()
}

/// Installed font families sorted by name. Served from the cache unless `refresh` is set.
#[tauri::command]
pub async fn fonts_list(refresh: bool) -> AppResult<Vec<FontFamily>> {
    if !refresh {
        let cached = cache().clone();
        if let Some(list) = cached {
            return Ok(list.as_ref().clone());
        }
    }
    let list = Arc::new(tokio::task::spawn_blocking(scan).await?);
    *cache() = Some(Arc::clone(&list));
    Ok(list.as_ref().clone())
}
