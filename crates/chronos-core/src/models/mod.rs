//! Modelos de dominio compartidos entre repositorios, servicios y comandos.

pub mod calendar;

pub use calendar::{Calendar, CalendarPatch, NewCalendar};
