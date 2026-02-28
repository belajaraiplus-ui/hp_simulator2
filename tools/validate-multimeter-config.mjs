import fs from 'fs';
import path from 'path';

/**
 * Skrip ini memvalidasi konfigurasi multimeter dan rail di board metadata.
 * Aturan:
 * 1. Setiap rail harus memiliki id yang valid (string non-kosong)
 * 2. Rail ID tidak boleh duplikat
 * 3. Jika rail memiliki probe_points, setiap point harus memiliki id dan koordinat
 * 4. Expected voltage ranges harus valid (min < max)
 * 5. Rail type harus valid (input, power, core, system, logic, peripheral)
 */

const BOARDS_DIR = path.resolve('assets/boards');
const VALID_RAIL_TYPES = new Set(['input', 'power', 'core', 'system', 'logic', 'peripheral']);

function validateRailConfig() {
  const boards = fs.readdirSync(BOARDS_DIR);
  let totalErrors = 0;
  let totalWarnings = 0;

  console.log('🔍 Memulai validasi konfigurasi multimeter & rail...\n');

  boards.forEach(boardId => {
    const boardPath = path.join(BOARDS_DIR, boardId);
    if (!fs.statSync(boardPath).isDirectory()) return;

    const railsPath = path.join(boardPath, 'rails.json');
    if (!fs.existsSync(railsPath)) {
      console.warn(`⚠️  [${boardId}] rails.json tidak ditemukan, skip.`);
      return;
    }

    try {
      const railsData = JSON.parse(fs.readFileSync(railsPath, 'utf-8'));
      const rails = railsData.rails;

      if (!Array.isArray(rails) || rails.length === 0) {
        console.warn(`⚠️  [${boardId}] Tidak ada rails yang didefinisikan.`);
        return;
      }

      const seenRailIds = new Set();
      const seenProbeIds = new Set();

      rails.forEach((rail, index) => {
        // 1. Validasi Rail ID
        if (!rail.id) {
          console.error(`❌ [${boardId}] Rail pada index ${index}: 'id' wajib ada.`);
          totalErrors++;
          return;
        }

        if (typeof rail.id !== 'string' || rail.id.trim() === '') {
          console.error(`❌ [${boardId}] Rail "${rail.id}": 'id' harus berupa string non-kosong.`);
          totalErrors++;
          return;
        }

        // Check duplicate
        if (seenRailIds.has(rail.id)) {
          console.error(`❌ [${boardId}] Rail ID duplikat: "${rail.id}"`);
          totalErrors++;
        }
        seenRailIds.add(rail.id);

        // 2. Validasi Rail Type
        if (rail.type && !VALID_RAIL_TYPES.has(rail.type)) {
          console.warn(`⚠️  [${boardId}] Rail "${rail.id}": type "${rail.type}" tidak valid.`);
          totalWarnings++;
        }

        // 3. Validasi Expected Values
        if (rail.expected) {
          const exp = rail.expected;

          // Voltage range
          if (exp.voltage_v) {
            if (typeof exp.voltage_v.min !== 'number' || typeof exp.voltage_v.max !== 'number') {
              console.error(`❌ [${boardId}] Rail "${rail.id}": voltage_v.min dan max harus number.`);
              totalErrors++;
            } else if (exp.voltage_v.min >= exp.voltage_v.max) {
              console.error(`❌ [${boardId}] Rail "${rail.id}": voltage_v.min harus < max.`);
              totalErrors++;
            }
          }

          // Diode drop range
          if (exp.diode_drop_v) {
            if (typeof exp.diode_drop_v.min !== 'number' || typeof exp.diode_drop_v.max !== 'number') {
              console.error(`❌ [${boardId}] Rail "${rail.id}": diode_drop_v.min dan max harus number.`);
              totalErrors++;
            } else if (exp.diode_drop_v.min >= exp.diode_drop_v.max) {
              console.error(`❌ [${boardId}] Rail "${rail.id}": diode_drop_v.min harus < max.`);
              totalErrors++;
            }
          }

          // R2G resistance
          if (exp.r2g_ohms && typeof exp.r2g_ohms.nominal !== 'number') {
            console.error(`❌ [${boardId}] Rail "${rail.id}": r2g_ohms.nominal harus number.`);
            totalErrors++;
          }

          // Continuity thresholds
          if (exp.continuity) {
            if (typeof exp.continuity.beep_below_ohms !== 'number' || 
                typeof exp.continuity.open_above_ohms !== 'number') {
              console.error(`❌ [${boardId}] Rail "${rail.id}": continuity thresholds harus number.`);
              totalErrors++;
            } else if (exp.continuity.beep_below_ohms >= exp.continuity.open_above_ohms) {
              console.error(`❌ [${boardId}] Rail "${rail.id}": beep_below_ohms harus < open_above_ohms.`);
              totalErrors++;
            }
          }
        }

        // 4. Validasi Probe Points
        if (rail.probe_points && Array.isArray(rail.probe_points)) {
          rail.probe_points.forEach((tp, tpIndex) => {
            if (!tp.id) {
              console.error(`❌ [${boardId}] Rail "${rail.id}": probe_point pada index ${tpIndex} wajib memiliki 'id'.`);
              totalErrors++;
              return;
            }

            if (seenProbeIds.has(tp.id)) {
              console.error(`❌ [${boardId}] Probe ID duplikat: "${tp.id}"`);
              totalErrors++;
            }
            seenProbeIds.add(tp.id);

            if (typeof tp.x !== 'number' || typeof tp.y !== 'number') {
              console.error(`❌ [${boardId}] Probe "${tp.id}": koordinat x dan y wajib number.`);
              totalErrors++;
            }

            if (tp.label && typeof tp.label !== 'string') {
              console.error(`❌ [${boardId}] Probe "${tp.id}": label harus string.`);
              totalErrors++;
            }
          });
        }

        // 5. Validasi depends_on
        if (rail.depends_on) {
          if (Array.isArray(rail.depends_on)) {
            rail.depends_on.forEach(dep => {
              if (!seenRailIds.has(dep) && dep !== rail.id) {
                console.warn(`⚠️  [${boardId}] Rail "${rail.id}": depends_on "${dep}" tidak ditemukan.`);
                totalWarnings++;
              }
            });
          } else {
            console.error(`❌ [${boardId}] Rail "${rail.id}": depends_on harus array.`);
            totalErrors++;
          }
        }
      });

      console.log(`✅ [${boardId}] ${rails.length} rails, ${seenProbeIds.size} probe points valid.`);

    } catch (e) {
      console.error(`❌ [${boardId}] Gagal membaca file JSON: ${e.message}`);
      totalErrors++;
    }
  });

  console.log('\n' + '='.repeat(50));
  if (totalErrors > 0) {
    console.error(`🚨 Validasi selesai: ${totalErrors} error${totalWarnings > 0 ? `, ${totalWarnings} warning` : ''}.`);
    process.exit(1);
  } else if (totalWarnings > 0) {
    console.warn(`⚠️  Validasi selesai: ${totalWarnings} warning.`);
  } else {
    console.log('✅ Semua konfigurasi rail dan multimeter valid.');
  }
}

validateRailConfig();
