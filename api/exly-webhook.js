// POST /api/exly-webhook
// Exly (checkout) fires this on successful payment. We promote the
// matching lead → client, create their Storage folder, send the
// onboarding template, and schedule the first check-in.

import { supabase, STORAGE_BUCKET } from './_lib/supabase.js';
import { sendTemplate } from './_lib/whatsapp.js';
import {
  normalizePhone, detectMarket, randomToken, json,
} from './_lib/utils.js';
import { openEscalation } from './_lib/escalation.js';

const PROGRAM_ALIAS = {
  // Map Exly's SKU / product codes → our internal program enum.
  '6wk_gym': '6wk_gym', '6wk_home': '6wk_home',
  '12wk': '12wk', 'pcos': 'pcos', '40plus': '40plus',
  'zoom_trial': 'zoom_trial', 'zoom_pack': 'zoom_pack',
  'burn_build': '6wk_gym', 'home_edition': '6wk_home',
  'flagship': '12wk', 'warrior': 'pcos', 'forty_plus': '40plus',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });

  // Verify shared secret (Exly sends via custom header or query param).
  const expected = process.env.EXLY_WEBHOOK_SECRET;
  if (expected) {
    const got = req.headers['x-exly-secret'] || req.query.secret;
    if (got !== expected) return json(res, 401, { error: 'unauthorized' });
  }

  const b = req.body || {};
  const phone = normalizePhone(b.phone || b.customer_phone || b.whatsapp);
  const email = (b.email || b.customer_email || '').trim() || null;
  const name  = (b.name  || b.customer_name  || '').trim() || null;
  const sku   = (b.sku   || b.product_code   || b.program  || '').toLowerCase();
  const program = PROGRAM_ALIAS[sku] || PROGRAM_ALIAS[b.program_key] || null;
  const paid = Number(b.amount || b.paid_amount || 0);
  const currency = (b.currency || 'USD').toUpperCase();
  const checkoutId = String(b.checkout_id || b.order_id || b.ref || '');

  if (!phone || !program) {
    return json(res, 400, { error: 'missing_phone_or_program' });
  }

  // Idempotency: if we already have an active client for this phone + program, bail.
  const { data: existing } = await supabase.from('clients')
    .select('id').eq('phone', phone).eq('program', program)
    .in('status', ['active','paused']).maybeSingle();
  if (existing) return json(res, 200, { ok: true, already: existing.id });

  // Promote lead → client.
  const { data: lead } = await supabase.from('leads')
    .select('id').eq('phone', phone).maybeSingle();

  const { data: client, error } = await supabase.from('clients').insert({
    lead_id: lead?.id || null,
    phone, name, email, program,
    paid_amount: paid, currency, checkout_id: checkoutId,
    program_started_at: new Date().toISOString(),
    program_ends_at: programEnd(program),
  }).select().single();

  if (error) {
    console.error('[exly] insert failed', error.message);
    return json(res, 500, { error: 'insert_failed' });
  }

  if (lead?.id) {
    await supabase.from('leads')
      .update({ status: 'converted' }).eq('id', lead.id);
  }

  // Storage folder placeholder — creates the prefix by writing a keep file.
  try {
    await supabase.storage.from(STORAGE_BUCKET).upload(
      `clients/${client.id}/.keep`,
      Buffer.from(''),
      { upsert: true, contentType: 'text/plain' },
    );
  } catch (e) {
    console.warn('[exly] storage folder init failed', e?.message);
  }

  // Welcome template.
  const market = detectMarket(phone);
  await sendTemplate({
    phone, templateName: `onboard_${program}`, market,
    isClient: true, force: true,
  });

  // Pre-create Week-1 check-in row for Sunday cron to pick up.
  const token = randomToken();
  await supabase.from('checkins').insert({
    client_id: client.id, week_no: 1, token,
  });

  // If 12-week: kick off Week-1 program generation immediately.
  if (program === '12wk') {
    fetch(`${process.env.PUBLIC_SITE_URL || ''}/api/generate-program`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.CRON_SECRET || ''}`,
      },
      body: JSON.stringify({ client_id: client.id, week_no: 1 }),
    }).catch(e => console.error('[exly] gen1 failed', e?.message));
  }

  return json(res, 200, { ok: true, client_id: client.id });
}

function programEnd(program) {
  const d = new Date();
  const weeks = program.startsWith('6wk') ? 6 : program === '12wk' ? 12 :
                program === 'pcos' ? 8 : program === '40plus' ? 8 : null;
  if (!weeks) return null;
  d.setDate(d.getDate() + weeks * 7);
  return d.toISOString();
}
