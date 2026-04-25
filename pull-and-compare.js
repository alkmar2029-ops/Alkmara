const ZKLib = require('zkteco-js');
const fs = require('fs');
const path = require('path');

const DEVICES = [
  { name: 'Device-1', ip: '192.168.8.233', port: 4370 },
  { name: 'Device-2', ip: '192.168.8.100', port: 4370 },
];

const TIMEOUT = 8000;
const OUT_DIR = path.join(__dirname, 'device-data');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR);

function parseTemplateBuffer(buf) {
  const templates = [];
  let offset = 0;
  while (offset + 6 <= buf.length) {
    const size = buf.readUInt16LE(offset);
    if (size === 0 || offset + size > buf.length) break;
    const uid = buf.readUInt16LE(offset + 2);
    const fid = buf.readUInt8(offset + 4);
    const valid = buf.readUInt8(offset + 5);
    templates.push({ uid, fid, valid });
    offset += size;
  }
  return templates;
}

async function pullOne(dev) {
  const result = { device: dev, reachable: false, info: null, users: [], attendances: [], fingerTemplates: [], fingerCountPerUser: {}, error: null };
  const zk = new ZKLib(dev.ip, dev.port, TIMEOUT, 4000);

  try {
    console.log(`\n=== [${dev.name}] ${dev.ip}:${dev.port} ===`);
    await zk.createSocket();
    result.reachable = true;
    console.log('  [+] Connected');

    try {
      const info = await zk.getInfo();
      const deviceName = await zk.getDeviceName().catch(() => null);
      const serial = await zk.getSerialNumber().catch(() => null);
      const firmware = await zk.getDeviceVersion().catch(() => null);
      const mac = await zk.getMacAddress().catch(() => null);
      result.info = { ...info, deviceName, serial, firmware, mac };
      console.log(`  [i] ${deviceName} | SN:${serial} | FW:${firmware} | users=${info.userCounts} logs=${info.logCounts}`);
    } catch (e) { console.log(`  [!] info: ${e.message}`); }

    try {
      const u = await zk.getUsers();
      result.users = u?.data || [];
      console.log(`  [+] Users: ${result.users.length}`);
    } catch (e) { console.log(`  [!] users: ${e.message}`); }

    try {
      const a = await zk.getAttendances();
      result.attendances = a?.data || [];
      console.log(`  [+] Attendance: ${result.attendances.length}`);
    } catch (e) { console.log(`  [!] attendances: ${e.message}`); }

    // Extra: read raw free-sizes buffer to get fingerprint count (at standard offsets)
    try {
      const raw = await zk.ztcp.executeCmd(50, ''); // CMD_GET_FREE_SIZES
      if (raw && raw.length >= 80) {
        result.info = result.info || {};
        result.info.raw = {
          adminCount: raw.readUIntLE(16, 4),
          userCountX: raw.readUIntLE(24, 4),
          fingerCount: raw.readUIntLE(32, 4),
          logCountX: raw.readUIntLE(40, 4),
          passwordCount: raw.readUIntLE(48, 4),
          oplogCount: raw.readUIntLE(56, 4),
          userCapacity: raw.readUIntLE(64, 4),
          logCapacity: raw.readUIntLE(72, 4),
          fingerCapacity: raw.readUIntLE(56, 4),
        };
        console.log(`  [i] Admin:${result.info.raw.adminCount} Fingers:${result.info.raw.fingerCount} Pwds:${result.info.raw.passwordCount}`);
      }
    } catch (e) { console.log(`  [!] free-sizes: ${e.message}`); }

    // Try to pull per-user fingerprint templates via read_with_buffer.
    // pyzk pattern: pack('<bhii', 1, CMD_DB_RRQ=7, fct, ext) => 11 bytes
    const mkReq = (cmd, fct, ext) => {
      const b = Buffer.alloc(11);
      b.writeUInt8(1, 0);
      b.writeUInt16LE(cmd, 1);
      b.writeUInt32LE(fct, 3);
      b.writeUInt32LE(ext, 7);
      return b;
    };
    const variants = [
      { label: 'CMD_DB_RRQ fct=2 (FCT_FINGERTMP)', buf: mkReq(7, 2, 0) },
      { label: 'CMD_DB_RRQ fct=7', buf: mkReq(7, 7, 0) },
      { label: 'raw 0x01 0x07 0x00...', buf: Buffer.from([0x01, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]) },
    ];

    for (const v of variants) {
      try {
        const res = await zk.ztcp.readWithBuffer(v.buf);
        const raw = res?.data;
        if (!raw || raw.length < 8) { console.log(`  [.] ${v.label}: empty`); continue; }
        const body = raw.subarray(4);
        const tpls = parseTemplateBuffer(body);
        console.log(`  [.] ${v.label}: bytes=${raw.length} parsed=${tpls.length}`);
        if (tpls.length > 0) { result.fingerTemplates = tpls; break; }
      } catch (e) {
        console.log(`  [.] ${v.label}: ${e.message || e}`);
        // Socket might be broken; try to re-create for next variant
        try { await zk.disconnect(); } catch {}
        try { await zk.createSocket(); } catch { break; }
      }
    }

    if (result.fingerTemplates.length === 0) {
      console.log('  [!] Could not enumerate per-user templates; will use info.raw.fingerCount only');
    } else {
      for (const t of result.fingerTemplates) {
        result.fingerCountPerUser[t.uid] = (result.fingerCountPerUser[t.uid] || 0) + 1;
      }
      const withFp = Object.keys(result.fingerCountPerUser).length;
      console.log(`  [+] Fingerprint templates: ${result.fingerTemplates.length} across ${withFp} users`);
    }

    await zk.disconnect();
  } catch (err) {
    result.error = err.message || String(err);
    console.log(`  [x] ${result.error}`);
    try { await zk.disconnect(); } catch {}
  }

  return result;
}

