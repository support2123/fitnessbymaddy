import crypto from 'node:crypto';
import { supa } from './_lib/supabase.js';
import { normalizePhone } from './_lib/mask.js';
import { json, readBody, requireMethod } from './_lib/http.js';
import { sendWhatsApp } from './_lib/whatsapp.js';
import { render, TEMPLATES } from './_lib/templates.js';
import { marketFromPhone } from './_lib/market.js';

// Map Exly product slugs/ids → internal program codes.
const PRODUCT_TO_PROGRAM = {
  '6wk_gym': '6wk_gym',
  '6wk_home': '6wk_home',
  '12wk': '12wk',
  'pcos': 'pcos',
  '40plus': '40plus',
  'zoom_trial': 'zoom_trial',
  'zoom_pack': 'zoom_pack'
};

function programLength(program) {
  if (program === '12wk') return 84;
  if (program.startsWith('6wk')) return 42;
  if (program === 'pcos' || program === '40plus') return 42;
  return 30;
}

export default async function handler(req, res) {
  if (!requireMethod(req, res, 'POST')) return;

  try {
    const body = await readBody(req);

    // Optional HMAC verify
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret) {
      const sig = req.headers['x-exly-signature'];
      const raw = JSON.stringify(body);
      const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
      if (!sig || sig !== expected) return json(res, 401, { error: 'bad signature' });
    }

    const {
      product_id, product_slug,
      customer_name, customer_email, customer_phone,
      checkout_id, amount_paid
    } = body;

    const program = PRODUCT_TO_PROGRAM[product_slug] || PRODUCT_TO_PROGRAM[product_id];
    if (!program) return json(res, 400, { error: 'unknown product' });

    const phone = normalizePhone(customer_phone);
    const db = supa();

    // Find lead
    const { data: lead } = await db.from('leads').select('*').eq('phone', phone).maybeSingle();

    // Promote to client
    const startsAt = new Date();
    const endsAt = new Date(startsAt.getTime() + programLength(program) * 24 * 60 * 60 * 1000);

    const { data: client, error } = await db.from('clients').upsert({
      lead_id: lead?.id,
      phone,
      name: customer_name || lead?.name,
      email: customer_email,
      program,
      program_started_at: startsAt.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount_paid,
      checkout_id,
      status: 'active'
    }, { onConflict: 'phone' }).select().single();
    if (error) throw error;

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    // Create Storage folder placeholder
    const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'clients';
    try {
      await db.storage.from(bucket).upload(
        `clients/${client.id}/.init`,
        Buffer.from(`created ${new Date().toISOString()}\n`),
        { contentType: 'text/plain', upsert: true }
      );
      const folder_url = `${process.env.SUPABASE_URL}/storage/v1/object/public/${bucket}/clients/${client.id}`;
      await db.from('clients').update({ folder_url }).eq('id', client.id);
    } catch (e) {
      console.error('folder init failed', e?.message || e);
    }

    // Welcome template
    const { lang } = marketFromPhone(phone);
    const tplKey = `onboard_${program}`;
    const tpl = TEMPLATES[tplKey];
    if (tpl) {
      await sendWhatsApp({
        to: phone,
        templateName: tpl.name,
        body: render(tplKey, lang, { name: client.name || 'there' }),
        params: [client.name || 'there'],
        bypassRateLimit: true
      });
    }

    // Kick first program for 12wk
    if (program === '12wk') {
      const site = process.env.SITE_URL || '';
      if (site) {
        fetch(`${site}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-admin-token': process.env.ADMIN_TOKEN || '' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        }).catch(() => {});
      }
    }

    return json(res, 200, { ok: true, client_id: client.id });
  } catch (e) {
    console.error('exly-webhook error', e.message);
    return json(res, 500, { error: 'internal' });
  }
}
