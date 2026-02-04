#[derive(Clone, Copy, PartialEq)]
pub enum SessionStatus {
    Running,
    Terminated,
}

#[derive(Clone, Debug)]
pub enum SessionEndReason {
    UserStop,
    PermanentDamage,
    ThermalRunaway,
}

#[derive(Clone)]
pub struct SessionEvent {
    pub time: f64,
    pub message: String,
    pub severity: EventSeverity,
}

#[derive(Clone)]
pub enum EventSeverity {
    Info,
    Warning,
    Critical,
}
