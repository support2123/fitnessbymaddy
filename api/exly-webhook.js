const crypto = require('crypto');
const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30,
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    if (!verifyWebhook(req)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const {
      phone, name, email, program, amount,
      checkout_id, status,
    } = parseExlyPayload(req.body);

    if (status !== 'completed' && status !== 'paid') {
      if (status === 'failed') {
        await handlePaymentFailure(phone, name);
      }
      return res.status(200).json({ action: 'ignored', status });
    }

    if (!phone || !program) {
      return res.status(400).json({ error: 'Missing phone or program' });
    }

    const { data: lead } = await supabase
      .from('leads').select('*').eq('phone', phone).limit(1).single();

    if (lead) {
      await supabase.from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const programEnds = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);

    const { data: client, error: clientError } = await supabase
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone,
        name: name || lead?.name || '',
        email: email || '',
        program,
        paid_amount: amount || 0,
        checkout_id: checkout_id || '',
        program_ends_at: programEnds.toISOString(),
        folder_url: '',
        status: 'active',
      })
      .select()
      .single();

    if (clientError) {
      console.error('Client insert error:', clientError);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}`;
    await supabase.storage.from('programs').upload(
      `${folderPath}/.keep`, new Uint8Array(0), { upsert: true }
    );

    await supabase.from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    await sendWhatsApp(phone, `onboard_${program}`, [
      name || 'Champion',
      durationDays.toString(),
    ]);

    // For 12-week program, trigger immediate Week 1 generation
    if (program === '12wk') {
      const baseUrl = `https://${req.headers.host}`;
      fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 }),
      }).catch((err) => console.error('Week 1 generation trigger failed:', err));
    }

    return res.status(200).json({
      action: 'converted',
      client_id: client.id,
      program,
    });
  } catch (err) {
    console.error('Exly webhook error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function verifyWebhook(req) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true; // Skip verification if no secret configured

  const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'] || '';
  if (!signature) return true; // Exly may not always sign

  const expected = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(req.body))
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}

function parseExlyPayload(body) {
  return {
    phone: normalizePhone(body.phone || body.customer_phone || body.mobile || ''),
    name: body.name || body.customer_name || '',
    email: body.email || body.customer_email || '',
    program: body.program || body.product_id || body.plan || '',
    amount: parseInt(body.amount || body.paid_amount || 0),
    checkout_id: body.checkout_id || body.order_id || body.transaction_id || '',
    status: (body.status || body.payment_status || '').toLowerCase(),
  };
}

function normalizePhone(phone) {
  let cleaned = phone.replace(/[^0-9+]/g, '');
  if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
  return cleaned;
}

async function handlePaymentFailure(phone, name) {
  if (!phone) return;
  const { data: client } = await supabase
    .from('clients').select('id').eq('phone', phone).eq('status', 'active').limit(1).single();

  if (client) {
    const { createEscalation } = require('../lib/escalation');
    await createEscalation(phone, client.id, 'Payment failure for active client', `Payment failed for ${name || 'unknown'}`);
  }
}
