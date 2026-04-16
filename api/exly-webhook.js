// Exly purchase webhook. Promotes a lead to a client and fires onboarding.
// Verifies HMAC signature with EXLY_WEBHOOK_SECRET.

import crypto from 'node:crypto';
import { db } from '../lib/supabase.js';
import { sendWhatsApp } from '../lib/whatsapp.js';
import { render } from '../lib/templates.js';
import { detectMarket } from '../lib/market.js';
import { readJson, json, methodNotAllowed } from '../lib/http.js';

function verifySignature(raw, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true; // dev mode
  if (!signature) return false;
  const mac = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(String(signature))); }
  catch { return false; }
}

const SLUG_TO_PROGRAM = {
  '6-week-burn-build': '6wk_gym',
  '6-week-home':       '6wk_home',
  'pcos-warrior':      'pcos',
  '40plus-strong':     '40plus',
  '12-week-flagship':  '12wk',
  'zoom-trial':        'zoom_trial',
  'zoom-pack':         'zoom_pack'
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST');

  // Read raw body for HMAC
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const signature = req.headers['x-exly-signature'] || req.headers['x-signature'];
  if (!verifySignature(raw, signature)) {
    return json(res, 401, { ok: false, error: 'bad_signature' });
  }
  let body = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch { return json(res, 400, { ok: false, error: 'bad_json' }); }

  const {
    phone, email, name, amount, currency = 'USD',
    checkout_id, product_slug, status: purchaseStatus
  } = body;

  if (purchaseStatus && purchaseStatus !== 'paid' && purchaseStatus !== 'success') {
    return json(res, 200, { ok: true, ignored: purchaseStatus });
  }
  const program = SLUG_TO_PROGRAM[product_slug];
  if (!phone || !program) return json(res, 400, { ok: false, error: 'missing_phone_or_program' });

  const normPhone = '+' + String(phone).replace(/^\+?/, '');
  const market = detectMarket(normPhone);

  // Find existing lead
  const { data: lead } = await db().from('leads')
    .select('id').eq('phone', normPhone).maybeSingle();

  // Upsert client
  const started = new Date();
  const weeks = program === '12wk' ? 12 : (program.startsWith('6wk') ? 6 : 4);
  const ends = new Date(started.getTime() + weeks * 7 * 24 * 3600 * 1000);

  const { data: client } = await db().from('clients').upsert({
    lead_id: lead?.id || null,
    phone: normPhone, name, email, program,
    program_started_at: started.toISOString(),
    program_ends_at: ends.toISOString(),
    paid_amount: amount ? Number(amount) : null,
    checkout_id,
    status: 'active'
  }, { onConflict: 'phone,program' }).select().single();

  // Create the storage folder marker (actual folder is created implicitly on first upload)
  const folderUrl = `clients/${client.id}/`;
  await db().from('clients').update({ folder_url: folderUrl }).eq('id', client.id);

  // Mark lead as converted
  if (lead?.id) await db().from('leads').update({ status: 'converted' }).eq('id', lead.id);

  // Onboarding WhatsApp
  const tplName = `onboard_${program}`;
  try {
    const t = render(tplName, market, { name });
    await sendWhatsApp({ phone: normPhone, body: t.body, templateName: t.name, force: true });
  } catch (err) {
    console.error('onboard template missing', tplName);
  }

  // For 12-week, kick off Week-1 program generation immediately
  if (program === '12wk') {
    const base = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '';
    fetch(`${base}/api/generate-program`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal': process.env.CRON_SECRET || '' },
      body: JSON.stringify({ client_id: client.id, week_no: 1 })
    }).catch(err => console.error('week1 gen dispatch', err.message));
  }

  return json(res, 200, { ok: true, client_id: client.id });
}
