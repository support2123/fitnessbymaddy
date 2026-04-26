// api/_lib/utils.js — Utility functions for FitnessByMaddy pipeline

const crypto = require('crypto');

/**
 * Mask a phone number for safe logging.
 * "+917082478374" -> "+91XXX...374"
 */
function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  // Find where the country code ends (after + and 1-3 digits)
  // We show the country code prefix and last 3 digits
  const last3 = phone.slice(-3);
  // Determine country code length: +1 (2), +44 (3), +91 (3), +971 (4)
  let ccLen = 1; // the '+' character
  if (phone.startsWith('+')) {
    if (phone.startsWith('+971')) ccLen = 4;
    else if (phone.startsWith('+91') || phone.startsWith('+44')) ccLen = 3;
    else if (phone.startsWith('+1')) ccLen = 2;
    else ccLen = Math.min(4, phone.length - 3); // best guess
  }
  const countryCode = phone.slice(0, ccLen);
  return `${countryCode}XXX...${last3}`;
}

/**
 * Detect market from phone country code.
 */
function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  if (phone.startsWith('+91')) return 'IN';
  if (phone.startsWith('+971')) return 'UAE';
  if (phone.startsWith('+44')) return 'UK';
  return 'GLOBAL';
}

/**
 * Returns true if the market should use Hinglish messaging.
 */
function isHinglish(market) {
  return market === 'IN';
}

/**
 * Parse a message to detect program interest.
 * Returns { program, checkoutSlug } or null.
 */
function parseLeadIntent(message) {
  if (!message) return null;
  const msg = message.toLowerCase();

  // Order matters: check more specific patterns first
  if (/fat\s*loss|weight|shred|lose/.test(msg)) {
    return { program: '6wk_gym', checkoutSlug: '6-week-burn' };
  }
  if (/home|no\s*gym|bodyweight/.test(msg)) {
    return { program: '6wk_home', checkoutSlug: '6-week-home' };
  }
  if (/pcos|hormonal|hormone/.test(msg)) {
    return { program: 'pcos', checkoutSlug: 'pcos-warrior' };
  }
  if (/40|menopause|joints|senior/.test(msg)) {
    return { program: '40plus', checkoutSlug: '40plus-strong' };
  }
  if (/custom|12\s*week|serious|flagship/.test(msg)) {
    return { program: '12wk', checkoutSlug: '12-week-flagship' };
  }
  if (/trial|zoom|not\s*sure|try/.test(msg)) {
    return { program: 'zoom_trial', checkoutSlug: 'zoom-trial' };
  }

  return null;
}

/**
 * Basic phone validation. Must start with + and have 10-15 digits.
 */
function validatePhone(phone) {
  if (!phone || typeof phone !== 'string') return false;
  if (!phone.startsWith('+')) return false;
  const digits = phone.slice(1).replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

/**
 * Generate a random URL-safe token (32 characters).
 */
function generateToken() {
  return crypto.randomBytes(24).toString('base64url').slice(0, 32);
}

/**
 * Check if a message is an opt-out request.
 */
function isOptOut(message) {
  if (!message) return false;
  const msg = message.toLowerCase().trim();
  const optOutPhrases = ['stop', 'unsubscribe', 'opt out', 'cancel'];
  return optOutPhrases.some((phrase) => msg.includes(phrase));
}

module.exports = {
  maskPhone,
  detectMarket,
  isHinglish,
  parseLeadIntent,
  validatePhone,
  generateToken,
  isOptOut,
};
