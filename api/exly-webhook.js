const crypto = require('crypto');
const { getClient } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { notifyMaddy } = require('./_lib/notify');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 28,
};

function verifySignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true; // skip verification if no secret configured
  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'] || '';
  if (!verifySignature(req.body, sig)) {
    return res.status(401).json({ error: 'invalid signature' });
  }

  const sb = getClient();

  try {
    const {
      phone, name, email, program, amount,
      checkout_id, status: paymentStatus,
    } = req.body;

    if (paymentStatus === 'failed') {
      // Payment failure for possible active client
      const { data: existingClient } = await sb
        .from('clients')
        .select('id')
        .eq('phone', phone)
        .eq('status', 'active')
        .single();

      if (existingClient) {
        await notifyMaddy('Payment Failure', `Active client ${phone} payment failed for ${program}`);
      }
      return res.status(200).json({ action: 'payment_failed_logged' });
    }

    if (!phone || !program) {
      return res.status(400).json({ error: 'phone and program required' });
    }

    // Find or create lead
    let { data: lead } = await sb
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!lead) {
      const { data: newLead } = await sb.from('leads').insert({
        phone,
        name: name || null,
        source: 'exly',
        status: 'converted',
      }).select().single();
      lead = newLead;
    } else {
      await sb.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    // FLOW C — Create client
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + durationDays * 86400000);

    const folderPath = `clients/${lead.id}`;

    const { data: client, error } = await sb.from('clients').insert({
      lead_id: lead.id,
      phone,
      name: name || lead.name || null,
      email: email || null,
      program,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount ? Math.round(amount * 100) : null,
      checkout_id: checkout_id || null,
      folder_url: folderPath,
      status: 'active',
    }).select().single();

    if (error) throw error;

    // Create storage folder
    try {
      await sb.storage.from('client-files').upload(
        `${folderPath}/.keep`,
        new Uint8Array(0),
        { contentType: 'application/octet-stream' }
      );
    } catch (_) {
      // folder may already exist
    }

    // Send onboarding template
    await sendTemplate(phone, `onboard_${program}`, [
      name || lead.name || 'there',
      durationDays + ' days',
    ], true);

    // For 12-week program, trigger immediate Week 1 generation
    if (program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (_) {}
    }

    return res.status(200).json({ ok: true, clientId: client.id });
  } catch (err) {
    console.error('exly-webhook error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
