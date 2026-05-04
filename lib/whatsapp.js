const { supabase } = require('./supabase');
const { maskPhone } = require('./escalation');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function canSendToLead(phone) {
  const { data } = await supabase
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .order('sent_at', { ascending: false })
    .limit(1);

  if (!data || data.length === 0) return true;

  const lastSent = new Date(data[0].sent_at);
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  return lastSent < twoHoursAgo;
}

async function sendTemplate(phone, templateName, params, opts) {
  const force = opts && opts.force;

  if (!force) {
    const { data: lead } = await supabase
      .from('leads')
      .select('status')
      .eq('phone', phone)
      .single();

    if (lead && lead.status === 'dropped') {
      return { ok: false, reason: 'opted_out' };
    }

    const { data: client } = await supabase
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (!client) {
      const allowed = await canSendToLead(phone);
      if (!allowed) return { ok: false, reason: 'rate_limited' };
    }
  }

  const response = await fetch(AISENSY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-AiSensy-Project-API-Pwd': process.env.AISENSY_API_KEY
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: templateName,
      destination: phone,
      userName: 'FitnessByMaddy',
      templateParams: params || [],
      source: 'automation'
    })
  });

  const result = await response.json().catch(() => ({}));

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: `Template: ${templateName} | Params: ${JSON.stringify(params || [])}`,
    template_name: templateName,
    status: response.ok ? 'sent' : 'failed'
  });

  return { ok: response.ok, data: result };
}

async function sendText(phone, text) {
  const { data: lead } = await supabase
    .from('leads')
    .select('status')
    .eq('phone', phone)
    .single();

  if (lead && lead.status === 'dropped') {
    return { ok: false, reason: 'opted_out' };
  }

  const response = await fetch(AISENSY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-AiSensy-Project-API-Pwd': process.env.AISENSY_API_KEY
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: 'direct_message',
      destination: phone,
      userName: 'FitnessByMaddy',
      message: text,
      source: 'automation'
    })
  });

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: text,
    status: response.ok ? 'sent' : 'failed'
  });

  return { ok: response.ok };
}

module.exports = { sendTemplate, sendText, canSendToLead };
