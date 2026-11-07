//! Utilidades de sistema de archivos.

use crate::error::Result;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

/// Escribe un archivo de forma atómica: primero en un temporal del mismo
/// directorio, lo sincroniza a disco y lo renombra sobre el destino. Un corte
/// de energía deja el archivo anterior intacto o el nuevo completo, nunca uno
/// a medias.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let tmp = temp_sibling(path);
    let result = (|| -> Result<()> {
        let mut f = OpenOptions::new().write(true).create_new(true).open(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        // En Windows `rename` reemplaza el destino (MoveFileExW con REPLACE_EXISTING).
        fs::rename(&tmp, path)?;
        sync_parent_dir(path);
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

fn temp_sibling(path: &Path) -> PathBuf {
    let mut suffix = [0u8; 6];
    // Si el CSPRNG fallara, un sufijo fijo sigue siendo válido gracias a create_new.
    let _ = crate::crypto::random::fill(&mut suffix);
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    path.with_file_name(format!(".{name}.{}.tmp", crate::crypto::to_hex(&suffix)))
}

#[cfg(unix)]
fn sync_parent_dir(path: &Path) {
    if let Some(parent) = path.parent() {
        if let Ok(dir) = fs::File::open(parent) {
            let _ = dir.sync_all();
        }
    }
}

#[cfg(not(unix))]
fn sync_parent_dir(_path: &Path) {}
