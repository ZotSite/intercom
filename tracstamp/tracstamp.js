/**
 * TracStamp - P2P Timestamping and Certification Agent for Intercom
 *
 * A verifiable timestamping service that:
 * - Receives content via the "tracstamp" sidechannel
 * - Fetches UTC time from multiple external sources
 * - Creates SHA-256 hash of the content
 * - Returns verifiable timestamp certificates
 * - Stores all certificates locally for verification
 * - Announces presence on "0000intercom"
 */

const WebSocket = require('ws');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
  wsUrl: 'ws://127.0.0.1:49222',
  mainChannel: 'tracstamp',
  entryChannel: '0000intercom',
  announceIntervalMs: 5 * 60 * 1000, // 5 minutes
  stampsFile: path.join(__dirname, 'stamps.json'),
  tracAddress: 'trac1sxudal9exnwynd7wws5a0j8xtx9tu5fkjmuvqr9q4udskn6w96tqk8p8rp',
  version: '1.0.0',
  reconnectDelayMs: 5000,
  timeApis: [
    {
      name: 'worldtimeapi.org',
      url: 'http://worldtimeapi.org/api/timezone/Etc/UTC',
      parse: (data) => data.datetime
    },
    {
      name: 'timeapi.io',
      url: 'https://timeapi.io/api/time/current/zone?timeZone=UTC',
      parse: (data) => `${data.dateTime}Z`
    }
  ]
};

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const result = { token: null };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--token' && args[i + 1]) {
      result.token = args[i + 1];
      i++;
    }
  }

  return result;
}

// State
let ws = null;
let authenticated = false;
let stamps = [];
let startTime = Date.now();
let announceInterval = null;
let token = null;

// Load stamps from file
function loadStamps() {
  try {
    if (fs.existsSync(CONFIG.stampsFile)) {
      const data = fs.readFileSync(CONFIG.stampsFile, 'utf8');
      stamps = JSON.parse(data);
      console.log(`[TracStamp] Loaded ${stamps.length} existing stamps from storage`);
    }
  } catch (err) {
    console.error('[TracStamp] Error loading stamps:', err.message);
    stamps = [];
  }
}

// Save stamps to file
function saveStamps() {
  try {
    fs.writeFileSync(CONFIG.stampsFile, JSON.stringify(stamps, null, 2));
  } catch (err) {
    console.error('[TracStamp] Error saving stamps:', err.message);
  }
}

// Generate next stamp ID
function getNextStampId() {
  const num = stamps.length + 1;
  return `TS-${String(num).padStart(5, '0')}`;
}

// Hash content with SHA-256
function hashContent(content) {
  const str = typeof content === 'string' ? content : JSON.stringify(content);
  return crypto.createHash('sha256').update(str).digest('hex');
}

// Fetch UTC time from external APIs
async function fetchUtcTime() {
  const timeSources = [];
  let primaryTime = null;

  for (const api of CONFIG.timeApis) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(api.url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        const time = api.parse(data);
        timeSources.push({ name: api.name, time });
        if (!primaryTime) {
          primaryTime = time;
        }
      }
    } catch (err) {
      console.log(`[TracStamp] Time API ${api.name} unavailable: ${err.message}`);
    }
  }

  // Fallback to local time if all APIs fail
  if (!primaryTime) {
    const localTime = new Date().toISOString();
    primaryTime = localTime;
    timeSources.push({ name: 'local_fallback', time: localTime });
    console.log('[TracStamp] Using local time as fallback');
  }

  return {
    utc_time: primaryTime,
    unix_ts: new Date(primaryTime).getTime(),
    time_sources: timeSources
  };
}

// Create a timestamp certificate
async function createCertificate(content) {
  const stampId = getNextStampId();
  const hash = hashContent(content);
  const timeData = await fetchUtcTime();

  const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
  const contentPreview = contentStr.length > 100
    ? contentStr.substring(0, 100) + '...'
    : contentStr;

  const certificate = {
    type: 'stamp_certificate',
    stamp_id: stampId,
    hash: hash,
    content_preview: contentPreview,
    utc_time: timeData.utc_time,
    unix_ts: timeData.unix_ts,
    time_sources: timeData.time_sources,
    stamped_by: CONFIG.tracAddress
  };

  // Store certificate
  stamps.push(certificate);
  saveStamps();

  console.log(`[TracStamp] Created certificate ${stampId} - hash: ${hash.substring(0, 16)}...`);

  return certificate;
}

// Find a certificate by stamp ID
function findCertificate(stampId) {
  return stamps.find(s => s.stamp_id === stampId) || null;
}

// Get statistics
function getStats() {
  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
  return {
    type: 'stats_response',
    total_stamps: stamps.length,
    uptime_seconds: uptimeSeconds,
    last_stamp_id: stamps.length > 0 ? stamps[stamps.length - 1].stamp_id : null,
    service: 'TracStamp',
    version: CONFIG.version
  };
}

// Get service announcement message
function getAnnouncement() {
  return {
    type: 'service_announce',
    service: 'TracStamp',
    description: 'P2P timestamping and certification service',
    channel: CONFIG.mainChannel,
    version: CONFIG.version,
    commands: ['stamp_request', 'verify', 'stats_request']
  };
}

// Send message to a channel
function sendToChannel(channel, message) {
  if (ws && ws.readyState === WebSocket.OPEN && authenticated) {
    ws.send(JSON.stringify({
      type: 'send',
      channel: channel,
      message: message
    }));
  }
}

