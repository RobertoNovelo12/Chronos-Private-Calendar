// Evita una consola extra en Windows en compilaciones de lanzamiento.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    chronos_desktop_lib::run();
}
