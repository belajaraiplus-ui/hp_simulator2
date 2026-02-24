// engine/src/core/rng.rs
// Deterministic RNG for simulator. Small, fast, seedable.
// Use via `state.rng.f64()` or `state.rng.u64()`
// Do NOT use OS randomness in wasm runtime.

#[derive(Clone, Debug)]
pub struct SimRng {
    state: u64,
}

impl Default for SimRng {
    fn default() -> Self {
        SimRng::new(12345)
    }
}

impl SimRng {
    /// Create RNG with a seed. Zero seeds are allowed; if zero, jump to nonzero state.
    pub fn new(mut seed: u64) -> Self {
        if seed == 0 {
            // avoid zero-state for xorshift*
            seed = 0x9E3779B97F4A7C15u64;
        }
        // Run a few rounds of splitmix64 to warm state
        let mut z = seed + 0x9e3779b97f4a7c15u64;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58476d1ce4e5b9u64);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d049bb133111ebu64);
        z ^= z >> 31;
        SimRng { state: z }
    }

    /// Return next u64
    #[inline]
    pub fn u64(&mut self) -> u64 {
        // xorshift64* variant
        let mut x = self.state;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.state = x;
        x.wrapping_mul(2685821657736338717u64)
    }

    /// Return float in [0,1)
    #[inline]
    pub fn f64(&mut self) -> f64 {
        // use top 53 bits
        let v = self.u64() >> 11; // 53 bits
        (v as f64) / ((1u64 << 53) as f64)
    }

    /// Convenience: draw boolean with probability p (0.0..1.0)
    #[inline]
    pub fn bernoulli(&mut self, p: f64) -> bool {
        debug_assert!(p >= 0.0 && p <= 1.0);
        self.f64() < p
    }
}