// Handle incoming sidechannel message
async function handleSidechannelMessage(msg) {
  const { channel, message, from } = msg;

  // Only process messages on our main channel
  if (channel !== CONFIG.mainChannel) {
    return;
  }

  // Parse the message if it's a string
  let payload = message;
  if (typeof message === 'string') {
    try {
      payload = JSON.parse(message);
    } catch {
      // Not JSON, treat as raw content
      payload = { type: 'stamp_request', content: message };
    }
  }

  if (!payload || !payload.type) {
    return;
  }

  console.log(`[TracStamp] Received ${payload.type} from ${from || 'unknown'}`);

  switch (payload.type) {
    case 'stamp_request': {
      if (!payload.content) {
        sendToChannel(CONFIG.mainChannel, {
          type: 'error',
          message: 'Missing content field in stamp_request'
        });
        return;
      }
      const certificate = await createCertificate(payload.content);
      sendToChannel(CONFIG.mainChannel, certificate);
      break;
    }

    case 'verify': {
      if (!payload.stamp_id) {
        sendToChannel(CONFIG.mainChannel, {
          type: 'error',
          message: 'Missing stamp_id field in verify request'
        });
        return;
      }
      const found = findCertificate(payload.stamp_id);
      sendToChannel(CONFIG.mainChannel, {
        type: 'verify_response',
        found: !!found,
        certificate: found
      });
      console.log(`[TracStamp] Verify request for ${payload.stamp_id}: ${found ? 'FOUND' : 'NOT FOUND'}`);
      break;
    }

    case 'stats_request': {
      const stats = getStats();
      sendToChannel(CONFIG.mainChannel, stats);
      console.log(`[TracStamp] Stats sent: ${stats.total_stamps} stamps, uptime ${stats.uptime_seconds}s`);
      break;
    }

    default:
      console.log(`[TracStamp] Unknown message type: ${payload.type}`);
  }
}

// Handle WebSocket message
function handleWsMessage(data) {
  let msg;
  try {
    msg = JSON.parse(data.toString());
  } catch {
    console.error('[TracStamp] Invalid JSON from SC-Bridge');
    return;
  }

  switch (msg.type) {
    case 'hello':
      console.log('[TracStamp] Received hello from SC-Bridge');
      break;

    case 'auth_ok':
      console.log('[TracStamp] Authenticated successfully');
      authenticated = true;
      // Join the tracstamp channel
      ws.send(JSON.stringify({ type: 'join', channel: CONFIG.mainChannel }));
      // Start periodic announcements
      startAnnouncements();
      break;

    case 'joined':
      console.log(`[TracStamp] Joined channel: ${msg.channel || CONFIG.mainChannel}`);
      // Send initial announcement
      setTimeout(() => {
        sendToChannel(CONFIG.entryChannel, getAnnouncement());
        console.log('[TracStamp] Sent initial service announcement to 0000intercom');
      }, 1000);
      break;

    case 'sent':
      // Message sent confirmation
      break;

    case 'sidechannel_message':
      handleSidechannelMessage(msg);
      break;

    case 'error':
      console.error('[TracStamp] SC-Bridge error:', msg.message || msg.error || JSON.stringify(msg));
      break;

    default:
      // Ignore other message types
      break;
  }
}

// Start periodic announcements
function startAnnouncements() {
  if (announceInterval) {
    clearInterval(announceInterval);
  }

  announceInterval = setInterval(() => {
    if (authenticated) {
      sendToChannel(CONFIG.entryChannel, getAnnouncement());
      console.log('[TracStamp] Sent periodic service announcement');
    }
  }, CONFIG.announceIntervalMs);
}

// Connect to SC-Bridge
function connect() {
  console.log(`[TracStamp] Connecting to SC-Bridge at ${CONFIG.wsUrl}...`);

  ws = new WebSocket(CONFIG.wsUrl);

  ws.on('open', () => {
    console.log('[TracStamp] WebSocket connected, authenticating...');
    ws.send(JSON.stringify({ type: 'auth', token: token }));
  });

  ws.on('message', handleWsMessage);

  ws.on('close', () => {
    console.log('[TracStamp] WebSocket disconnected');
    authenticated = false;
    if (announceInterval) {
      clearInterval(announceInterval);
      announceInterval = null;
    }
    // Reconnect after delay
    setTimeout(connect, CONFIG.reconnectDelayMs);
  });

  ws.on('error', (err) => {
    console.error('[TracStamp] WebSocket error:', err.message);
  });
}

// Main entry point
function main() {
  const args = parseArgs();

  if (!args.token) {
    console.error('Usage: node tracstamp.js --token <SC_BRIDGE_TOKEN>');
    console.error('');
    console.error('The token must match the --sc-bridge-token used when starting Intercom.');
    process.exit(1);
  }

  token = args.token;

  console.log('');
  console.log('========================================');
  console.log('  TracStamp - P2P Timestamping Service  ');
  console.log('========================================');
  console.log(`Version: ${CONFIG.version}`);
  console.log(`Channel: ${CONFIG.mainChannel}`);
  console.log(`Address: ${CONFIG.tracAddress}`);
  console.log('');

  // Load existing stamps
  loadStamps();

  // Connect to SC-Bridge
  connect();

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n[TracStamp] Shutting down...');
    if (announceInterval) {
      clearInterval(announceInterval);
    }
    if (ws) {
      ws.close();
    }
    process.exit(0);
  });
}

main();
