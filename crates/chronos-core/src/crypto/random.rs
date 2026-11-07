//! Generación de valores aleatorios con el CSPRNG del sistema operativo.

use super::{SecretKey, KEY_LEN};
use crate::error::{CoreError, Result};
use zeroize::Zeroizing;

/// Rellena `buf` con bytes aleatorios criptográficamente seguros.
pub fn fill(buf: &mut [u8]) -> Result<()> {
    getrandom::fill(buf).map_err(|_| CoreError::Crypto)
}

/// Devuelve un arreglo aleatorio de `N` bytes (sales, nonces).
pub fn bytes<const N: usize>() -> Result<[u8; N]> {
    let mut out = [0u8; N];
    fill(&mut out)?;
    Ok(out)
}

/// Genera una clave simétrica aleatoria de 256 bits.
pub fn secret_key() -> Result<SecretKey> {
    let mut key = Zeroizing::new([0u8; KEY_LEN]);
    fill(key.as_mut())?;
    Ok(key)
}
