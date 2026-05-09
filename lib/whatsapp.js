import supabase from './supabase.js';
import { maskPhone } from './helpers.js';

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

export async function sendWhatsApp(phone, templateName, bodyParams = []) {
  const rateOk = await checkRateLimit(phone);
  if (!rateOk) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { ok: false, reason: 'rate_limited' };
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    templateParams: bodyParams.length ? bodyParams : undefined,
    source: 'automation'
  };

  try {
    const resp = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await resp.json();

    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: bodyParams.join(' | ') || templateName,
      template_name: templateName,
      status: resp.ok ? 'sent' : 'failed'
    });

    return { ok: resp.ok, data: result };
  } catch (err) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, err.message);
    return { ok: false, reason: err.message };
  }
}

export async function sendFreeformWhatsApp(phone, message) {
  const rateOk = await checkRateLimit(phone);
  if (!rateOk) return { ok: false, reason: 'rate_limited' };

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'freeform_message',
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    message,
    source: 'automation'
  };

  try {
    const resp = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await resp.json();

    await supabase.from('messages').insert({
      phone, direction: 'out', body: message,
      template_name: 'freeform', status: resp.ok ? 'sent' : 'failed'
    });

    return { ok: resp.ok, data: result };
  } catch (err) {
    console.error(`Freeform send failed for ${maskPhone(phone)}:`, err.message);
    return { ok: false, reason: err.message };
  }
}

async function checkRateLimit(phone) {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo);

  return (count || 0) < 1;
}

export async function checkClientRateLimit(phone) {
  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .single();

  return !!client;
}
