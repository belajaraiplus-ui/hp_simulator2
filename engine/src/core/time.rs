pub struct SimTime {
    pub current: f64,
}

impl SimTime {
    pub fn new() -> Self {
        Self { current: 0.0 }
    }

    pub fn advance(&mut self, dt: f64) {
        self.current += dt;
    }
}
