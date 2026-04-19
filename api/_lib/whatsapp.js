const { getSupabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendTemplate(phone, templateName, params) {
  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: templateName,
      destination: phone.replace('+', ''),
      templateParams: params || [],
      source: 'automation'
    })
  });

  const data = await res.json().catch(() => ({}));

  const supabase = getSupabase();
  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: 'Template: ' + templateName + ' | Params: ' + (params || []).join(', '),
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed'
  });

  return { ok: res.ok, data };
}

async function sendMediaTemplate(phone, templateName, params, mediaUrl) {
  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: templateName,
      destination: phone.replace('+', ''),
      templateParams: params || [],
      media: mediaUrl ? { url: mediaUrl, filename: 'program.pdf' } : undefined,
      source: 'automation'
    })
  });

  const data = await res.json().catch(() => ({}));

  const supabase = getSupabase();
  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: 'Template: ' + templateName + ' (with media)',
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed'
  });

  return { ok: res.ok, data };
}

async function checkRateLimit(phone) {
  const supabase = getSupabase();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data } = await supabase
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo)
    .limit(1);

  return data && data.length > 0;
}

module.exports = { sendTemplate, sendMediaTemplate, checkRateLimit };
