/**
 * Simulation script — Station 2 (Trạm Sông Hàn)
 *
 * Behaviour:
 *  - Ramps water level from 0 → 180 cm over ~4 minutes (posts every 2 s)
 *  - After 2 minutes of running: posts one fire rescue point at the station location
 *  - Flood-level thresholds for station 2: safe < 45, caution < 90, warning < 140, danger ≥ 140
 *
 * Usage:
 *   node test/simulate_station2.js [SERVER_URL]
 *
 * Example:
 *   node test/simulate_station2.js http://localhost:3000
 */

const SERVER_URL = process.argv[2] || 'http://localhost:3000';
const WATER_URL  = `${SERVER_URL}/api/water-level`;
const RESCUE_URL = `${SERVER_URL}/api/rescue-points`;

// Station 2 — Trạm Sông Hàn
const STATION_ID  = 2;

// Fire rescue point location (independent of the station)
const FIRE_LAT = 16.074623;
const FIRE_LNG = 108.229075;

const POST_INTERVAL_MS   = 2000;   // post water level every 2 s
const FIRE_TRIGGER_MS    = 2 * 60 * 1000; // post fire point after 2 minutes
const MAX_WATER_LEVEL    = 180;    // cm — peaks above "danger" threshold (140)
const RAMP_DURATION_MS   = 4 * 60 * 1000; // ramp from 0 → MAX over 4 minutes

let startTime = Date.now();
let firePosted = false;
let tick = 0;

// ── Helpers ───────────────────────────────────────────────────────────────────

function elapsed() {
    const ms = Date.now() - startTime;
    const m  = String(Math.floor(ms / 60000)).padStart(2, '0');
    const s  = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
    return `[${m}:${s}]`;
}

// Smooth sine-based ramp: 0 → peak → drops back down, looping
function computeWaterLevel() {
    const t = (Date.now() - startTime) / RAMP_DURATION_MS; // 0 → 1 over ramp duration
    // Use a sine wave so the level rises and falls naturally
    const level = MAX_WATER_LEVEL * Math.max(0, Math.sin(t * Math.PI));
    return parseFloat(level.toFixed(2));
}

function floodStatus(level) {
    if (level < 45)  return '🟢 safe';
    if (level < 90)  return '🟡 caution';
    if (level < 140) return '🟠 warning';
    return '🔴 danger';
}

async function post(url, body) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    return res.json();
}

// ── Water level posting ───────────────────────────────────────────────────────

async function postWaterLevel() {
    const level = computeWaterLevel();
    try {
        const data = await post(WATER_URL, { station_id: STATION_ID, water_level: level });
        const status = data.data?.status || '?';
        console.log(`${elapsed()} 💧 Water level: ${level.toFixed(2)} cm  ${floodStatus(level)}  (server status: ${status})`);
    } catch (err) {
        console.error(`${elapsed()} ❌ Water POST failed:`, err.message);
    }
}

// ── Fire rescue point posting ─────────────────────────────────────────────────

async function postFirePoint() {
    console.log(`\n${elapsed()} 🔥 Triggering fire rescue point at (${FIRE_LAT}, ${FIRE_LNG})...\n`);
    try {
        const data = await post(RESCUE_URL, {
            lat:     FIRE_LAT,
            lng:     FIRE_LNG,
            urgency: 'critical',
            type:    'fire',
            notes:   '[TEST] Phát hiện hỏa hoạn mô phỏng'
        });
        if (data.duplicate) {
            console.log(`${elapsed()} ⚠️  Fire point already exists (duplicate), not re-inserted.`);
        } else {
            console.log(`${elapsed()} ✅ Fire rescue point created — id: ${data.data?.id}`);
        }
    } catch (err) {
        console.error(`${elapsed()} ❌ Fire POST failed:`, err.message);
    }
    console.log('');
}

// ── Main loop ─────────────────────────────────────────────────────────────────

async function checkFireTrigger() {
    if (!firePosted && Date.now() - startTime >= FIRE_TRIGGER_MS) {
        firePosted = true;
        await postFirePoint();
    }
}

console.log('='.repeat(60));
console.log(' Flood Mapper — Station 2 simulation');
console.log(`  Server   : ${SERVER_URL}`);
console.log(`  Station  : ${STATION_ID} (Trạm Sông Hàn)`);
console.log(`  Interval : ${POST_INTERVAL_MS / 1000}s water level posts`);
console.log(`  Fire     : triggered after ${FIRE_TRIGGER_MS / 60000} minute(s)`);
console.log('='.repeat(60));
console.log('Press Ctrl+C to stop.\n');

// Post immediately on start, then every POST_INTERVAL_MS
postWaterLevel();
const interval = setInterval(async () => {
    tick++;
    await checkFireTrigger();
    await postWaterLevel();
}, POST_INTERVAL_MS);

// Graceful shutdown
process.on('SIGINT', () => {
    clearInterval(interval);
    console.log(`\n${elapsed()} ⏹  Simulation stopped after ${tick} posts.`);
    process.exit(0);
});
