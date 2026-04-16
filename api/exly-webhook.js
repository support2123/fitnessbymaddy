// Exly purchase webhook → lead → client conversion (Flow C).
// Verifies HMAC (sha256, hex) of raw body using EXLY_WEBHOOK_SECRET.

import crypto from 'node:crypto';
import { db } from '../lib/supabase.js';
import { json } from '../lib/http.js';
import { sendWhatsApp } from '../lib/whatsapp.js';
import { normalizePhone, maskPhone } from '../lib/pii.js';
import { detectMarket, copyFor } from '../lib/lang.js';
import { intakeUrl, PROGRAM_CATALOG } from '../lib/routing.js';

// Map Exly product slugs → our program keys.
const PRODUCT_MAP = {
  '6wk-burn-build': '6wk_gym',
  '6wk-burn-build-home': '6wk_home',
  '12wk-flagship': '12wk',
  'pcos-warrior': 'pcos',
  '40plus-strong': '40plus',
  'zoom-trial': 'zoom_trial',
  'zoom-pack': 'zoom_pack'
};

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });

  const raw = await readRaw(req);
  const secret = process.env.EXLY_WEBHOOK_SECRET;

  if (secret) {
    const sig = req.headers['x-exly-signature'] || req.headers['x-signature'] || '';
    const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
    if (!timingSafeEq(sig, expected)) {
      return json(res, 401, { error: 'bad_signature' });
    }
  }

  let body;
  try { body = JSON.parse(raw.toString('utf8') || '{}'); }
  catch { return json(res, 400, { error: 'bad_json' }); }

  const phone = normalizePhone(body.phone || body.mobile || body.customer_phone);
  if (!phone) return json(res, 400, { error: 'missing_phone' });

  const productSlug = body.product_slug || body.product || body.plan || '';
  const program = PRODUCT_MAP[productSlug] || mapByKeyword(productSlug) || null;
  if (!program) {
    console.error(`[exly] unknown product "${productSlug}" for ${maskPhone(phone)}`);
    return json(res, 422, { error: 'unknown_product', product: productSlug });
  }

  const sb = db();
  const market = detectMarket(phone);
  const email = clean(body.email) || null;
  const name = clean(body.name || body.customer_name) || null;
  const checkoutId = clean(body.checkout_id || body.order_id) || null;
  const paid = toNum(body.amount_usd || body.amount) || PROGRAM_CATALOG[program]?.price_usd || null;

  // Find-or-create lead.
  let leadId = null;
  const { data: lead } = await sb.from('leads').select('*').eq('phone', phone).maybeSingle();
  if (lead) {
    leadId = lead.id;
    await sb.from('leads').update({
      status: 'converted',
      name: name || lead.name || null,
      program_interest: program
    }).eq('id', lead.id);
  } else {
    const ins = await sb.from('leads').insert({
      phone, name, source: 'exly', status: 'converted', program_interest: program, market
    }).select().single();
    leadId = ins.data?.id;
  }

  // Upsert client.
  const now = new Date();
  const startedAt = now.toISOString();
  const ends = new Date(now);
  if (program === '12wk') ends.setDate(ends.getDate() + 84);
  else if (program === '6wk_gym' || program === '6wk_home') ends.setDate(ends.getDate() + 42);
  else if (program === 'pcos' || program === '40plus') ends.setDate(ends.getDate() + 28);
  else if (program === 'zoom_pack') ends.setDate(ends.getDate() + 28);
  else ends.setDate(ends.getDate() + 7);

  const { data: existingClient } = await sb.from('clients').select('id').eq('phone', phone).maybeSingle();
  let clientId = existingClient?.id;

  if (existingClient) {
    await sb.from('clients').update({
      lead_id: leadId,
      name, email, program,
      program_started_at: startedAt,
      program_ends_at: ends.toISOString(),
      paid_amount: paid,
      checkout_id: checkoutId,
      status: 'active'
    }).eq('id', existingClient.id);
  } else {
    const ins = await sb.from('clients').insert({
      lead_id: leadId, phone, name, email, program,
      program_started_at: startedAt,
      program_ends_at: ends.toISOString(),
      paid_amount: paid,
      checkout_id: checkoutId,
      status: 'active'
    }).select().single();
    clientId = ins.data?.id;
  }

  // Create storage folder placeholder. Supabase Storage is path-based — upload an empty
  // README to materialise the folder.
  try {
    const folderPath = `${clientId}/README.txt`;
    const content = `Client workspace for ${name || phone}\nProgram: ${program}\n`;
    await sb.storage.from('clients').upload(folderPath, new Blob([content], { type: 'text/plain' }), {
      upsert: true
    });
  } catch (e) {
    console.error('[exly] storage folder create failed', e?.message);
  }

  const folderUrl = `clients/${clientId}/`;
  if (clientId) await sb.from('clients').update({ folder_url: folderUrl }).eq('id', clientId);

  // Welcome message.
  const intake = intakeUrl(leadId || clientId);
  const templateKey = program === '12wk' ? 'onboard_12wk' : 'onboard_generic';
  await sendWhatsApp({
    phone,
    body: copyFor(templateKey, market, { intake }),
    templateName: templateKey,
    campaignName: `onboard_${program}`,
    params: [name || 'there', intake],
    force: true
  });

  // For 12-week: kick off Week 1 program generation immediately.
  if (program === '12wk' && clientId) {
    const url = `${process.env.SITE_URL || 'https://fitnessbymaddy.com'}/api/generate-program`;
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'authorization': `Bearer ${process.env.ADMIN_TOKEN || ''}`
      },
      body: JSON.stringify({ client_id: clientId, week_no: 1 })
    }).catch((e) => console.error('[exly] week1 kickoff failed', e?.message));
  }

  console.log(`[exly] ${maskPhone(phone)} converted → ${program}`);
  return json(res, 200, { ok: true, program, client_id: clientId });
}

function readRaw(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => resolve(Buffer.alloc(0)));
  });
}
function timingSafeEq(a, b) {
  try {
    const A = Buffer.from(String(a), 'hex');
    const B = Buffer.from(String(b), 'hex');
    if (A.length !== B.length) return false;
    return crypto.timingSafeEqual(A, B);
  } catch { return false; }
}
function clean(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s.slice(0, 300) : null;
}
function toNum(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}
function mapByKeyword(slug) {
  const s = String(slug || '').toLowerCase();
  if (s.includes('12')) return '12wk';
  if (s.includes('pcos')) return 'pcos';
  if (s.includes('40')) return '40plus';
  if (s.includes('trial')) return 'zoom_trial';
  if (s.includes('zoom')) return 'zoom_pack';
  if (s.includes('home')) return '6wk_home';
  if (s.includes('6')) return '6wk_gym';
  return null;
}
