const { supabase } = require('./supabase');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendTemplate(phone, templateName, params) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error('AISENSY_API_KEY not configured');
    return { ok: false, error: 'API key missing' };
  }

  const body = {
    apiKey,
    campaignName: templateName,
    destination: phone.replace('+', ''),
    userName: params.name || 'there',
    templateParams: params.templateParams || [],
    source: 'fitnessbymaddy-automation',
    media: params.media || undefined,
    buttons: params.buttons || undefined
  };

  try {
    const res = await fetch(AISENSY_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();

    await logMessage(phone, 'out', params.templateParams?.join(' | ') || templateName, templateName);

    return { ok: res.ok, data };
  } catch (err) {
    console.error('AiSensy send error:', err.message);
    return { ok: false, error: err.message };
  }
}

async function sendText(phone, text) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error('AISENSY_API_KEY not configured');
    return { ok: false, error: 'API key missing' };
  }

  const body = {
    apiKey,
    campaignName: 'text_message',
    destination: phone.replace('+', ''),
    message: text,
    source: 'fitnessbymaddy-automation'
  };

  try {
    const res = await fetch(AISENSY_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();

    await logMessage(phone, 'out', text, null);

    return { ok: res.ok, data };
  } catch (err) {
    console.error('AiSensy text send error:', err.message);
    return { ok: false, error: err.message };
  }
}

async function sendDocument(phone, documentUrl, caption) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) return { ok: false, error: 'API key missing' };

  const body = {
    apiKey,
    campaignName: 'document_message',
    destination: phone.replace('+', ''),
    media: { url: documentUrl, filename: 'program.pdf' },
    caption: caption || '',
    source: 'fitnessbymaddy-automation'
  };

  try {
    const res = await fetch(AISENSY_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    await logMessage(phone, 'out', `[PDF] ${caption || ''}`, 'document_message');
    return { ok: res.ok, data };
  } catch (err) {
    console.error('AiSensy doc send error:', err.message);
    return { ok: false, error: err.message };
  }
}

async function logMessage(phone, direction, body, templateName) {
  const { error } = await supabase.from('messages').insert({
    phone,
    direction,
    body: body?.substring(0, 2000),
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: 'sent'
  });
  if (error) console.error('Message log error:', error.message);
}

async function canSendMessage(phone) {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo)
    .limit(1);

  if (error) return true;

  const { data: clientData } = await supabase
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1);

  if (clientData?.length > 0) return true;

  return !data || data.length === 0;
}

module.exports = { sendTemplate, sendText, sendDocument, logMessage, canSendMessage };
