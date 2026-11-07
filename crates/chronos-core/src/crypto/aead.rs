//! Cifrado autenticado con XChaCha20-Poly1305.
//!
//! El nonce de 192 bits se genera aleatoriamente en cada cifrado, de modo que
//! la probabilidad de repetirlo con la misma clave es despreciable.

use super::SecretKey;
use crate::error::{CoreError, Result};
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    Key, XChaCha20Poly1305, XNonce,
};
use zeroize::Zeroizing;

pub const ALGORITHM: &str = "xchacha20poly1305";
pub const NONCE_LEN: usize = 24;
pub const TAG_LEN: usize = 16;

/// Genera un nonce aleatorio.
pub fn random_nonce() -> Result<[u8; NONCE_LEN]> {
    super::random::bytes::<NONCE_LEN>()
}

/// Cifra y autentica `plaintext`; `aad` queda autenticado pero no cifrado.
/// Devuelve texto cifrado + etiqueta de 16 bytes.
pub fn seal(
    key: &SecretKey,
    nonce: &[u8; NONCE_LEN],
    aad: &[u8],
    plaintext: &[u8],
) -> Result<Vec<u8>> {
    let cipher = XChaCha20Poly1305::new(Key::from_slice(key.as_ref()));
    cipher
        .encrypt(
            XNonce::from_slice(nonce),
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|_| CoreError::Crypto)
}

/// Descifra y verifica. Falla con `CoreError::Crypto` si la clave es
/// incorrecta o si el texto cifrado o los datos asociados fueron alterados.
pub fn open(
    key: &SecretKey,
    nonce: &[u8; NONCE_LEN],
    aad: &[u8],
    ciphertext: &[u8],
) -> Result<Zeroizing<Vec<u8>>> {
    let cipher = XChaCha20Poly1305::new(Key::from_slice(key.as_ref()));
    cipher
        .decrypt(
            XNonce::from_slice(nonce),
            Payload {
                msg: ciphertext,
                aad,
            },
        )
        .map(Zeroizing::new)
        .map_err(|_| CoreError::Crypto)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::random;

    #[test]
    fn roundtrip_and_tamper_detection() {
        let key = random::secret_key().unwrap();
        let nonce = random_nonce().unwrap();
        let ct = seal(&key, &nonce, b"aad", b"hola").unwrap();
        assert_eq!(ct.len(), 4 + TAG_LEN);
        assert_eq!(open(&key, &nonce, b"aad", &ct).unwrap().as_slice(), b"hola");

        // AAD alterado
        assert!(open(&key, &nonce, b"aaD", &ct).is_err());
        // Texto cifrado alterado
        let mut bad = ct.clone();
        bad[0] ^= 1;
        assert!(open(&key, &nonce, b"aad", &bad).is_err());
        // Clave incorrecta
        let other = random::secret_key().unwrap();
        assert!(open(&other, &nonce, b"aad", &ct).is_err());
    }
}
