use crate::state::ids::RailId;

/// Satu item komponen di katalog board (mis. testpoint, capacitor, resistor).
///
/// Catatan:
/// - Semua field `&'static str` supaya bisa disimpan sebagai `const`/`static` tanpa alokasi.
/// - `rail` menghubungkan komponen ke domain daya / rail logika.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BoardComponentCatalogItem {
    pub id: &'static str,
    pub label: &'static str,
    pub rail: RailId,
}

impl BoardComponentCatalogItem {
    /// Constructor `const` supaya bisa dipakai di `const`/`static` tanpa overhead.
    #[inline]
    pub const fn new(id: &'static str, label: &'static str, rail: RailId) -> Self {
        Self { id, label, rail }
    }
}

/// Definisi profil board (nama + daftar komponen).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BoardProfile {
    pub id: &'static str,
    pub display_name: &'static str,
    pub components: &'static [BoardComponentCatalogItem],
}

impl BoardProfile {
    /// Constructor `const` untuk membuat profile sebagai `const`.
    #[inline]
    pub const fn new(
        id: &'static str,
        display_name: &'static str,
        components: &'static [BoardComponentCatalogItem],
    ) -> Self {
        Self {
            id,
            display_name,
            components,
        }
    }

    /// Lookup komponen by `id` (case-sensitive). Cocok untuk API/UI/telemetry.
    #[inline]
    pub fn component_by_id(&self, id: &str) -> Option<&'static BoardComponentCatalogItem> {
        // Linear scan: cukup cepat untuk list kecil/menengah.
        // Jika komponen sudah ratusan+ dan lookup sering, pertimbangkan indexing (phf/HashMap).
        self.components.iter().find(|c| c.id == id)
    }

    /// Iter semua komponen pada `rail` tertentu.
    #[inline]
    pub fn components_by_rail(
        &self,
        rail: RailId,
    ) -> impl Iterator<Item = &'static BoardComponentCatalogItem> + '_ {
        self.components.iter().filter(move |c| c.rail == rail)
    }

    /// Validasi ringan untuk menjaga kualitas data.
    ///
    /// Cocok dipanggil di unit test atau saat startup (debug build) untuk mendeteksi:
    /// - profile id/display_name kosong
    /// - component id kosong
    /// - component id duplikat
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.id.is_empty() {
            return Err("BoardProfile.id must not be empty");
        }
        if self.display_name.is_empty() {
            return Err("BoardProfile.display_name must not be empty");
        }

        // Uniqueness check (O(n^2)), aman karena ukuran biasanya kecil.
        for i in 0..self.components.len() {
            let a = self.components[i].id;
            if a.is_empty() {
                return Err("BoardComponentCatalogItem.id must not be empty");
            }
            for j in (i + 1)..self.components.len() {
                if a == self.components[j].id {
                    return Err("Duplicate component id found in profile");
                }
            }
        }

        Ok(())
    }
}

// Helper macro biar deklarasi komponen lebih ringkas & konsisten.
macro_rules! comp {
    ($id:literal, $label:literal, $rail:expr) => {
        BoardComponentCatalogItem::new($id, $label, $rail)
    };
}

pub const A52_INSPIRED_COMPONENTS: &[BoardComponentCatalogItem] = &[
    comp!("tp_vbat", "TP_VBAT", RailId::Vbat),
    comp!("tp_vcore", "TP_VCORE", RailId::Vcore),
    comp!("tp_vio", "TP_VIO", RailId::Vio),
    comp!("c_vbat_in", "C_VBAT_IN", RailId::Vbat),
    comp!("c_vcore_out", "C_VCORE_OUT", RailId::Vcore),
    comp!("r_vcore_fb", "R_VCORE_FB", RailId::Vcore),
    comp!("r_vbat_sense", "R_VBAT_SENSE", RailId::Vbat),
    comp!("j_vbat_main", "J_VBAT_MAIN", RailId::Vbat),
    comp!("j_vcore_phase", "J_VCORE_PHASE", RailId::Vcore),
];

pub const A52_INSPIRED_PROFILE: BoardProfile = BoardProfile::new(
    "a52_inspired_v1",
    "A52 Inspired Service Board",
    A52_INSPIRED_COMPONENTS,
);

/// Profile aktif (bisa dikembangkan jadi multi-profile + selection via cfg/env).
#[inline]
pub fn active_profile() -> &'static BoardProfile {
    &A52_INSPIRED_PROFILE
}
