const { supabase } = require('./supabase');

const AISENSY_API_URL = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  if (phone.startsWith('+91') || phone.startsWith('91')) return 'IN';
  if (phone.startsWith('+971') || phone.startsWith('971')) return 'UAE';
  if (phone.startsWith('+44') || phone.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

async function checkRateLimit(phone) {
  const { data } = await supabase
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .order('sent_at', { ascending: false })
    .limit(1);

  if (data && data.length > 0) {
    const lastSent = new Date(data[0].sent_at).getTime();
    if (Date.now() - lastSent < RATE_LIMIT_MS) {
      return false;
    }
  }
  return true;
}

async function sendWhatsApp(phone, templateName, bodyParams, isClient) {
  // Clients bypass rate limit; leads don't
  if (!isClient) {
    const allowed = await checkRateLimit(phone);
    if (!allowed) {
      console.log(`Rate limited: ${maskPhone(phone)}`);
      return { success: false, reason: 'rate_limited' };
    }
  }

  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error('AISENSY_API_KEY not configured');
    return { success: false, reason: 'no_api_key' };
  }

  const payload = {
    apiKey,
    campaignName: templateName,
    destination: phone.replace(/^\+/, ''),
    userName: 'Fitness by Maddy',
    templateParams: bodyParams || [],
    source: 'automation',
    buttons: [],
    carouselCards: [],
    location: {}
  };

  try {
    const resp = await fetch(AISENSY_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await resp.json();

    // Log to messages table
    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: `Template: ${templateName} | Params: ${JSON.stringify(bodyParams)}`,
      template_name: templateName,
      status: resp.ok ? 'sent' : 'failed',
      metadata: result
    });

    return { success: resp.ok, data: result };
  } catch (err) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, err.message);
    return { success: false, reason: err.message };
  }
}

async function sendFreeformWhatsApp(phone, message) {
  // For session messages (not templates) - used for escalation notifications
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) return { success: false, reason: 'no_api_key' };

  // Log the message
  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: message,
    status: 'sent'
  });

  return { success: true };
}

module.exports = { sendWhatsApp, sendFreeformWhatsApp, detectMarket, maskPhone, checkRateLimit };
