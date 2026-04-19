const crypto = require('crypto');
const { supabase } = require('../lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('../lib/whatsapp');
const { PROGRAM_META, maskPhone } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (process.env.EXLY_WEBHOOK_SECRET) {
      const signature = req.headers['x-exly-signature'] || '';
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');

      if (signature !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const { event, data } = req.body;

    if (event !== 'purchase.completed' && event !== 'payment.success') {
      return res.json({ action: 'ignored', event });
    }

    const phone = data.phone || data.customer_phone || '';
    const email = data.email || data.customer_email || '';
    const name = data.name || data.customer_name || '';
    const amount = parseInt(data.amount || data.paid_amount || 0);
    const checkoutId = data.checkout_id || data.order_id || '';

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const { data: lead } = await supabase
      .from('leads').select('*').eq('phone', phone).maybeSingle();

    const program = lead?.program_interest || inferProgram(amount);
    const meta = PROGRAM_META[program] || PROGRAM_META['6wk_gym'];

    if (lead) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const programEndsAt = new Date();
    programEndsAt.setDate(programEndsAt.getDate() + (meta.weeks * 7));

    const { data: client, error } = await supabase.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name,
      email,
      program,
      paid_amount: amount,
      checkout_id: checkoutId,
      program_ends_at: programEndsAt.toISOString(),
      status: 'active',
    }).select().single();

    if (error) {
      console.error('Client creation error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}`;
    await supabase.storage.from('programs').upload(
      `${folderPath}/.keep`, new Blob(['']), { upsert: true }
    );

    await supabase.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    await sendWhatsApp(phone, `onboard_${program}`, [name || 'there', meta.name]);

    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (genErr) {
        console.error('Week-1 program gen failed:', genErr.message);
      }
    }

    return res.json({ success: true, client_id: client.id, program });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function inferProgram(amount) {
  if (amount <= 25) return 'zoom_trial';
  if (amount <= 50) return 'pcos';
  if (amount <= 55) return '40plus';
  if (amount <= 100) return '6wk_gym';
  return '12wk';
}
