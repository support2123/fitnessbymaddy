const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('./lib/whatsapp');
const { maskPhone } = require('./lib/market');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const signature = req.headers['x-exly-signature'] || '';
    if (process.env.EXLY_WEBHOOK_SECRET && signature) {
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (signature !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      checkout_id, phone, name, email,
      amount, program, status,
    } = req.body;

    if (status === 'failed') {
      const db = getSupabase();
      const { data: client } = await db
        .from('clients')
        .select('id, name, phone')
        .eq('phone', phone)
        .eq('status', 'active')
        .single();

      if (client) {
        await notifyMaddy(
          `Payment FAILED — ${name || maskPhone(phone)}`,
          `Active client payment failed.\nPhone: ${maskPhone(phone)}\nAmount: $${amount}\nCheckout: ${checkout_id}`
        );
      }
      return res.json({ action: 'payment_failed_logged' });
    }

    if (status !== 'success' && status !== 'completed') {
      return res.json({ action: 'ignored', status });
    }

    const db = getSupabase();
    const normalizedPhone = '+' + (phone || '').replace('+', '');

    const { data: lead } = await db
      .from('leads')
      .select('id')
      .eq('phone', normalizedPhone)
      .limit(1)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const programMap = {
      '6_week_shred': '6wk_gym',
      '6_week_home': '6wk_home',
      '12_week_custom': '12wk',
      'pcos_warrior': 'pcos',
      '40_plus': '40plus',
      'zoom_trial': 'zoom_trial',
      'zoom_pack': 'zoom_pack',
    };
    const normalizedProgram = programMap[program] || program || '6wk_gym';

    const programWeeks = {
      '6wk_gym': 6, '6wk_home': 6, '12wk': 12,
      'pcos': 8, '40plus': 8, 'zoom_trial': 1, 'zoom_pack': 8,
    };
    const weeks = programWeeks[normalizedProgram] || 6;
    const endsAt = new Date();
    endsAt.setDate(endsAt.getDate() + weeks * 7);

    const { data: client, error } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone: normalizedPhone,
      name: name || '',
      email: email || '',
      program: normalizedProgram,
      program_started_at: new Date().toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: parseFloat(amount) || 0,
      checkout_id: checkout_id || '',
      status: 'active',
    }).select().single();

    if (error) {
      console.error('Client insert error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}`;
    await db.storage.from('programs').upload(
      `${folderPath}/.keep`,
      new Uint8Array(0),
      { contentType: 'text/plain', upsert: true }
    );

    await db.from('clients').update({
      folder_url: folderPath,
    }).eq('id', client.id);

    await sendWhatsApp(normalizedPhone, `onboard_${normalizedProgram}`, [
      name || 'Champion',
    ]);

    if (normalizedProgram === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://www.fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (err) {
        console.error('Week-1 program generation failed:', err.message);
      }
    }

    return res.json({ action: 'converted', client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
