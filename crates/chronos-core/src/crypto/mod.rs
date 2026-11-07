//! Primitivos criptográficos. Solo envuelve bibliotecas auditadas de RustCrypto:
//! no se implementa ningún algoritmo propio.
//!
//! * `kdf`: Argon2id (contraseña → clave maestra) + HKDF-SHA256 (subclaves).
//! * `aead`: XChaCha20-Poly1305 (cifrado autenticado).
//! * `random`: CSPRNG del sistema operativo (`getrandom`).

pub mod aead;
pub mod kdf;
pub mod random;

use zeroize::Zeroizing;

/// Longitud de todas las claves simétricas (256 bits).
pub const KEY_LEN: usize = 32;

/// Clave simétrica que se borra de la memoria al liberarse.
pub type SecretKey = Zeroizing<[u8; KEY_LEN]>;

/// Codifica bytes en hexadecimal en un búfer que se borra al liberarse.
pub(crate) fn to_hex_zeroizing(bytes: &[u8]) -> Zeroizing<String> {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = Zeroizing::new(String::with_capacity(bytes.len() * 2));
    for b in bytes {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}

/// Hexadecimal para valores públicos (hashes).
pub(crate) fn to_hex(bytes: &[u8]) -> String {
    to_hex_zeroizing(bytes).to_string()
}
