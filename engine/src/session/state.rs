use crate::session::types::{SessionStatus, SessionEndReason, SessionEvent};

pub struct SessionState {
    pub status: SessionStatus,
    pub events: Vec<SessionEvent>,
    pub end_reason: Option<SessionEndReason>,
}

impl SessionState {
    pub fn new() -> Self {
        Self {
            status: SessionStatus::Running,
            events: Vec::new(),
            end_reason: None,
        }
    }

    pub fn emit(&mut self, time: f64, msg: &str, severity: crate::session::types::EventSeverity) {
        self.events.push(SessionEvent {
            time,
            message: msg.to_string(),
            severity,
        });
    }

    pub fn terminate(&mut self, reason: SessionEndReason) {
        self.status = SessionStatus::Terminated;
        self.end_reason = Some(reason);
    }
}
