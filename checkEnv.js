// Run from the backend folder BEFORE testing a payment:   node checkEnv.js
// Checks your .env settings and asks Paystack whether your secret key is accepted.
// It never prints your keys.
require('dotenv').config();
const axios = require('axios');

let problems = 0;
const ok = (msg) => console.log(`  OK    ${msg}`);
const warn = (msg) => console.log(`  WARN  ${msg}`);
const fail = (msg) => {
  problems += 1;
  console.log(`  FAIL  ${msg}`);
};

const env = process.env;

console.log('\nChecking backend/.env\n');

// Database
if (env.MONGO_URI || env.MONGODB_URI || env.MONGO_URL) ok('Database connection string is set');
else warn('No MONGO_URI found. Fine only if your config/db.js reads a differently named variable.');

// Login tokens
if (!env.JWT_SECRET) fail('JWT_SECRET is missing');
else if (env.JWT_SECRET.length < 32) warn('JWT_SECRET is short. Use a long random string (48+ characters).');
else ok('JWT_SECRET is set');

// URLs
for (const name of ['FRONTEND_URL', 'BACKEND_URL']) {
  if (!env[name]) {
    warn(`${name} is not set (the code falls back to a localhost default)`);
    continue;
  }
  try {
    new URL(env[name]);
    if (env[name].endsWith('/')) warn(`${name} ends with "/" (harmless, it is trimmed)`);
    ok(`${name} = ${env[name]}`);
  } catch {
    fail(`${name} is not a valid URL (include http:// or https://)`);
  }
}

// Paystack key
const key = env.PAYSTACK_SECRET_KEY || '';
const mockKey = !key.trim() || key.trim().toLowerCase() === 'sk_test_replace_me' || /^sk_(test|live)_x+$/i.test(key.trim());
if (mockKey) {
  warn('No real Paystack key: payments run in MOCK mode. Orders are marked paid without charging anyone (local testing only).');
} else if (key !== key.trim() || /["'\s]/.test(key)) {
  fail('PAYSTACK_SECRET_KEY has spaces or quotes around it. Remove them.');
} else if (key.startsWith('sk_test_')) {
  ok('PAYSTACK_SECRET_KEY is a TEST key (good for testing)');
} else if (key.startsWith('sk_live_')) {
  warn('PAYSTACK_SECRET_KEY is a LIVE key. Real money will move. Use sk_test_ while testing.');
} else {
  fail('PAYSTACK_SECRET_KEY should start with sk_test_ (or sk_live_). Did you paste the public key (pk_)?');
}

async function pingPaystack() {
  if (!key || mockKey || problems > 0) return;
  try {
    await axios.get('https://api.paystack.co/transaction', {
      params: { perPage: 1 },
      headers: { Authorization: `Bearer ${key}` },
      timeout: 15000,
    });
    ok('Paystack accepted your secret key');
  } catch (error) {
    if (error.response?.status === 401) fail('Paystack rejected the key (invalid). Copy it again from the dashboard.');
    else if (error.response) fail(`Paystack answered with status ${error.response.status}`);
    else warn('Could not reach Paystack (no internet?). The key format looks fine.');
  }
}

// Email (via Resend)
async function checkEmail() {
  console.log('');
  if (env.RESEND_API_KEY) {
    ok('RESEND_API_KEY is set (using Resend for emails)');
  } else {
    warn('No RESEND_API_KEY found. Verification emails will not send.');
  }
}

pingPaystack().then(checkEmail).then(() => {
  console.log(problems === 0 ? '\nAll good. Restart your backend, then try a test payment.\n' : `\n${problems} problem(s) to fix first.\n`);
  process.exitCode = problems === 0 ? 0 : 1;
});