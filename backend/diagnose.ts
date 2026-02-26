/**
 * LiveKit Credentials Diagnostic Script
 * 
 * Runs detailed checks to identify exactly what's wrong with your credentials
 */

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import https from 'https';

// Load environment
dotenv.config({ path: path.resolve(__dirname, '.env') });

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(msg: string, color: keyof typeof colors = 'reset') {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

function check(description: string, passed: boolean, details?: string) {
  const icon = passed ? '✅' : '❌';
  log(`${icon} ${description}`, passed ? 'green' : 'red');
  if (details) log(`   ${details}`, 'yellow');
}

async function diagnose() {
  log('\n╔════════════════════════════════════════════════════════╗', 'blue');
  log('║   LIVEKIT CREDENTIALS DIAGNOSTIC                       ║', 'blue');
  log('╚════════════════════════════════════════════════════════╝\n', 'blue');

  let allPass = true;

  // ===================================================================
  // CHECK 1: .env file exists
  // ===================================================================
  log('📋 CHECK 1: .env File', 'cyan');
  const envPath = path.resolve(__dirname, '.env');
  const envExists = fs.existsSync(envPath);
  check('.env file exists', envExists, envPath);
  allPass = allPass && envExists;

  if (!envExists) {
    log('\n⚠️  .env file not found. Create it with:', 'yellow');
    log('   cp .env.example .env\n', 'yellow');
    return;
  }

  // ===================================================================
  // CHECK 2: Environment variables loaded
  // ===================================================================
  log('\n📋 CHECK 2: Environment Variables', 'cyan');

  const lkUrl = process.env.LIVEKIT_URL;
  const lkKey = process.env.LIVEKIT_API_KEY;
  const lkSecret = process.env.LIVEKIT_API_SECRET;

  check('LIVEKIT_URL set', !!lkUrl, lkUrl ? `Value: ${lkUrl}` : 'Missing!');
  allPass = allPass && !!lkUrl;

  check('LIVEKIT_API_KEY set', !!lkKey, lkKey ? `Value: ${lkKey.substring(0, 15)}...` : 'Missing!');
  allPass = allPass && !!lkKey;

  check('LIVEKIT_API_SECRET set', !!lkSecret, lkSecret ? `Value: ${lkSecret.substring(0, 15)}...` : 'Missing!');
  allPass = allPass && !!lkSecret;

  if (!lkUrl || !lkKey || !lkSecret) {
    log('\n❌ Missing critical environment variables!', 'red');
    return;
  }

  // ===================================================================
  // CHECK 3: Format validation
  // ===================================================================
  log('\n📋 CHECK 3: Credentials Format', 'cyan');

  const urlValid = lkUrl.startsWith('wss://') || lkUrl.startsWith('ws://');
  check('LiveKit URL format', urlValid, urlValid ? '✓ Correct format' : '✗ Should start with wss:// or ws://');
  allPass = allPass && urlValid;

  const keyValid = lkKey.startsWith('API');
  check('API Key format', keyValid, keyValid ? '✓ Starts with API' : '✗ Should start with API');
  allPass = allPass && keyValid;

  const secretValid = lkSecret.length > 20;
  check('API Secret format', secretValid, secretValid ? `✓ Length: ${lkSecret.length}` : '✗ Too short, should be ~60+ chars');
  allPass = allPass && secretValid;

  // ===================================================================
  // CHECK 4: No whitespace issues
  // ===================================================================
  log('\n📋 CHECK 4: Whitespace Check', 'cyan');

  const urlClean = !lkUrl.includes(' ');
  check('LIVEKIT_URL has no spaces', urlClean);
  allPass = allPass && urlClean;

  const keyClean = !lkKey.includes(' ');
  check('LIVEKIT_API_KEY has no spaces', keyClean);
  allPass = allPass && keyClean;

  const secretClean = !lkSecret.includes(' ');
  check('LIVEKIT_API_SECRET has no spaces', secretClean);
  allPass = allPass && secretClean;

  // ===================================================================
  // CHECK 5: Extract host from URL
  // ===================================================================
  log('\n📋 CHECK 5: LiveKit Host Resolution', 'cyan');

  try {
    const url = new URL(lkUrl!);
    const host = url.hostname;
    log(`   Hostname: ${host}`, 'yellow');
    log(`   Protocol: ${url.protocol}`, 'yellow');
    check('URL is valid and parseable', true);
  } catch (e: any) {
    check('URL is valid and parseable', false, `Error: ${e.message}`);
    allPass = false;
  }

  // ===================================================================
  // CHECK 6: Network connectivity
  // ===================================================================
  log('\n📋 CHECK 6: Network Connectivity', 'cyan');

  try {
    const url = new URL(lkUrl!);
    const host = url.hostname;

    // Try to resolve DNS
    await new Promise<void>((resolve, reject) => {
      const req = https.get(`https://${host}`, { timeout: 5000 }, (res) => {
        req.destroy();
        resolve();
      });

      req.on('error', (err: any) => {
        // 401/403 is ok - means host is reachable
        if (err.code === 'ENOTFOUND') {
          reject(new Error(`Host not found: ${host}`));
        } else if (err.code === 'ETIMEDOUT') {
          reject(new Error(`Connection timeout to ${host}`));
        } else {
          resolve(); // Other errors mean host is reachable
        }
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
    });

    check('Can reach LiveKit host', true, `Host: ${host}`);
  } catch (error: any) {
    check('Can reach LiveKit host', false, error.message);
    log('   ⚠️  May be network/firewall issue', 'yellow');
  }

  // ===================================================================
  // SUMMARY
  // ===================================================================
  log('\n╔════════════════════════════════════════════════════════╗', 'blue');
  
  if (allPass) {
    log('║ ✅ ALL CHECKS PASSED                                  ║', 'green');
    log('╚════════════════════════════════════════════════════════╝\n', 'blue');
    log('Your credentials look valid! The 401 error may be due to:', 'yellow');
    log('  1. Credentials rotated/revoked in LiveKit Cloud', 'cyan');
    log('  2. API key doesn\'t have RoomList permission', 'cyan');
    log('  3. Wrong workspace/project in LiveKit Cloud', 'cyan');
    log('\nAction: Re-create a new API key in LiveKit Cloud:', 'yellow');
    log('  1. Go to https://cloud.livekit.io', 'cyan');
    log('  2. Settings → API Keys', 'cyan');
    log('  3. Check all permissions', 'cyan');
    log('  4. Copy new credentials to .env', 'cyan');
  } else {
    log('║ ❌ SOME CHECKS FAILED                                 ║', 'red');
    log('╚════════════════════════════════════════════════════════╝\n', 'blue');
    log('Fix the issues above, then try again!', 'yellow');
  }

  log(`\nNext: npm run test\n`, 'cyan');
}

// Run diagnosis
diagnose().catch(err => {
  log(`\nDiagnostic error: ${err.message}\n`, 'red');
  process.exit(1);
});
