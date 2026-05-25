const crypto = require('crypto');

/**
 * Detect market region from phone number country code.
 * @param {string} phone - E.164 phone number (e.g. +919876543210)
 * @returns {'IN'|'UAE'|'UK'|'GLOBAL'}
 */
function detectMarket(phone) {
  const cleaned = String(phone).replace(/\s+/g, '');
  if (cleaned.startsWith('+91')) return 'IN';
  if (cleaned.startsWith('+971')) return 'UAE';
  if (cleaned.startsWith('+44')) return 'UK';
  return 'GLOBAL';
}

/**
 * Mask a phone number for safe logging.
 * Shows country code prefix, masks middle digits, keeps last 3.
 * Example: +919876543210 → +91XXX...210
 * @param {string} phone
 * @returns {string}
 */
function maskPhone(phone) {
  const cleaned = String(phone).replace(/\s+/g, '');
  if (cleaned.length < 6) return 'XXX...XXX';

  // Find where country code ends (after + and 1-3 digit code)
  let prefixLen = 1; // the '+'
  if (cleaned.startsWith('+')) {
    if (cleaned.startsWith('+971')) prefixLen = 4;
    else if (cleaned.startsWith('+91')) prefixLen = 3;
    else if (cleaned.startsWith('+44')) prefixLen = 3;
    else prefixLen = Math.min(4, cleaned.length - 3); // generic: up to 3-digit code
  }

  const prefix = cleaned.slice(0, prefixLen);
  const last3 = cleaned.slice(-3);
  return `${prefix}XXX...${last3}`;
}

/**
 * Classify a user message into a program interest.
 * Returns null if no program intent detected.
 * @param {string} message
 * @returns {string|null} - One of: 6wk_gym, pcos, 40plus, 12wk, zoom_trial, or null
 */
function classifyIntent(message) {
  if (!message) return null;
  const lower = String(message).toLowerCase().trim();

  // Order matters: check more specific patterns first
  const patterns = [
    { keywords: ['pcos', 'pcod', 'hormonal'], intent: 'pcos' },
    { keywords: ['40+', '40 plus', 'forty plus', 'above 40', 'over 40', 'after 40'], intent: '40plus' },
    { keywords: ['custom', 'customized', 'customised', '12 week', '12wk', '12-week', 'twelve week'], intent: '12wk' },
    { keywords: ['fat loss', 'fatloss', 'weight loss', 'lose weight', 'lose fat', '6 week', '6wk', '6-week', 'six week', 'shred'], intent: '6wk_gym' },
    { keywords: ['trial', 'zoom', 'not sure', 'unsure', 'try', 'demo', 'sample'], intent: 'zoom_trial' },
  ];

  for (const { keywords, intent } of patterns) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return intent;
    }
  }

  return null;
}

/**
 * Generate a cryptographically random URL-safe token.
 * @param {number} [bytes=32] - Number of random bytes (output is ~43 chars for 32 bytes)
 * @returns {string}
 */
function generateToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/**
 * Check whether a message is an opt-out request.
 * @param {string} message
 * @returns {boolean}
 */
function isOptOut(message) {
  if (!message) return false;
  const lower = String(message).toLowerCase().trim();

  const optOutPhrases = [
    'stop',
    'unsubscribe',
    'opt out',
    'opt-out',
    'cancel',
    'remove me',
    'don\'t message',
    'dont message',
    'don\'t text',
    'dont text',
    'leave me alone',
    'no more messages',
  ];

  return optOutPhrases.some((phrase) => lower.includes(phrase));
}

/**
 * Return the default language for a given market.
 * India uses Hinglish; all others use English.
 * @param {'IN'|'UAE'|'UK'|'GLOBAL'} market
 * @returns {'hinglish'|'english'}
 */
function getLanguage(market) {
  return market === 'IN' ? 'hinglish' : 'english';
}

module.exports = {
  detectMarket,
  maskPhone,
  classifyIntent,
  generateToken,
  isOptOut,
  getLanguage,
};
