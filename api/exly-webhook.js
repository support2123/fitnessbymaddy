const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const signature = req.headers['x-exly-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && signature) {
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (signature !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const { email, phone, name, product, amount, checkout_id, status } = req.body;

    if (status !== 'completed' && status !== 'paid') {
      return res.status(200).json({ action: 'ignored', reason: 'not_paid' });
    }

    if (!phone) {
      return res.status(400).json({ error: 'No phone in payload' });
    }

    const db = getSupabase();

    const programMap = {
      '6_week_shred': '6wk_gym',
      '6_week_home': '6wk_home',
      '12_week_custom': '12wk',
      'pcos_warrior': 'pcos',
      '40_plus': '40plus',
      'zoom_trial': 'zoom_trial',
      'zoom_pack': 'zoom_pack'
    };

    const program = programMap[product] || product || '6wk_gym';
    const now = new Date();
    const programWeeks = program === '12wk' ? 12 : 6;
    const endsAt = new Date(now.getTime() + programWeeks * 7 * 24 * 60 * 60 * 1000);

    const { data: lead } = await db
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const { data: client, error: clientErr } = await db.from('clients').upsert({
      lead_id: lead?.id || null,
      phone,
      name: name || null,
      email: email || null,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount ? parseFloat(amount) : null,
      checkout_id: checkout_id || null,
      status: 'active'
    }, { onConflict: 'phone' }).select().single();

    if (clientErr) throw clientErr;

    await sendWhatsApp(phone, `onboard_${program}`, {
      name: name || 'there',
      templateParams: [name || 'there', programWeeks.toString()]
    });

    if (program === '12wk') {
      await fetch(`${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : ''}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      });
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
