//! Recent-files persistence and ordering.
//!
//! Stores the most-recently-opened PPTX paths to disk so the menubar's
//! "Open Recent" submenu survives application restarts. The store is a
//! plain JSON array of [`Entry`] records; the most-recently-opened path
//! sits at index 0 and the list is capped at [`MAX`] entries.
//!
//! See `.plans/04-native-viewer/plan.md` Task F1.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Maximum number of entries kept in the recent-files list.
const MAX: usize = 10;

/// A single recent-files entry: the absolute path, the basename used for
/// display, and the wall-clock timestamp at which the file was last opened.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct Entry {
    /// Absolute filesystem path of the recently-opened file.
    pub path: String,
    /// Display label, derived from the path's basename when the entry is
    /// pushed. Stored alongside the path so the menubar can render
    /// without re-touching the filesystem.
    pub name: String,
    /// Wall-clock millisecond timestamp at which the file was last
    /// opened. Defaults to `0` for entries deserialized from older
    /// store versions that lacked the field.
    #[serde(default)]
    pub opened_at_ms: i64,
}

/// On-disk store of recent-files [`Entry`] records.
///
/// The store keeps the entries ordered most-recent-first, deduplicates by
/// path on insertion (a re-open promotes the entry back to the top), and
/// caps the list at [`MAX`] entries.
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct Store {
    /// Most-recent-first list of entries, capped at [`MAX`].
    pub entries: Vec<Entry>,
    /// Backing file path. Skipped during serialization since the file
    /// location is supplied by the caller and only the entry list is
    /// persisted.
    #[serde(skip)]
    file: PathBuf,
}

impl Store {
    /// Load the store from `file`. A missing or malformed file yields an
    /// empty store bound to the requested path; the next [`Store::save`]
    /// call will create the file on disk.
    pub fn load(file: &Path) -> Self {
        let entries = std::fs::read_to_string(file)
            .ok()
            .and_then(|s| serde_json::from_str::<Vec<Entry>>(&s).ok())
            .unwrap_or_default();
        Self {
            entries,
            file: file.to_path_buf(),
        }
    }

    /// Persist the entry list to the store's backing file. The parent
    /// directory is created if it does not already exist.
    pub fn save(&self) -> std::io::Result<()> {
        if let Some(parent) = self.file.parent() {
            std::fs::create_dir_all(parent)?;
        }
        // `serde_json::to_string_pretty` on a `Vec<Entry>` cannot fail
        // because every field is a primitive `String` / `i64`; the
        // `unwrap` is therefore an invariant, not a hidden panic path.
        let body = serde_json::to_string_pretty(&self.entries).unwrap();
        std::fs::write(&self.file, body)
    }

    /// Push `path` to the top of the list. If the path is already
    /// present, the existing entry is removed first so that the new one
    /// takes index 0 (dedup-and-promote semantics). The list is then
    /// truncated to [`MAX`] entries.
    pub fn push(&mut self, path: &str) {
        let now = chrono_now_ms();
        let name = Path::new(path)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        self.entries.retain(|e| e.path != path);
        self.entries.insert(
            0,
            Entry {
                path: path.to_string(),
                name,
                opened_at_ms: now,
            },
        );
        if self.entries.len() > MAX {
            self.entries.truncate(MAX);
        }
    }

    /// Drop every entry from the in-memory list. The caller is
    /// responsible for invoking [`Store::save`] afterwards if the change
    /// should be persisted.
    pub fn clear(&mut self) {
        self.entries.clear();
    }
}

/// Wall-clock milliseconds since the UNIX epoch. Returns `0` when the
/// system clock is set before 1970-01-01 (in practice unreachable on the
/// platforms Tauri supports, but we treat it as a non-fatal fallback to
/// avoid panicking inside menu rebuild paths).
fn chrono_now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn push_keeps_dedup_and_caps_at_10() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("recent.json");
        let mut store = Store::load(&path);
        for i in 0..15 {
            store.push(&format!("/tmp/{i}.pptx"));
        }
        assert_eq!(store.entries.len(), 10);
        assert_eq!(store.entries[0].path, "/tmp/14.pptx");
    }

    #[test]
    fn dedup_promotes_to_top() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("recent.json");
        let mut store = Store::load(&path);
        store.push("/tmp/a.pptx");
        store.push("/tmp/b.pptx");
        store.push("/tmp/a.pptx");
        assert_eq!(store.entries[0].path, "/tmp/a.pptx");
        assert_eq!(store.entries.len(), 2);
    }
}
