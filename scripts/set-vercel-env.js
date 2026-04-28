// One-shot script: pipe values into `vercel env add` without trailing newlines.
// Usage: node scripts/set-vercel-env.js
const { spawn } = require('child_process');

const VARS = [
  ['NEXT_PUBLIC_SUPABASE_URL', 'https://yufpttbzfucrznbftnnv.supabase.co'],
  ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1ZnB0dGJ6ZnVjcnpuYmZ0bm52Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMjgyMTAsImV4cCI6MjA5MjcwNDIxMH0.qJfZqo0W4i5BR2Yeyz_Vj4S6dqZSID6x57XoK1sIKDQ'],
  ['SUPABASE_SERVICE_ROLE_KEY', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1ZnB0dGJ6ZnVjcnpuYmZ0bm52Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzEyODIxMCwiZXhwIjoyMDkyNzA0MjEwfQ.jhhSZvQIKEMFMnDZvLqMEjh7gAMwYOHdTEw2Oe3vXZ0'],
  ['NEXT_PUBLIC_TEACHER_ONLY', 'true'],
];

function addEnv(name, value) {
  return new Promise((resolve, reject) => {
    const p = spawn('npx', ['vercel', 'env', 'add', name, 'production'], {
      stdio: ['pipe', 'inherit', 'inherit'],
      shell: true,  // Windows
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
