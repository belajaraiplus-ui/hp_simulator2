import fs from 'fs';
import path from 'path';

/**
 * Skrip ini memvalidasi integritas referensi termal antar file metadata board.
 * Aturan:
 * 1. Jika rail memiliki field 'thermal_zone', nilainya harus berupa string.
 * 2. Nilai 'thermal_zone' harus terdaftar di thermal.json (zones[].id) atau bernilai "board".
 */

const BOARDS_DIR = path.resolve('assets/boards');

function validateThermalRefs() {
  const boards = fs.readdirSync(BOARDS_DIR);
  let totalErrors = 0;

  console.log('🔍 Memulai validasi integritas referensi termal...\n');

  boards.forEach(boardId => {
    const boardPath = path.join(BOARDS_DIR, boardId);
    if (!fs.statSync(boardPath).isDirectory()) return;

    const railsPath = path.join(boardPath, 'rails.json');
    const thermalPath = path.join(boardPath, 'thermal.json');

    // Skip jika salah satu file tidak ada
    if (!fs.existsSync(railsPath) || !fs.existsSync(thermalPath)) return;

    try {
      const railsData = JSON.parse(fs.readFileSync(railsPath, 'utf-8'));
      const thermalData = JSON.parse(fs.readFileSync(thermalPath, 'utf-8'));

      // Kumpulkan ID zona yang valid dari thermal.json
      const validZones = new Set(['board']);
      if (Array.isArray(thermalData.zones)) {
        thermalData.zones.forEach(z => validZones.add(z.id));
      }

      // Validasi setiap rail di rails.json
      if (Array.isArray(railsData.rails)) {
        railsData.rails.forEach(rail => {
          if (rail.thermal_zone !== undefined) {
            // 1. Pastikan tipe data adalah string
            if (typeof rail.thermal_zone !== 'string') {
              console.error(`❌ [${boardId}] Rail "${rail.id}": 'thermal_zone' harus berupa string.`);
              totalErrors++;
            } 
            // 2. Cross-file check: pastikan ID zona ada di thermal.json
            else if (!validZones.has(rail.thermal_zone)) {
              console.error(`❌ [${boardId}] Rail "${rail.id}": Referensi zona "${rail.thermal_zone}" tidak ditemukan di thermal.json.`);
              totalErrors++;
            }
          }
        });
      }
    } catch (e) {
      console.error(`❌ [${boardId}] Gagal membaca file JSON: ${e.message}`);
      totalErrors++;
    }
  });

  if (totalErrors > 0) {
    console.error(`\n🚨 Validasi gagal dengan ${totalErrors} error.`);
    process.exit(1);
  } else {
    console.log('✅ Semua referensi termal valid.');
  }
}

validateThermalRefs();