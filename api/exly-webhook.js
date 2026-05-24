const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, maskPhone } = require('../lib/whatsapp');
const { PROGRAM_DURATIONS_WEEKS, PROGRAM_NAMES, corsHeaders } = require('../lib/helpers');
const { escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    if (process.env.EXLY_WEBHOOK_SECRET) {
      const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
      if (signature) {
        const expected = crypto
          .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
          .update(JSON.stringify(req.body))
          .digest('hex');
        if (signature !== expected) {
          return res.status(401).json({ error: 'Invalid signature' });
        }
      }
    }

    const {
      phone,
      email,
      name,
      amount,
      checkout_id,
      product_name,
      status: paymentStatus,
    } = req.body;

    if (!phone) return res.status(400).json({ error: 'Phone required' });

    if (paymentStatus === 'failed') {
      await escalateToMaddy('Payment failed', {
        phone,
        summary: `Payment failed for ${name || 'unknown'} — ${product_name || 'unknown program'}`,
      });
      return res.status(200).json({ action: 'payment_failed_escalated' });
    }

    console.log(`Purchase: ${maskPhone(phone)} — ${product_name} — $${amount}`);

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    let program = lead?.program_interest || '6wk_gym';
    if (product_name) {
      const pn = product_name.toLowerCase();
      if (pn.includes('12') || pn.includes('custom')) program = '12wk';
      else if (pn.includes('pcos')) program = 'pcos';
      else if (pn.includes('40')) program = '40plus';
      else if (pn.includes('trial') || pn.includes('zoom')) program = 'zoom_trial';
      else if (pn.includes('home')) program = '6wk_home';
    }

    const durationWeeks = PROGRAM_DURATIONS_WEEKS[program] || 6;
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + durationWeeks * 7 * 24 * 60 * 60 * 1000);

    const { data: client, error } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name || null,
      email: email || null,
      program,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount ? parseInt(amount) : null,
      checkout_id: checkout_id || null,
      folder_url: `/clients/${lead?.id || 'new'}/`,
      status: 'active',
    }).select().single();

    if (error) throw error;

    const folderPath = `clients/${client.id}/`;
    await db.storage
      .from('client-files')
      .upload(`${folderPath}.keep`, new Uint8Array(0), { upsert: true });

    const programName = PROGRAM_NAMES[program] || program;
    await sendWhatsApp(phone, `onboard_${program}`, [
      name || lead?.name || 'there',
      programName,
      `${durationWeeks} weeks`,
    ]);

    return res.status(200).json({ action: 'converted', client_id: client.id });

  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
