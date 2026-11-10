//! «Recordar el desbloqueo en este equipo» (opcional, desactivado por defecto).
//!
//! Guarda las claves de la bóveda en el almacén de credenciales del sistema:
//! Windows → Administrador de credenciales (cifrado con DPAPI, ligado a tu
//! cuenta de Windows); macOS → Llavero. Así Chronos se abre sin contraseña al
//! arrancar. En Linux no se ofrece.
//!
//! Límite honesto: cualquier programa que se ejecute con tu cuenta de usuario
//! podría leer esa credencial. La protección pasa a ser la de tu sesión del
//! sistema. Bloquear a mano o por inactividad sigue pidiendo la contraseña.

#[cfg(any(target_os = "windows", target_os = "macos"))]
mod imp {
    use keyring::Entry;
    use zeroize::Zeroizing;

    const SERVICE: &str = "io.github.robertonovelo12.chronos";
    const ACCOUNT: &str = "vault-unlock";

    fn entry() -> Option<Entry> {
        entry_for(ACCOUNT)
    }

    pub(super) fn entry_for(account: &str) -> Option<Entry> {
        Entry::new(SERVICE, account).ok()
    }

    pub fn supported() -> bool {
        true
    }

    pub fn load() -> Option<Zeroizing<Vec<u8>>> {
        entry()?.get_secret().ok().map(Zeroizing::new)
    }

    pub fn store(secret: &[u8]) -> Result<(), String> {
        entry()
            .ok_or_else(|| "almacén de credenciales no disponible".to_string())?
            .set_secret(secret)
            .map_err(|e| e.to_string())
    }

    pub fn forget() {
        if let Some(e) = entry() {
            let _ = e.delete_credential();
        }
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
mod imp {
    use zeroize::Zeroizing;

    pub fn supported() -> bool {
        false
    }
    pub fn load() -> Option<Zeroizing<Vec<u8>>> {
        None
    }
    pub fn store(_secret: &[u8]) -> Result<(), String> {
        Err("no disponible en este sistema".into())
    }
    pub fn forget() {}
}

pub use imp::{forget, load, store, supported};

/// ¿Hay un desbloqueo recordado guardado?
pub fn enabled() -> bool {
    load().is_some()
}

#[cfg(all(test, any(target_os = "windows", target_os = "macos")))]
mod tests {
    /// Ida y vuelta real en el almacén del sistema, con una cuenta de prueba que se borra.
    #[test]
    fn credential_store_roundtrip() {
        let e = super::imp::entry_for("vault-unlock-test").expect("almacén disponible");
        let secret: Vec<u8> = (0u8..65).collect();
        e.set_secret(&secret).unwrap();
        assert_eq!(e.get_secret().unwrap(), secret);
        e.delete_credential().unwrap();
        assert!(e.get_secret().is_err());
    }
}
