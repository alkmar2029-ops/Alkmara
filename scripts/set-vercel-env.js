// One-shot script: pipe values from the current process environment into
// `vercel env add` without trailing newlines.
// Usage: node --env-file=.env.local scripts/set-vercel-env.js
const { spawn } = require('child_process');

const NAMES = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_TEACHER_ONLY',
];

const missing = NAMES.filter((name) => !process.env[name]?.trim());
if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  console.error('Load them locally, for example with: node --env-file=.env.local scripts/set-vercel-env.js');
  process.exit(1);
}

const VARS = NAMES.map((name) => [name, process.env[name].trim()]);

function addEnv(name, value) {
  return new Promise((resolve, reject) => {
    const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const p = spawn(command, ['vercel', 'env', 'add', name, 'production'], {
      stdio: ['pipe', 'inherit', 'inherit'],
      shell: false,
    });
    // Write the raw value with no trailing newline.
    p.stdin.write(value);
    p.stdin.end();
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
  });
}

(async () => {
  for (const [k, v] of VARS) {
    process.stdout.write(`Adding ${k} ... `);
    try {
      await addEnv(k, v);
      console.log('✓');
    } catch (e) {
      console.log('FAILED:', e.message);
    }
  }
  console.log('\nDone. Now run: npx vercel deploy --prod');
})();
