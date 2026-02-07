use crate::state::phone_state::PhoneState;
use crate::session::termination::{SessionTermination, SessionStatus};

/// Orchestrator hanya menjembatani engine.
/// TIDAK tahu payment.
/// TIDAK tahu user.
pub struct SessionOrchestrator {
    pub active: bool,
}

impl SessionOrchestrator {
    pub fn new() -> Self {
        Self { active: true }
    }

    pub fn step(&mut self, state: &mut PhoneState, dt: f64) -> SessionStatus {
        if !self.active {
            return SessionStatus {
                terminated: true,
                reason: None,
            };
        }

        // engine berjalan normal
        // physics / faults / measurement dipanggil DI LUAR orchestrator

        let status = SessionTermination::evaluate(state);

        if status.terminated {
            self.active = false;
        }

        status
    }

    /// UI BOLEH memanggil ini kapan saja
    /// Engine tidak tahu kenapa
    pub fn force_stop(&mut self) {
        self.active = false;
    }
}
