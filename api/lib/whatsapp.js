const { getSupabase } = require('./supabase');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp(phone, body, templateName) {
  const db = getSupabase();

  if (templateName) {
    const res = await fetch(`${AISENSY_BASE}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        apiKey: process.env.AISENSY_API_KEY,
        campaignName: templateName,
        destination: phone,
        userName: 'FitnessByMaddy',
        templateParams: [],
        source: 'automation',
        media: {},
        buttons: [],
        carouselCards: [],
        location: {},
      }),
    });
    const result = await res.json();

    await db.from('messages').insert({
      phone,
      direction: 'out',
      body: body || `[template: ${templateName}]`,
      template_name: templateName,
      status: res.ok ? 'sent' : 'failed',
    });

    return result;
  }

  const res = await fetch(`${AISENSY_BASE}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: 'text_message',
      destination: phone,
      userName: 'FitnessByMaddy',
      message: { type: 'text', text: body },
      source: 'automation',
    }),
  });
  const result = await res.json();

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body,
    status: res.ok ? 'sent' : 'failed',
  });

  return result;
}

async function sendWhatsAppWithMedia(phone, body, mediaUrl, templateName) {
  const db = getSupabase();

  const res = await fetch(`${AISENSY_BASE}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: templateName || 'media_message',
      destination: phone,
      userName: 'FitnessByMaddy',
      media: { url: mediaUrl, filename: 'program.pdf' },
      source: 'automation',
    }),
  });
  const result = await res.json();

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: body || `[media: ${mediaUrl}]`,
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed',
  });

  return result;
}

module.exports = { sendWhatsApp, sendWhatsAppWithMedia };
