const crypto = require('crypto');
const { supabase } = require('./_lib/supabase');
const { sendTemplate, notifyMaddy } = require('./_lib/whatsapp');

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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && signature) {
      const expected = crypto.createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (signature !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const { phone, email, name, amount, checkout_id, product_id, product_name } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    const normalizedPhone = phone.startsWith('+') ? phone : '+' + phone;

    let program = product_id || null;
    if (!program && product_name) {
      const lower = product_name.toLowerCase();
      if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) program = '12wk';
      else if (lower.includes('pcos')) program = 'pcos';
      else if (lower.includes('40')) program = '40plus';
      else if (lower.includes('trial') || lower.includes('zoom')) program = 'zoom_trial';
      else if (lower.includes('home')) program = '6wk_home';
      else program = '6wk_gym';
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', normalizedPhone)
      .single();

    if (lead) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const programStart = new Date();
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const programEnd = new Date(programStart.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const folderPath = `clients/${Date.now()}_${normalizedPhone.replace('+', '')}`;

    const { data: client, error } = await supabase.from('clients').insert({
      lead_id: lead?.id || null,
      phone: normalizedPhone,
      name: name || lead?.name || null,
      email: email || null,
      program,
      program_started_at: programStart.toISOString(),
      program_ends_at: programEnd.toISOString(),
      paid_amount: amount ? Math.round(parseFloat(amount) * 100) : null,
      checkout_id: checkout_id || null,
      folder_url: folderPath,
      status: 'active'
    }).select().single();

    if (error) {
      console.error('Client insert error:', error.message);
      if (error.code === '23505') {
        return res.status(200).json({ ok: true, note: 'duplicate' });
      }
      return res.status(500).json({ error: 'Failed to create client' });
    }

    await supabase.storage.from('clients').upload(
      `${folderPath}/.keep`,
      new Uint8Array([]),
      { contentType: 'text/plain' }
    );

    const templateName = `onboard_${program}`;
    await sendTemplate(normalizedPhone, templateName, [name || 'there'], true);

    if (program === '12wk') {
      const origin = `https://${req.headers.host}`;
      fetch(`${origin}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      }).catch(() => {});
    }

    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    await notifyMaddy('Payment webhook error', `Error: ${err.message}`).catch(() => {});
    return res.status(500).json({ error: 'Internal error' });
  }
};
