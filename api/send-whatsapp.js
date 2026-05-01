const { getSupabase } = require('./lib/supabase');
const { maskPhone, jsonResponse, cors } = require('./lib/helpers');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function canSend(supabase, phone, isClient) {
  if (isClient) return true;
  const { data } = await supabase
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .order('sent_at', { ascending: false })
    .limit(1);
  if (!data || data.length === 0) return true;
  return Date.now() - new Date(data[0].sent_at).getTime() > RATE_LIMIT_MS;
}

async function sendWhatsApp({ phone, templateName, bodyValues, mediaUrl, isClient }) {
  const supabase = getSupabase();

  if (!await canSend(supabase, phone, isClient)) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { sent: false, reason: 'rate_limited' };
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    templateParams: bodyValues || [],
  };
  if (mediaUrl) {
    payload.mediaUrl = mediaUrl;
    payload.mediaFilename = 'program.pdf';
  }

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const result = await res.json();
  const sent = res.ok;

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: bodyValues ? bodyValues.join(' | ') : templateName,
    template_name: templateName,
    status: sent ? 'sent' : 'failed',
  });

  if (!sent) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, result);
  }

  return { sent, result };
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { cors(res); return res.status(200).end(); }
  if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return jsonResponse(res, 401, { error: 'Unauthorized' });
  }

  const { phone, templateName, bodyValues, mediaUrl, isClient } = req.body;
  if (!phone || !templateName) {
    return jsonResponse(res, 400, { error: 'phone and templateName required' });
  }

  const result = await sendWhatsApp({ phone, templateName, bodyValues, mediaUrl, isClient });
  return jsonResponse(res, result.sent ? 200 : 429, result);
};

module.exports.sendWhatsApp = sendWhatsApp;
