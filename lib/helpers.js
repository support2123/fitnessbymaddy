const ESCALATION_KEYWORDS = [
  'refund',
  'lawyer',
  'complaint',
  "didn't work",
  'side effect',
  'injury',
  'medical',
  'pregnancy',
  'medication',
  'pain',
  'dizziness',
  'not eating',
  'eating disorder',
  'throwing up',
];

const PROGRAM_PATTERNS = [
  { pattern: /fat\s*loss|weight|shred|lose/i, program: '6wk_gym' },
  { pattern: /pcos|hormonal|period/i, program: 'pcos' },
  { pattern: /40|menopause|joints|senior/i, program: '40plus' },
  { pattern: /custom|12\s*week|serious|transform/i, program: '12wk' },
  { pattern: /trial|zoom|not\s*sure|try/i, program: 'zoom_trial' },
  { pattern: /home|no\s*gym|bodyweight/i, program: '6wk_home' },
];

const PRICES = {
  zoom_trial: 2000,
  '6wk_gym': 9700,
  '6wk_home': 9700,
  pcos: 4500,
  '40plus': 5000,
  '12wk': 20000,
  zoom_pack: 15000,
};

const CHECKOUT_URLS = {
  zoom_trial: 'https://fitmaddy.exly.app/checkout/zoom-trial',
  '6wk_gym': 'https://fitmaddy.exly.app/checkout/6wk-gym',
  '6wk_home': 'https://fitmaddy.exly.app/checkout/6wk-home',
  pcos: 'https://fitmaddy.exly.app/checkout/pcos',
  '40plus': 'https://fitmaddy.exly.app/checkout/40plus',
  '12wk': 'https://fitmaddy.exly.app/checkout/12wk',
  zoom_pack: 'https://fitmaddy.exly.app/checkout/zoom-pack',
};

/**
 * Detect market from phone country code.
 */
export function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const p = String(phone).replace(/\s+/g, '');
  if (p.startsWith('+91')) return 'IN';
  if (p.startsWith('+971')) return 'UAE';
  if (p.startsWith('+44')) return 'UK';
  return 'GLOBAL';
}

/**
 * Mask phone for logging: "+91XXX...374"
 */
export function maskPhone(phone) {
  if (!phone) return '***';
  const p = String(phone).replace(/\s+/g, '');
  // Extract country code (digits after +, before the subscriber number)
  const match = p.match(/^(\+\d{1,3})/);
  const last3 = p.slice(-3);
  if (match) {
    return `${match[1]}XXX...${last3}`;
  }
  return `XXX...${last3}`;
}

/**
 * Returns true if text contains escalation keywords.
 */
export function isEscalation(text) {
  if (!text) return false;
  const lower = String(text).toLowerCase();
  return ESCALATION_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Classify lead interest based on message keywords.
 */
export function classifyLead(text) {
  if (!text) return null;
  const str = String(text);
  for (const { pattern, program } of PROGRAM_PATTERNS) {
    if (pattern.test(str)) return program;
  }
  return null;
}

/**
 * Returns the Exly checkout URL for a program.
 */
export function programCheckoutUrl(program) {
  if (!program) return null;
  return CHECKOUT_URLS[program] || null;
}

/**
 * Returns price in cents for a program.
 */
export function programPrice(program) {
  if (!program) return null;
  return PRICES[program] ?? null;
}

/**
 * Parse JSON body from a Vercel serverless request.
 * Handles both pre-parsed bodies and raw streams.
 */
export async function parseBody(req) {
  if (!req) return {};

  // Vercel often pre-parses JSON bodies
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }

  // Read from stream
  try {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    const raw = Buffer.concat(chunks).toString('utf-8');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Set CORS headers. Returns true if this is an OPTIONS preflight
 * (caller should return early with 204).
 */
export function cors(res) {
  if (!res) return false;

  res.setHeader('Access-Control-Allow-Origin', 'https://fitnessbymaddy.com');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Check if the original request method is OPTIONS via res.req
  const method =
    (res.req && res.req.method) ||
    (res._req && res._req.method) ||
    '';

  if (method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }

  return false;
}
