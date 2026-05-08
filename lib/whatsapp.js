import { getSupabase } from './supabase.js';

const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

export async function sendWhatsApp({ phone, templateName, body, isClient = false }) {
  const db = getSupabase();

  if (!isClient) {
    const twoHoursAgo = new Date(Date.now() - RATE_LIMIT_MS).toISOString();
    const { data: recent } = await db
      .from('messages')
      .select('id')
      .eq('phone', phone)
      .eq('direction', 'out')
      .gte('sent_at', twoHoursAgo)
      .limit(1);

    if (recent && recent.length > 0) {
      return { sent: false, reason: 'rate_limited' };
    }
  }

  const apiKey = process.env.AISENSY_API_KEY;
  const payload = {
    apiKey,
    campaignName: templateName,
    destination: phone,
    userName: 'FitnessByMaddy',
    templateParams: [],
    source: 'automation',
    media: {},
    buttons: [],
    carouselCards: [],
    location: {}
  };

  if (body) {
    payload.message = body;
  }

  let status = 'sent';
  try {
    const res = await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      status = 'failed';
      const err = await res.text();
      console.error('AiSensy error:', err);
    }
  } catch (err) {
    status = 'failed';
    console.error('WhatsApp send error:', err.message);
  }

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: body || `[template: ${templateName}]`,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status
  });

  return { sent: status === 'sent', status };
}

export async function logIncomingMessage({ phone, body }) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction: 'in',
    body,
    sent_at: new Date().toISOString(),
    status: 'received'
  });
}
