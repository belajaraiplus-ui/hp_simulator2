# Task Progress Tracker

## Completed Tasks

### 1. Add data_space field to board.json files
- [x] Created `tools/normalize-data-space.mjs` script
- [x] Updated all 6 board.json files with data_space field:
  - hp_15_da0xx_mb_v1
  - hp_15s_du1xxx
  - hp_250_g7
  - hp_chromebook_14
  - hp_elitebook_840
  - hp_pavilion_x360

### 2. Update validate-board.mjs
- [x] Change probe bounds to use data_space instead of image
- [x] Add validateOverlayBounds function
- [x] Call validateOverlayBounds in rail validation loop
- [x] Add contract enforcement for board.json (REQUIRED fields)
- [x] Add unique rail ID validation
- [x] Add expected voltage consistency check (voltage_v vs expected_range)
- [x] Add depends_on validation (must contain valid rail IDs)
- [x] Add probe_points[].id unique per rail validation
- [x] Add overlay format warning (recommend { "polys": [...] })

### 3. Run validation
- [x] All 6 boards validated successfully

## Status: COMPLETE ✅
