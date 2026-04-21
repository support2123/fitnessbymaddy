const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function sendTemplate(phone, templateName, params, { supabase, bypassRate = false } = {}) {
  if (!bypassRate && supabase) {
    const twoHoursAgo = new Date(Date.now() - RATE_LIMIT_MS).toISOString();
    const { data: recent } = await supabase
      .from('messages')
      .select('id')
      .eq('phone', phone)
      .eq('direction', 'out')
      .gte('sent_at', twoHoursAgo)
      .limit(1);

    if (recent && recent.length > 0) {
      return { rateLimited: true };
    }
  }

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: params.name || 'there',
    templateParams: params.templateParams || [],
    media: params.media || {},
    buttons: params.buttons || [],
  };

  const res = await fetch(`${AISENSY_API}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const result = await res.json();

  if (supabase) {
    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: `[template:${templateName}]`,
      template_name: templateName,
      sent_at: new Date().toISOString(),
      status: res.ok ? 'sent' : 'failed',
    });
  }

  return { ok: res.ok, result };
}

async function sendText(phone, text, { supabase } = {}) {
  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'text_message',
    destination: phone,
    message: text,
  };

  const res = await fetch(`${AISENSY_API}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (supabase) {
    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: text.substring(0, 500),
      sent_at: new Date().toISOString(),
      status: res.ok ? 'sent' : 'failed',
    });
  }

  return { ok: res.ok };
}

module.exports = { sendTemplate, sendText };
