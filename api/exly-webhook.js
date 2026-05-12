import supabase from '../lib/supabase.js';
import { sendTemplate } from '../lib/whatsapp.js';
import { getProgramDetails, getCheckinUrl, jsonResponse, corsHeaders } from '../lib/helpers.js';

export default async function handler(req, res) {
  if (corsHeaders(req, res)) return;
  if (req.method !== 'POST') return jsonResponse(res, { error: 'POST only' }, 405);

  const secret = req.headers['x-webhook-secret'] || req.body?.webhook_secret;
  if (process.env.EXLY_WEBHOOK_SECRET && secret !== process.env.EXLY_WEBHOOK_SECRET) {
    return jsonResponse(res, { error: 'Invalid webhook secret' }, 403);
  }

  try {
    const { phone, email, name, checkout_id, amount, program } = parseExlyPayload(req.body);
    if (!phone) return jsonResponse(res, { error: 'Missing phone' }, 400);

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const programKey = program || lead?.program_interest || '6wk_gym';
    const details = getProgramDetails(programKey);
    const weeks = details?.weeks || 6;

    const programEndsAt = new Date();
    programEndsAt.setDate(programEndsAt.getDate() + weeks * 7);

    const { data: client, error } = await supabase.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name || null,
      email: email || null,
      program: programKey,
      program_started_at: new Date().toISOString(),
      program_ends_at: programEndsAt.toISOString(),
      paid_amount: amount ? parseInt(amount) : details?.price || 0,
      checkout_id: checkout_id || null,
      folder_url: null,
      status: 'active',
    }).select().single();

    if (error) throw error;

    if (lead) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const folderPath = `clients/${client.id}`;
    await supabase.storage.from('clients').upload(`${folderPath}/.keep`, new Blob(['']));
    await supabase.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    await sendTemplate(phone, `onboard_${programKey}`, [
      name || 'there',
      details?.name || programKey,
    ]);

    if (programKey === '12wk') {
      try {
        const baseUrl = getBaseUrl(req);
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
          },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (genErr) {
        console.error('Week 1 program generation failed:', genErr.message);
      }
    }

    return jsonResponse(res, { ok: true, client_id: client.id, program: programKey });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return jsonResponse(res, { error: 'Processing failed' }, 500);
  }
}

function parseExlyPayload(body) {
  return {
    phone: body.phone || body.customer_phone || body.mobile || '',
    email: body.email || body.customer_email || '',
    name: body.name || body.customer_name || '',
    checkout_id: body.checkout_id || body.order_id || body.transaction_id || '',
    amount: body.amount || body.total || body.paid_amount || 0,
    program: body.program || body.product_name || body.item || '',
  };
}

function getBaseUrl(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'fitnessbymaddy.com';
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}`;
}
