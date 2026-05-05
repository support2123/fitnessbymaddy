const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const ESCALATION_KEYWORDS = [
  'injury', 'medical', 'pregnancy', 'medication', 'pain',
  'dizziness', 'refund', 'lawyer', 'complaint', "didn't work", 'side effect'
];

/**
 * Make an authenticated request to Supabase REST API
 */
async function supabaseFetch(path, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1${path}`;
  const headers = {
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': options.prefer || 'return=representation',
    ...options.headers,
  };

  const res = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase error ${res.status}: ${text}`);
  }

  const contentType = res.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return res.json();
  }
  return null;
}

/**
 * Upload a file to Supabase Storage
 */
async function supabaseStorageUpload(bucket, filePath, content, contentType = 'application/octet-stream') {
  const url = `${SUPABASE_URL}/storage/v1/object/${bucket}/${filePath}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': contentType,
      'x-upsert': 'true',
    },
    body: content,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Storage upload error ${res.status}: ${text}`);
  }
  return res.json();
}

/**
 * Get client by ID
 */
async function getClient(clientId) {
  const data = await supabaseFetch(`/clients?id=eq.${encodeURIComponent(clientId)}&limit=1`);
  return data && data.length > 0 ? data[0] : null;
}

/**
 * Get lead by phone number
 */
async function getLead(phone) {
  const data = await supabaseFetch(`/leads?phone=eq.${encodeURIComponent(phone)}&limit=1`);
  return data && data.length > 0 ? data[0] : null;
}

/**
 * Insert a message into the messages table
 */
async function insertMessage(phone, direction, body, template = null) {
  const record = {
    phone,
    direction,
    body: body || '',
    template,
    created_at: new Date().toISOString(),
  };
  return supabaseFetch('/messages', {
    method: 'POST',
    body: record,
  });
}

/**
 * Detect market based on phone number prefix
 */
function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/\s+/g, '');
  if (cleaned.startsWith('+91') || cleaned.startsWith('91')) return 'IN';
  if (cleaned.startsWith('+971') || cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('+44') || cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

/**
 * Detect preferred language based on market
 */
function detectLanguage(phone) {
  const market = detectMarket(phone);
  return market === 'IN' ? 'hinglish' : 'english';
}

/**
 * Mask phone number for logging: +91XXX...374
 */
function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  const prefix = phone.slice(0, 3);
  const suffix = phone.slice(-3);
  return `${prefix}XXX...${suffix}`;
}

/**
 * Check if a message contains escalation keywords
 */
function isEscalation(message) {
  if (!message) return false;
  const lower = message.toLowerCase();
  return ESCALATION_KEYWORDS.some(keyword => lower.includes(keyword));
}

/**
 * Standard CORS headers
 */
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST,GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-exly-signature',
  };
}

/**
 * Handle CORS preflight
 */
function handleCors(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return true;
  }
  return false;
}

module.exports = {
  supabaseFetch,
  supabaseStorageUpload,
  getClient,
  getLead,
  insertMessage,
  detectMarket,
  detectLanguage,
  maskPhone,
  isEscalation,
  corsHeaders,
  handleCors,
  ESCALATION_KEYWORDS,
};
