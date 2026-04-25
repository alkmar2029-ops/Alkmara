const ZKLib = require('zkteco-js');
const fs = require('fs');
const path = require('path');

const IP = process.env.ZK_IP || '192.168.8.100';
const PORT = parseInt(process.env.ZK_PORT || '4370');
const TIMEOUT = 10000;

(async () => {
  const zk = new ZKLib(IP, PORT, TIMEOUT, 4000);
  const out = {};

  try {
    console.log(`[*] Connecting to ${IP}:${PORT}...`);
    await zk.createSocket();
    console.log('[+] Connected');

    console.log('[*] Fetching device info...');
    try { out.info = await zk.getInfo(); } catch (e) { out.info = { error: e.message }; }
    try { out.firmwareVersion = await zk.getDeviceVersion(); } catch {}
    try { out.deviceName = await zk.getDeviceName(); } catch {}
    try { out.macAddress = await zk.getMacAddress(); } catch {}
    try { out.serialNumber = await zk.getSerialNumber(); } catch {}
    try { out.platform = await zk.getPlatform(); } catch {}
    console.log('[+] Device:', out.deviceName, '| Firmware:', out.firmwareVersion);
    console.log('    Users:', out.info?.userCounts, '| Logs:', out.info?.logCounts);

    console.log('[*] Fetching users...');
    const users = await zk.getUsers();
    out.users = users?.data || [];
    console.log(`[+] Got ${out.users.length} users`);

    console.log('[*] Fetching attendance logs...');
    const logs = await zk.getAttendances();
    out.attendances = logs?.data || [];
    console.log(`[+] Got ${out.attendances.length} attendance records`);

    await zk.disconnect();
    console.log('[+] Disconnected');
  } catch (err) {
    console.error('[!] ERROR:', err.message);
    out.error = err.message;
    try { await zk.disconnect(); } catch {}
  }

  const outDir = path.join(__dirname, 'device-data');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  fs.writeFileSync(path.join(outDir, `dump-${stamp}.json`), JSON.stringify(out, null, 2), 'utf8');
  fs.writeFileSync(path.join(outDir, `latest.json`), JSON.stringify(out, null, 2), 'utf8');

  if (out.users?.length) {
    const csv = ['uid,userId,name,role,password,cardno'];
    for (const u of out.users) {
      csv.push([u.uid, u.userId, `"${(u.name || '').replace(/"/g, '""')}"`, u.role || 0, u.password || '', u.cardno || 0].join(','));
    }
    fs.writeFileSync(path.join(outDir, `users-${stamp}.csv`), '\uFEFF' + csv.join('\n'), 'utf8');
  }

  if (out.attendances?.length) {
    const csv = ['sn,user_id,record_time,type,state,ip'];
    for (const a of out.attendances) {
      const sn = a.sn ?? a.uid ?? '';
      const userId = a.user_id ?? a.userId ?? a.id ?? '';
      const time = a.record_time ?? a.timestamp ?? '';
      const type = a.type ?? '';
      const state = a.state ?? '';
      const ip = a.ip ?? '';
      csv.push([sn, userId, `"${time}"`, type, state, ip].join(','));
    }
    fs.writeFileSync(path.join(outDir, `attendance-${stamp}.csv`), '\uFEFF' + csv.join('\n'), 'utf8');
  }

  console.log(`\n[✓] Saved to ./device-data/`);
  console.log(`    - dump-${stamp}.json`);
  console.log(`    - users-${stamp}.csv`);
  console.log(`    - attendance-${stamp}.csv`);
})();
