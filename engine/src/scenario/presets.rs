use crate::scenario::scenario::Scenario;
use crate::world::presets::*;
use crate::world::profile::WorldProfile;

// =======================
// SCENARIO 1 — POWER DRAIN INTERMITTENT
// =======================

pub const SCENARIO_POWER_DRAIN_INTERMITTENT: Scenario = Scenario {
    id: "power_drain_intermit",
    title: "Baterai Boros, Kadang Mati",

    customer_complaint:
        "HP cepat habis baterai. Kadang mati sendiri, tapi kalau dicas lama normal lagi.",

    background_story:
        "Perangkat sudah pernah ganti baterai di tempat lain. \
         Pemilik sering pakai charger mobil murah.",

    world: &HOT_HUMID_WORKSHOP,

    tool_limit: Some(
        "Multimeter & PSU tersedia. Oscilloscope sering dipakai teknisi senior, tapi sedang dipinjam."
    ),

    time_pressure: Some(
        "Pemilik menunggu dan ingin hasil cepat."
    ),

    notes:
        "Interaksi antara riwayat servis pihak ketiga dan penggunaan charger non-standar menciptakan noise pada data arus.",
};

// =======================
// SCENARIO 2 — CHARGING ANOMALY
// =======================

pub const SCENARIO_FAKE_CHARGING_DROP: Scenario = Scenario {
    id: "fake_charging_drop",
    title: "Indikator Cas Ada, Baterai Tetap Drop",

    customer_complaint: "Kalau dicas ada tanda petir, tapi persentase tidak naik. \
         Kadang dari 80% tiba-tiba turun ke 20%.",

    background_story: "Perangkat sering dicas di mobil dan power bank murah. \
         Pernah mati total lalu hidup lagi setelah dicas lama.",

    world: &PREVIOUSLY_REPAIRED_DEVICE,

    tool_limit: Some(
        "PSU bench tersedia, tapi kabel USB sering longgar. \
         Oscilloscope ada, namun jarang dipakai untuk charging case.",
    ),

    time_pressure: Some("Pemilik butuh cepat karena perangkat dipakai untuk kerja."),

    notes: "Anomali pada indikator vs realitas pengisian sering kali mengaburkan batas antara kerusakan hardware dan kegagalan logika proteksi.",
};

// =======================
// SCENARIO 3 — WATER DAMAGE PROGRESSIVE
// =======================

pub const SCENARIO_WATER_DAMAGE_PROGRESSIVE: Scenario = Scenario {
    id: "water_damage_progressive",
    title: "Bekas Air, Masih Nyala",

    customer_complaint:
        "HP kadang mati sendiri. Setelah dikeringkan sempat normal, tapi sekarang makin sering bermasalah.",

    background_story:
        "Perangkat pernah terkena air hujan beberapa minggu lalu. Tidak langsung mati, hanya dikeringkan tanpa dibongkar.",

    world: &HOT_HUMID_WORKSHOP,

    tool_limit: Some(
        "Multimeter & PSU tersedia. Tidak ada ultrasonic cleaner di workshop ini."
    ),

    time_pressure: Some(
        "Pemilik ragu apakah perangkat ini masih layak dipertahankan."
    ),

    notes: "Korosi mikro bersifat progresif. Pengukuran elektrikal mungkin memberikan hasil yang berubah-ubah tergantung pada suhu dan kelembapan saat ini.",
};

/// =======================
/// SCENARIO 3 — RF / NO SERVICE
/// =======================

pub const SCENARIO_NO_SERVICE_INTERMITTENT: Scenario = Scenario {
    id: "rf_no_service_intermittent",
    title: "No Service, Sinyal Kadang Muncul",

    customer_complaint:
        "SIM terbaca, tapi tidak ada sinyal. Kadang muncul sebentar lalu hilang lagi.",

    background_story: "Perangkat pernah jatuh dan lama dipakai panas. \
         Pernah diservis ringan tanpa catatan jelas.",

    // RF sangat sensitif terhadap panas, ground, dan noise
    world: &HOT_HUMID_WORKSHOP,

    tool_limit: Some(
        "Multimeter & PSU tersedia. Oscilloscope ada tapi jarang dipakai untuk RF. \
         Tidak ada RF tester khusus.",
    ),

    time_pressure: Some("Pemilik ingin cepat karena perangkat dipakai untuk komunikasi utama."),

    notes: "Sinyal radio sangat bergantung pada integritas ground. Pengukuran pada titik test point dapat mengubah impedansi jalur dan memberikan hasil palsu.",
};

/// =======================
/// RF-SPECIFIC WORLD PROFILE
/// =======================
///
/// Dunia yang "tidak ramah RF":
/// - noise floor tinggi
/// - ground rapuh
/// - margin logic sempit
/// - false stability sering terjadi
///
/// Tidak menyebabkan fault,
/// tapi mempersempit ruang aman sistem.
pub const RF_UNSTABLE_ENVIRONMENT: WorldProfile = WorldProfile {
    name: "RF_UNSTABLE_ENVIRONMENT",

    // Lingkungan
    ambient_temperature: 34.0,
    humidity_factor: 0.78,
    emi_noise_floor: 0.08,

    // Riwayat perangkat / kualitas listrik
    device_age_factor: 0.35,
    prior_repair_factor: 0.45,
    psu_quality: 0.78,
    ground_integrity: 0.72,

    // Termal & observability
    thermal_dissipation: 0.82,
    thermal_coupling: 1.35,
    measurement_bias: 0.25,
};
