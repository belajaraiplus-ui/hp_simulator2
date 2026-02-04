use rand::{Rng, SeedableRng};
use rand::rngs::StdRng;

pub struct SimRng {
    rng: StdRng,
}

impl SimRng {
    pub fn new(seed: u64) -> Self {
        Self {
            rng: StdRng::seed_from_u64(seed),
        }
    }

    pub fn f64(&mut self) -> f64 {
        self.rng.r#gen()
    }
}
