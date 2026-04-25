const ZKLib = require('zkteco-js');
const fs = require('fs');
const path = require('path');

const DEVICES = [
  { name: 'Device-1', ip: '192.168.8.233', port: 4370, dump: 'device-data/dump-192_168_8_233-2026-04-18T18-22-44.json' },
  { name: 'Device-2', ip: '192.168.8.100', port: 4370, dump: 'device-data/dump-192_168_8_100-2026-04-18T18-22-44.json' },
];

const DRY_RUN = process.argv.includes('--dry-run');
const TIMEOUT = 10000;

// Load zero-id mapping: 23 students
const mappingCsv = fs.readFileSync(path.join(__dirname, 'device-data/ids-zero-to-nine-mapping.csv'), 'utf8').replace(/^\uFEFF/, '');
const mappingLines = mappingCsv.trim().split('\n').slice(1);
const mapping = mappingLines.map(l => {
  const m = l.match(/^([^,]+),([^,]+),"([^"]*)",(\d+),([YN-]),([YN-])$/);
  return m ? { oldId: m[1], newId: m[2], name: m[3] } : null;
}).filter(Boolean);

const oldToNew = new Map(mapping.map(m => [m.oldId, m.newId]));

console.log(`\n[*] Loaded ${mapping.length} mappings to apply`);
console.log(`[*] Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE UPDATE'}`);

async function updateDevice(dev) {
  console.log(`\n=== ${dev.name} (${dev.ip}) ===`);

  const dump = JSON.parse(fs.readFileSync(path.join(__dirname, dev.dump), 'utf8'));
  const users = dump.users || [];

  // Find matching users (by old userId)
  const toUpdate = users.filter(u => oldToNew.has(String(u.userId)));
  console.log(`[i] Found ${toUpdate.length}/${mapping.length} matching users on this device`);

  if (toUpdate.length === 0) return { success: 0, failed: 0, skipped: 0 };

  const zk = new ZKLib(dev.ip, dev.port, TIMEOUT, 4000);

  try {
    await zk.createSocket();
    console.log('[+] Connected');

    let success = 0, failed = 0;
    const errors = [];

    for (const u of toUpdate) {
      const oldId = String(u.userId);
      const newId = oldToNew.get(oldId);

      if (DRY_RUN) {
        console.log(`  [dry] uid=${u.uid} "${u.name}" ${oldId} → ${newId}`);
        continue;
      }

      try {
        await zk.setUser(
          u.uid,                 // keep same internal uid → fingerprint stays linked
          newId,                 // new userId
          u.name || '',
          u.password || '',
          u.role || 0,
          u.cardno || 0
        );
        console.log(`  ✓ uid=${u.uid} "${u.name}" ${oldId} → ${newId}`);
        success++;
      } catch (err) {
        console.log(`  ✗ uid=${u.uid} "${u.name}" ${oldId} → ${newId}: ${err.message || err}`);
        failed++;
        errors.push({ uid: u.uid, name: u.name, oldId, newId, error: err.message || String(err) });
      }
    }

    await zk.disconnect();
    return { success, failed, skipped: DRY_RUN ? toUpdate.length : 0, errors };
  } catch (err) {
    console.log(`[!] Connection error: ${err.message || err}`);
    try { await zk.disconnect(); } catch {}
    return { success: 0, failed: toUpdate.length, error: err.message || String(err) };
  }
}

(async () => {
  const results = {};
  for (const dev of DEVICES) {
    results[dev.name] = await updateDevice(dev);
  }

  console.log('\n========== RESULT ==========');
  for (const [name, r] of Object.entries(results)) {
    console.log(`${name}: success=${r.success} failed=${r.failed}` + (r.skipped ? ` skipped=${r.skipped}` : ''));
    if (r.errors?.length) {
      console.log(`  Errors (${r.errors.length}):`);
      r.errors.slice(0, 5).forEach(e => console.log(`    - ${e.oldId}→${e.newId}: ${e.error}`));
    }
  }

  const logFile = path.join(__dirname, 'device-data', `update-log-${Date.now()}.json`);
  fs.writeFileSync(logFile, JSON.stringify(results, null, 2), 'utf8');
  console.log(`\n[✓] Log saved: ${logFile}`);
})();