(async () => {
  const results = [];
  for (const dev of DEVICES) {
    results.push(await pullOne(dev));
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  // Save each device dump
  for (const r of results) {
    if (r.reachable) {
      const suffix = r.device.ip.replace(/\./g, '_');
      fs.writeFileSync(path.join(OUT_DIR, `dump-${suffix}-${stamp}.json`), JSON.stringify(r, null, 2), 'utf8');
    }
  }

  // Build comparison
  const r1 = results[0];
  const r2 = results[1];

  const buildUserMap = (r) => {
    const m = new Map();
    for (const u of r.users) {
      m.set(String(u.userId || u.uid), { uid: u.uid, userId: String(u.userId || ''), name: u.name, hasFp: !!r.fingerCountPerUser[u.uid], fpCount: r.fingerCountPerUser[u.uid] || 0 });
    }
    return m;
  };

  const m1 = buildUserMap(r1);
  const m2 = buildUserMap(r2);

  const allIds = new Set([...m1.keys(), ...m2.keys()]);
  const rows = [];
  let onlyIn1 = 0, onlyIn2 = 0, inBoth = 0;
  let fpIn1 = 0, fpIn2 = 0, fpBoth = 0, fpNeither = 0;

  for (const id of allIds) {
    const a = m1.get(id);
    const b = m2.get(id);
    const on1 = a ? 'Y' : 'N';
    const on2 = b ? 'Y' : 'N';
    const fp1 = a ? (a.hasFp ? 'Y' : 'N') : '-';
    const fp2 = b ? (b.hasFp ? 'Y' : 'N') : '-';
    const fpc1 = a ? a.fpCount : 0;
    const fpc2 = b ? b.fpCount : 0;
    const name = a?.name || b?.name || '';

    if (a && b) inBoth++;
    else if (a) onlyIn1++;
    else onlyIn2++;

    if (a?.hasFp && b?.hasFp) fpBoth++;
    else if (a?.hasFp) fpIn1++;
    else if (b?.hasFp) fpIn2++;
    else fpNeither++;

    rows.push({ userId: id, name, on1, on2, fp1, fp2, fpc1, fpc2 });
  }

  // CSV
  const header = 'userId,name,onDevice1,onDevice2,hasFp_D1,hasFp_D2,fpCount_D1,fpCount_D2';
  const csvLines = [header];
  for (const r of rows) {
    csvLines.push([r.userId, `"${(r.name || '').replace(/"/g, '""')}"`, r.on1, r.on2, r.fp1, r.fp2, r.fpc1, r.fpc2].join(','));
  }
  fs.writeFileSync(path.join(OUT_DIR, `comparison-${stamp}.csv`), '\uFEFF' + csvLines.join('\n'), 'utf8');

  // Summary
  const summary = {
    timestamp: stamp,
    devices: results.map(r => ({
      name: r.device.name,
      ip: r.device.ip,
      reachable: r.reachable,
      error: r.error,
      deviceName: r.info?.deviceName,
      serial: r.info?.serial,
      firmware: r.info?.firmware,
      userCount: r.users.length,
      attendanceCount: r.attendances.length,
      usersWithFingerprint: Object.keys(r.fingerCountPerUser).length,
      totalFingerTemplates: r.fingerTemplates.length,
    })),
    comparison: {
      totalUniqueUsers: allIds.size,
      inBothDevices: inBoth,
      onlyInDevice1: onlyIn1,
      onlyInDevice2: onlyIn2,
      fingerprintsInBoth: fpBoth,
      fingerprintsOnlyInDevice1: fpIn1,
      fingerprintsOnlyInDevice2: fpIn2,
      noFingerprintAnywhere: fpNeither,
    },
  };

  fs.writeFileSync(path.join(OUT_DIR, `summary-${stamp}.json`), JSON.stringify(summary, null, 2), 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'latest-summary.json'), JSON.stringify(summary, null, 2), 'utf8');

  console.log('\n========== SUMMARY ==========');
  for (const d of summary.devices) {
    console.log(`${d.name} (${d.ip}): ${d.reachable ? 'OK' : 'FAIL - ' + d.error}`);
    if (d.reachable) {
      console.log(`  users=${d.userCount}  usersWithFP=${d.usersWithFingerprint}  fpTemplates=${d.totalFingerTemplates}  attendance=${d.attendanceCount}`);
    }
  }
  console.log('\n--- Comparison ---');
  console.log(`Total unique users: ${summary.comparison.totalUniqueUsers}`);
  console.log(`In both devices:    ${summary.comparison.inBothDevices}`);
  console.log(`Only in Device 1:   ${summary.comparison.onlyInDevice1}`);
  console.log(`Only in Device 2:   ${summary.comparison.onlyInDevice2}`);
  console.log(`FP in both:         ${summary.comparison.fingerprintsInBoth}`);
  console.log(`FP only on D1:      ${summary.comparison.fingerprintsOnlyInDevice1}`);
  console.log(`FP only on D2:      ${summary.comparison.fingerprintsOnlyInDevice2}`);
  console.log(`No FP anywhere:     ${summary.comparison.noFingerprintAnywhere}`);
  console.log(`\nFiles in ./device-data/:`);
  console.log(`  - summary-${stamp}.json`);
  console.log(`  - comparison-${stamp}.csv`);
})();
