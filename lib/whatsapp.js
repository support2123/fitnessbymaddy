const supabase = require('./supabase');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendTemplate(phone, templateName, params = [], userName = '') {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data: recent } = await supabase
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo)
    .limit(1);

  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .maybeSingle();

  if (recent && recent.length > 0 && !client) {
    return { rateLimited: true };
  }

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: templateName,
      destination: phone,
      userName: userName || phone,
      templateParams: params
    })
  });

  const result = await res.json();

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: 'Template: ' + templateName + ' | Params: ' + JSON.stringify(params),
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: res.ok ? 'sent' : 'failed'
  });

  return { success: res.ok, data: result };
}

async function sendText(phone, text) {
  const res = await fetch(
    'https://graph.facebook.com/v21.0/' + process.env.WA_PHONE_NUMBER_ID + '/messages',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + process.env.WA_ACCESS_TOKEN
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phone,
        type: 'text',
        text: { body: text }
      })
    }
  );

  const result = await res.json();

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: text,
    sent_at: new Date().toISOString(),
    status: res.ok ? 'sent' : 'failed'
  });

  return { success: res.ok, data: result };
}

async function sendDocument(phone, pdfUrl, caption) {
  const res = await fetch(
    'https://graph.facebook.com/v21.0/' + process.env.WA_PHONE_NUMBER_ID + '/messages',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + process.env.WA_ACCESS_TOKEN
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phone,
        type: 'document',
        document: {
          link: pdfUrl,
          caption: caption,
          filename: 'FitnessByMaddy-Program.pdf'
        }
      })
    }
  );

  const result = await res.json();

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: 'Document: ' + caption,
    sent_at: new Date().toISOString(),
    status: res.ok ? 'sent' : 'failed'
  });

  return { success: res.ok, data: result };
}

module.exports = { sendTemplate, sendText, sendDocument };
