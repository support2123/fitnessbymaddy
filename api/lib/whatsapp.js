const { supabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 4) + 'XXX...' + phone.slice(-3);
}

function detectMarket(phone) {
  if (phone.startsWith('+91') || phone.startsWith('91')) return 'IN';
  if (phone.startsWith('+971') || phone.startsWith('971')) return 'UAE';
  if (phone.startsWith('+44') || phone.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

async function sendWhatsApp(phone, templateName, params = {}) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error('AISENSY_API_KEY not configured');
    return { success: false, error: 'API key missing' };
  }

  const now = new Date();
  const { data: recent } = await supabase
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', new Date(now - 2 * 60 * 60 * 1000).toISOString())
    .order('sent_at', { ascending: false })
    .limit(1);

  if (recent && recent.length > 0) {
    const { data: client } = await supabase
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (!client) {
      console.log(`Rate limited: ${maskPhone(phone)} — last msg <2hrs ago`);
      return { success: false, error: 'rate_limited' };
    }
  }

  try {
    const response = await fetch(AISENSY_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-AiSensy-Project-API-Key': apiKey
      },
      body: JSON.stringify({
        apiKey,
        campaignName: templateName,
        destination: phone.replace('+', ''),
        userName: params.name || 'there',
        templateParams: params.templateParams || [],
        media: params.media || {}
      })
    });

    const result = await response.json();

    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: templateName,
      template_name: templateName,
      status: response.ok ? 'sent' : 'failed'
    });

    return { success: response.ok, data: result };
  } catch (err) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, err.message);
    return { success: false, error: err.message };
  }
}

async function notifyMaddy(reason, details) {
  const maddyPhone = '+917082478374';
  await sendWhatsApp(maddyPhone, 'escalation_alert', {
    name: 'Maddy',
    templateParams: [reason, details]
  });
}

module.exports = { sendWhatsApp, notifyMaddy, maskPhone, detectMarket };
