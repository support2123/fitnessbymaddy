const crypto = require('crypto');
const { supabase } = require('./_lib/supabase');
const { sendWhatsAppWithRateLimit } = require('./_lib/whatsapp');
const { cors, parseBody, programWeeks } = require('./_lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = await parseBody(req);

    if (process.env.EXLY_WEBHOOK_SECRET) {
      const sig = req.headers['x-exly-signature'] || '';
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(body))
        .digest('hex');
      if (sig !== expected) {
        return res.status(401).json({ error: 'invalid signature' });
      }
    }

    const {
      phone, name, email, program, amount,
      checkout_id, lead_id,
    } = body;

    const cleanPhone = (phone || '').replace(/[^0-9]/g, '');
    if (!cleanPhone) return res.status(400).json({ error: 'phone required' });

    let resolvedLeadId = lead_id;
    if (!resolvedLeadId) {
      const { data: lead } = await supabase
        .from('leads')
        .select('id')
        .eq('phone', cleanPhone)
        .single();
      resolvedLeadId = lead?.id || null;
    }

    if (resolvedLeadId) {
      await supabase.from('leads')
        .update({ status: 'converted' })
        .eq('id', resolvedLeadId);
    }

    const programKey = program || '6wk_gym';
    const weeks = programWeeks(programKey);
    const now = new Date();
    const endsAt = new Date(now.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);

    const { data: client, error } = await supabase.from('clients').insert({
      lead_id: resolvedLeadId,
      phone: cleanPhone,
      name: name || null,
      email: email || null,
      program: programKey,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount ? parseInt(amount, 10) : null,
      checkout_id: checkout_id || null,
      folder_url: `clients/${cleanPhone}/`,
      status: 'active',
    }).select().single();

    if (error) throw error;

    const folderPath = `clients/${client.id}/.keep`;
    await supabase.storage
      .from('clients')
      .upload(folderPath, new Uint8Array(0), { upsert: true });

    await sendWhatsAppWithRateLimit(
      cleanPhone,
      `onboard_${programKey}`,
      [name || 'there'],
      name || 'there',
      true
    );

    if (programKey === '12wk') {
      try {
        const origin = `https://${req.headers.host || 'www.fitnessbymaddy.com'}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (genErr) {
        console.error('week-1 program generation failed:', genErr.message);
      }
    }

    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('exly-webhook error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
