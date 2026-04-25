const ZKLib = require('zkteco-js');

(async () => {
  const zk = new ZKLib('192.168.8.100', 4370, 30000, 4000);
  await zk.createSocket();

  // Get free sizes first
  const free = await zk.ztcp.executeCmd(50, '');
  console.log('FREE_SIZES raw hex (first 100 bytes):', free.subarray(0, Math.min(100, free.length)).toString('hex'));
  console.log('FREE_SIZES parsed:');
  console.log('  offset 16 adminCount:', free.readUIntLE(16, 4));
  console.log('  offset 24 userCount :', free.readUIntLE(24, 4));
  console.log('  offset 32 fingerCount:', free.readUIntLE(32, 4));
  console.log('  offset 40 logCount  :', free.readUIntLE(40, 4));
  console.log('  offset 48 pwdCount  :', free.readUIntLE(48, 4));

  // Make request buffer for templates
  const mkReq = (cmd, fct, ext) => {
    const b = Buffer.alloc(11);
    b.writeUInt8(1, 0);
    b.writeUInt16LE(cmd, 1);
    b.writeUInt32LE(fct, 3);
    b.writeUInt32LE(ext, 7);
    return b;
  };

  console.log('\nSending CMD_DB_RRQ(7) fct=2 ...');
  try {
    const res = await zk.ztcp.readWithBuffer(mkReq(7, 2, 0));
    const raw = res?.data || Buffer.alloc(0);
    console.log('Received bytes:', raw.length);
    console.log('First 200 bytes hex:', raw.subarray(0, Math.min(200, raw.length)).toString('hex'));

    // Try to parse. First 4 bytes may be size, then records follow.
    console.log('\n--- Parse attempt ---');
    const body4 = raw.subarray(4);
    let off = 0;
    let cnt = 0;
    const sizes = {};
    while (off + 6 <= body4.length) {
      const sz = body4.readUInt16LE(off);
      if (sz === 0 || sz > body4.length - off) { console.log('  BREAK at off=' + off + ' sz=' + sz); break; }
      cnt++;
      sizes[sz] = (sizes[sz] || 0) + 1;
      off += sz;
    }
    console.log('Parsed templates (skip 4):', cnt, 'Sizes:', JSON.stringify(sizes));

    // Parse without skipping first 4
    let off2 = 0, cnt2 = 0;
    while (off2 + 6 <= raw.length) {
      const sz = raw.readUInt16LE(off2);
      if (sz === 0 || sz > raw.length - off2) break;
      cnt2++;
      off2 += sz;
    }
    console.log('Parsed templates (no skip):', cnt2);
  } catch (e) {
    console.log('Error:', e.message || e);
  }

  await zk.disconnect();
})();
