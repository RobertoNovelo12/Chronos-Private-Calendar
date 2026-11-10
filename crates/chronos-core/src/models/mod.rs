//! Modelos de dominio compartidos entre repositorios, servicios y comandos.

pub mod calendar;
pub mod event;
pub mod label;
pub mod task;

pub use calendar::{Calendar, CalendarPatch, NewCalendar};
pub use event::{Event, EventPatch, NewEvent};
pub use label::{Label, LabelPatch, NewLabel};
pub use task::{NewTask, Task, TaskPatch};
