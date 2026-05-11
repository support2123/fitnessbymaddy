const { getSupabase } = require('./supabase');

const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function sendTemplate(phone, templateName, params, isClient) {
  const supabase = getSupabase();

  if (!isClient) {
    const twoHoursAgo = new Date(Date.now() - RATE_LIMIT_MS).toISOString();
    const { data: recent } = await supabase
      .from('messages')
      .select('id')
      .eq('phone', phone)
      .eq('direction', 'out')
      .gte('sent_at', twoHoursAgo)
      .limit(1);

    if (recent && recent.length > 0) {
      console.log(`Rate limited: ${phone.slice(0, 4)}XXX`);
      return { rateLimited: true };
    }
  }

  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error('AISENSY_API_KEY not set');
    return { error: 'API key missing' };
  }

  const body = {
    apiKey,
    campaignName: templateName,
    destination: phone,
    userName: 'FitnessByMaddy',
    templateParams: params || []
  };

  const resp = await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const result = await resp.json();

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: params ? params.join(' | ') : templateName,
    template_name: templateName,
    status: resp.ok ? 'sent' : 'failed'
  });

  return result;
}

async function sendFreeform(phone, text) {
  const supabase = getSupabase();
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) return { error: 'API key missing' };

  const body = {
    apiKey,
    campaignName: 'freeform_message',
    destination: phone,
    userName: 'FitnessByMaddy',
    message: text
  };

  const resp = await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const result = await resp.json();

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: text.substring(0, 500),
    template_name: null,
    status: resp.ok ? 'sent' : 'failed'
  });

  return result;
}

module.exports = { sendTemplate, sendFreeform };
