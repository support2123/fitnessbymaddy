// AiSensy (primary) + Meta Cloud API (fallback) sender.

import { logMessage } from './supabase.js';
import { maskPhone } from './utils.js';

const AISENSY_URL = 'https://backend.aisensy.com/campaign/t1/api/v2';

export async function sendTemplate({ phone, template, params = [], body }) {
  // Prefer AiSensy if key present; fall back to Meta Cloud API.
  const apiKey = process.env.AISENSY_API_KEY;
  if (apiKey && template) {
    return sendViaAiSensy({ phone, template, params, body, apiKey });
  }
  return sendViaMeta({ phone, template, params, body });
}

async function sendViaAiSensy({ phone, template, params, body, apiKey }) {
  const payload = {
    apiKey,
    campaignName: template,
    destination: phone,
    userName: 'FitnessByMaddy',
    templateParams: params,
    source: 'automation'
  };
  let status = 'sent';
  try {
    const r = await fetch(AISENSY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!r.ok) {
      status = `aisensy_${r.status}`;
      const txt = await r.text().catch(() => '');
      console.error('aisensy error', r.status, txt.slice(0, 200));
    }
  } catch (e) {
    status = 'aisensy_error';
    console.error('aisensy throw', e.message, 'to', maskPhone(phone));
  }
  await logMessage({ phone, direction: 'out', body: body || template, template_name: template, status });
  return status;
}

async function sendViaMeta({ phone, template, params, body }) {
  const token = process.env.META_WA_TOKEN;
  const phoneId = process.env.META_WA_PHONE_ID;
  if (!token || !phoneId) {
    await logMessage({ phone, direction: 'out', body: body || template, template_name: template, status: 'no_provider' });
    return 'no_provider';
  }
  // Session text message (requires 24h window); templates need the template endpoint with approved name.
  const payload = template
    ? {
        messaging_product: 'whatsapp',
        to: phone.replace(/^\+/, ''),
        type: 'template',
        template: {
          name: template,
          language: { code: 'en' },
          components: params.length
            ? [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: String(p) })) }]
            : undefined
        }
      }
    : {
        messaging_product: 'whatsapp',
        to: phone.replace(/^\+/, ''),
        type: 'text',
        text: { body: body || '' }
      };
  let status = 'sent';
  try {
    const r = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    if (!r.ok) {
      status = `meta_${r.status}`;
      const txt = await r.text().catch(() => '');
      console.error('meta error', r.status, txt.slice(0, 200));
    }
  } catch (e) {
    status = 'meta_error';
    console.error('meta throw', e.message, 'to', maskPhone(phone));
  }
  await logMessage({ phone, direction: 'out', body: body || template, template_name: template, status });
  return status;
}

export async function sendText({ phone, body }) {
  return sendTemplate({ phone, template: null, body });
}
