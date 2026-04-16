// POST /api/exly-webhook — Exly purchase confirmation.
// Auth: header `x-exly-signature` must equal EXLY_WEBHOOK_SECRET.
// Body (canonical): {
//   event: 'order.completed',
//   order_id, amount, currency,
//   customer: { phone, email, name },
//   product: { slug, code }   // code matches our program_code enum
// }
import { db, STORAGE_BUCKET } from './_lib/supabase.js';
import { sendWhatsApp } from './_lib/whatsapp.js';
import { template } from './_lib/templates.js';
import { marketForPhone } from './_lib/market.js';
import { normalisePhone, readJson } from './_lib/util.js';

const SLUG_TO_PROGRAM = {
  '6-week-burn-build': '6wk_gym',
  '6-week-burn-build-home': '6wk_home',
  '12-week-flagship': '12wk',
  'pcos-warrior': 'pcos',
  '40-plus-strong': '40plus',
  'zoom-trial': 'zoom_trial',
  'zoom-pack': 'zoom_pack',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });

  const expected = process.env.EXLY_WEBHOOK_SECRET;
  const got = req.headers['x-exly-signature'] || req.headers['x-webhook-secret'];
  if (expected && got !== expected) {
    return res.status(401).json({ ok: false, error: 'bad signature' });
  }

  const body = await readJson(req);
  if (body.event && body.event !== 'order.completed') {
    return res.status(200).json({ ok: true, ignored: body.event });
  }

  const phone = normalisePhone(body.customer?.phone);
  if (!phone) return res.status(400).json({ ok: false, error: 'phone required' });

  const program =
    body.product?.code ||
    SLUG_TO_PROGRAM[body.product?.slug] ||
    '6wk_gym';

  const supa = db();

  // Find or create lead.
  let leadId = null;
  const { data: lead } = await supa
    .from('leads').select('id').eq('phone', phone).maybeSingle();
  if (lead) {
    leadId = lead.id;
    await supa.from('leads').update({ status: 'converted' }).eq('id', leadId);
  } else {
    const ins = await supa.from('leads').insert({
      phone, name: body.customer?.name || null, source: 'exly',
      status: 'converted', market: marketForPhone(phone),
      first_msg: 'direct purchase',
      last_msg_at: new Date().toISOString(),
    }).select().single();
    leadId = ins.data?.id || null;
  }

  // Create / refresh client.
  const startedAt = new Date();
  const endsAt = new Date(startedAt);
  endsAt.setDate(endsAt.getDate() + programLengthDays(program));

  const { data: client, error: cliErr } = await supa.from('clients').upsert({
    lead_id: leadId,
    phone,
    name: body.customer?.name || null,
    email: body.customer?.email || null,
    program,
    program_started_at: startedAt.toISOString(),
    program_ends_at: endsAt.toISOString(),
    paid_amount: body.amount ?? null,
    checkout_id: body.order_id ?? null,
    status: 'active',
  }, { onConflict: 'phone' }).select().single();
  if (cliErr) return res.status(500).json({ ok: false, error: cliErr.message });

  // Ensure storage folder marker.
  try {
    const marker = new Blob([`Client folder for ${client.id}`], { type: 'text/plain' });
    await supa.storage.from(STORAGE_BUCKET)
      .upload(`${client.id}/.init`, marker, { upsert: true });
  } catch { /* bucket may not exist yet on first run; safe to ignore */ }

  await supa.from('clients').update({
    folder_url: `${process.env.SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${client.id}/`,
  }).eq('id', client.id);

  const market = marketForPhone(phone);
  const tplName = program === '12wk' ? 'onboard_12wk' : 'onboard_default';
  const t = template(tplName, market);
  await sendWhatsApp({
    phone, body: t.body, templateName: t.name, bypassRateLimit: true,
    meta: { kind: 'onboarding', program },
  });

  // For 12-week, immediately fire program generation for week 1.
  if (program === '12wk') {
    fetch(`${process.env.PUBLIC_SITE_URL || ''}/api/generate-program`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-cron-secret': process.env.CRON_SECRET || '',
      },
      body: JSON.stringify({ client_id: client.id, week_no: 1 }),
    }).catch(() => {});
  }

  return res.status(200).json({ ok: true, client_id: client.id });
}

function programLengthDays(program) {
  switch (program) {
    case '12wk': return 84;
    case '6wk_gym':
    case '6wk_home':
    case 'pcos':
    case '40plus': return 42;
    case 'zoom_pack': return 28;
    case 'zoom_trial': return 7;
    default: return 42;
  }
}
