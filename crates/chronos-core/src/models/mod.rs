//! Modelos de dominio compartidos entre repositorios, servicios y comandos.

pub mod calendar;
pub mod event;

pub use calendar::{Calendar, CalendarPatch, NewCalendar};
pub use event::{Event, EventPatch, NewEvent};
