// Exly purchase webhook → convert lead to client and kick off onboarding.

import crypto from 'node:crypto';
import { supa } from '../lib/supabase.js';
import { sendTemplate, sendText } from '../lib/aisensy.js';
import { Resend } from 'resend';
import { jsonResponse, readBody, normalisePhone, detectMarket } from '../lib/utils.js';
import { COPY } from '../lib/router.js';

const PROGRAM_MAP = {
  '6-week-shred': '6wk_gym',
  '6-week-home': '6wk_home',
  '12-week-flagship': '12wk',
  'pcos-warrior': 'pcos',
  '40-plus-strong': '40plus',
  'zoom-trial': 'zoom_trial',
  'zoom-pack': 'zoom_pack'
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'POST only' });

  // Verify signature if Exly provides one.
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (secret) {
    const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
    const raw = await rawBody(req);
    const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
    if (!sig || !safeEqual(sig, expected)) {
      return jsonResponse(res, 401, { error: 'bad_signature' });
    }
    req.body = JSON.parse(raw.toString('utf8') || '{}');
  }

  const body = req.body !== undefined ? req.body : await readBody(req);
  const phone = normalisePhone(body.phone || body.customer_phone || body.buyer_phone);
  const email = body.email || body.customer_email || null;
  const name  = body.name || body.customer_name || null;
  const amount = toFloat(body.amount || body.paid_amount || body.price);
  const checkoutId = body.checkout_id || body.order_id || body.transaction_id || null;
  const slug = body.program_slug || body.product_slug || body.slug || '';
  const program = PROGRAM_MAP[slug] || body.program || '12wk';

  if (!phone) return jsonResponse(res, 400, { error: 'phone_required' });

  // Attach to lead if we have one.
  const { data: lead } = await supa().from('leads').select('*').eq('phone', phone).maybeSingle();

  const started = new Date();
  const weeks = program === '12wk' ? 12 : (program.startsWith('6wk') ? 6 : (program === 'zoom_pack' ? 4 : 1));
  const ends = new Date(started.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);

  const { data: client, error } = await supa().from('clients').insert({
    lead_id: lead?.id || null,
    phone, email, name,
    program,
    program_started_at: started.toISOString(),
    program_ends_at: ends.toISOString(),
    paid_amount: amount,
    checkout_id: checkoutId,
    status: 'active',
    market: detectMarket(phone),
    folder_url: null
  }).select().single();
  if (error) return jsonResponse(res, 500, { error: error.message });

  // Mark lead converted.
  if (lead) {
    await supa().from('leads').update({ status: 'converted' }).eq('id', lead.id);
  }

  // Create storage folder (via an empty placeholder).
  try {
    await supa().storage.from('clients')
      .upload(`${client.id}/.init`, new Blob([''], { type: 'text/plain' }), { upsert: true });
    await supa().from('clients').update({ folder_url: `clients/${client.id}` }).eq('id', client.id);
  } catch (e) { console.error('folder create failed', e.message); }

  // WhatsApp welcome.
  const market = client.market || detectMarket(phone);
  await sendTemplate({
    phone,
    template: `onboard_${program}`,
    params: [name || 'there'],
    body: (market === 'IN' ? COPY.onboard.IN : COPY.onboard.EN)(programLabel(program))
  });

  // Email receipt.
  if (email && process.env.RESEND_API_KEY) {
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: process.env.RESEND_FROM || 'support@fitnessbymaddy.com',
        to: email,
        subject: `Welcome to ${programLabel(program)} — FitnessByMaddy`,
        text: `Hi ${name || 'there'},\n\nYou're in. Program: ${programLabel(program)}.\nAmount: $${amount || '-'}.\nYour WhatsApp coach channel is live on +917082478374.\n\n— FitnessByMaddy`
      });
    } catch (e) { console.error('resend failed', e.message); }
  }

  // Kick off Week-1 program generation for 12wk.
  if (program === '12wk') {
    fireAndForget('/api/generate-program', { client_id: client.id, week_no: 1 });
  }

  return jsonResponse(res, 200, { ok: true, client_id: client.id });
}

function toFloat(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : null; }
function safeEqual(a, b) {
  try { return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); }
  catch { return false; }
}
function rawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function programLabel(p) {
  return ({
    '6wk_gym': '6-Week Burn & Build',
    '6wk_home': '6-Week Home',
    '12wk': '12-Week Flagship',
    'pcos': 'PCOS Warrior',
    '40plus': '40+ Strong',
    'zoom_trial': 'Zoom Trial',
    'zoom_pack': 'Zoom Coaching Pack'
  })[p] || p;
}
function fireAndForget(path, payload) {
  const base = process.env.SITE_URL || 'https://fitnessbymaddy.com';
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-secret': process.env.SUPABASE_SERVICE_KEY || ''
    },
    body: JSON.stringify(payload)
  }).catch((e) => console.error('fireAndForget', path, e.message));
}
