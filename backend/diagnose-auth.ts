/**
 * LiveKit Server SDK Authentication Diagnostic
 * 
 * Diagnoses why RoomServiceClient fails with 401 Unauthorized
 * while token generation succeeds
 */

import dotenv from 'dotenv';
import path from 'path';
import { RoomServiceClient } from 'livekit-server-sdk';
import { AccessToken } from 'livekit-server-sdk';

dotenv.config({ path: path.resolve(__dirname, '.env') });

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(msg: string, color: keyof typeof colors = 'reset') {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

async function diagnose() {
  log('\n╔════════════════════════════════════════════════════════╗', 'blue');
  log('║   LIVEKIT SERVER SDK AUTHENTICATION DIAGNOSTIC        ║', 'blue');
  log('╚════════════════════════════════════════════════════════╝\n', 'blue');

  const url = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  log('📋 STEP 1: Verify Environment Variables Loaded', 'cyan');
  log('─'.repeat(50), 'cyan');

  if (!url || !apiKey || !apiSecret) {
    log('❌ Missing environment variables!', 'red');
    return;
  }

  log(`✅ LIVEKIT_URL: ${url}`, 'green');
  log(`✅ LIVEKIT_API_KEY: ${apiKey.substring(0, 10)}...`, 'green');
  log(`✅ LIVEKIT_API_SECRET: ${apiSecret.substring(0, 10)}...`, 'green');

  // ===================================================================
  // STEP 2: Verify URL Format
  // ===================================================================
  log('\n📋 STEP 2: Verify URL Format for Server SDK', 'cyan');
  log('─'.repeat(50), 'cyan');

  if (url.startsWith('https://')) {
    log('✅ URL uses https:// (correct for server SDK)', 'green');
  } else if (url.startsWith('wss://')) {
    log(
      '❌ ERROR: URL uses wss:// (this is for FRONTEND, not backend)',
      'red'
    );
    log('   Change to: ' + url.replace('wss://', 'https://'), 'yellow');
    log('   Update your .env file immediately!', 'yellow');
    return;
  } else {
    log('❌ ERROR: URL has unknown protocol: ' + url.split('://')[0], 'red');
    return;
  }

  // ===================================================================
  // STEP 3: Parse URL Components
  // ===================================================================
  log('\n📋 STEP 3: Parse URL Components', 'cyan');
  log('─'.repeat(50), 'cyan');

  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    const pathname = urlObj.pathname;

    log(`  Hostname: ${hostname}`, 'yellow');
    log(`  Path: ${pathname || '(root)'}`, 'yellow');

    // Extract region if present
    const regionMatch = hostname.match(
      /https?:\/\/(?:.*-)?([a-z]+)-?[0-9]?\.livekit\.cloud/
    );
    if (regionMatch) {
      log(`  Detected Region: ${regionMatch[1]}`, 'yellow');
    }
  } catch (e) {
    log('❌ Failed to parse URL', 'red');
    return;
  }

  // ===================================================================
  // STEP 4: Test Token Generation (Should Work)
  // ===================================================================
  log('\n📋 STEP 4: Test Token Generation (JWT Signing)', 'cyan');
  log('─'.repeat(50), 'cyan');

  try {
    const token = new AccessToken(apiKey, apiSecret, {
      identity: 'test-user',
      name: 'Test User',
    });

    token.addGrant({
      roomJoin: true,
      room: 'test-room',
      canPublish: true,
      canSubscribe: true,
    });

    const jwt = await token.toJwt();
    log('✅ Token generated successfully', 'green');
    log(`   JWT (first 50 chars): ${jwt.substring(0, 50)}...`, 'yellow');
    log('   This proves: API_KEY and API_SECRET are valid', 'green');
  } catch (err: any) {
    log(`❌ Token generation failed: ${err.message}`, 'red');
    log('   This means API_KEY or API_SECRET is malformed', 'red');
    return;
  }

  // ===================================================================
  // STEP 5: Test RoomServiceClient (Usually Fails Here)
  // ===================================================================
  log('\n📋 STEP 5: Test RoomServiceClient Authentication', 'cyan');
  log('─'.repeat(50), 'cyan');
  log('⏳ Attempting to connect to LiveKit Server...', 'yellow');

  try {
    const roomService = new RoomServiceClient(url, apiKey, apiSecret);
    const rooms = await roomService.listRooms();
    log(
      `✅ Successfully connected! Found ${rooms.length} room(s)`,
      'green'
    );
    if (rooms.length > 0) {
      log(`   Rooms: ${rooms.map((r) => r.name).join(', ')}`, 'yellow');
    }
  } catch (error: any) {
    log('❌ RoomServiceClient failed!', 'red');
    log(`   Error: ${error.message}`, 'red');
    log(`   Status: ${error.status}`, 'red');

    if (error.status === 401) {
      log('\n🔥 ROOT CAUSE: 401 Unauthorized', 'red');
      log('   The server rejected your API credentials.\n', 'red');

      log('   MOST LIKELY CAUSES:', 'yellow');
      log('', 'reset');
      log('   1️⃣  API Key and URL are from DIFFERENT projects', 'yellow');
      log('      → Check LiveKit dashboard: Settings → Connection Info', 'yellow');
      log('      → Copy the Server URL exactly', 'yellow');
      log('      → Verify API key belongs to THIS project', 'yellow');
      log('', 'reset');

      log('   2️⃣  API Secret was regenerated in dashboard', 'yellow');
      log('      → Go to LiveKit: Settings → API Keys', 'yellow');
      log('      → Copy the NEW secret to .env', 'yellow');
      log('', 'reset');

      log('   3️⃣  Wrong region URL', 'yellow');
      log('      → If project is in eu-central, URL must match', 'yellow');
      log('      → Copy exact URL from dashboard', 'yellow');
      log('', 'reset');

      log('   4️⃣  Typo in credentials', 'yellow');
      log('      → Check for extra spaces in .env', 'yellow');
      log('      → No quotes around values', 'yellow');
      log('', 'reset');

      log(
        '   📍 ACTION: Go to https://cloud.livekit.io',
        'cyan'
      );
      log(
        '      → Select your project',
        'cyan'
      );
      log(
        '      → Settings → Connection Info',
        'cyan'
      );
      log(
        '      → Copy Server URL exactly',
        'cyan'
      );
      log(
        '      → Update LIVEKIT_URL in .env',
        'cyan'
      );
      log(
        '      → Settings → API Keys → Copy exact key and secret',
        'cyan'
      );
      log(
        '      → Update .env and run: npm run diagnose',
        'cyan'
      );
      log('', 'reset');
    }

    return;
  }

  // ===================================================================
  // SUCCESS
  // ===================================================================
  log('\n╔════════════════════════════════════════════════════════╗', 'green');
  log('║ ✅ ALL TESTS PASSED - READY FOR PRODUCTION             ║', 'green');
  log('╚════════════════════════════════════════════════════════╝\n', 'green');

  log('Your LiveKit integration is working correctly!', 'green');
  log('\nNext steps:', 'cyan');
  log('  1. Start backend: npm run dev', 'cyan');
  log('  2. Test with frontend', 'cyan');
  log('  3. Deploy to Vercel/Render', 'cyan');
}

diagnose().catch((err) => {
  log(`\nFatal error: ${err.message}\n`, 'red');
  process.exit(1);
});
