const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalation');
const { programWeeks, maskPhone } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

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

    const body = req.body || {};
    const {
      phone, email, name, checkout_id,
      amount, product_name, status,
    } = body;

    if (status === 'failed') {
      const { data: lead } = await db
        .from('leads')
        .select('*')
        .eq('phone', phone)
        .limit(1);

      if (lead && lead.length > 0) {
        await escalateToMaddy({
          reason: 'Payment failed for lead',
          phone,
          clientName: name,
          details: `Checkout: ${checkout_id}, Amount: ${amount}`,
        });
      }
      return res.status(200).json({ action: 'payment_failed_noted' });
    }

    if (!phone) return res.status(400).json({ error: 'Phone required' });

    const program = mapExlyProduct(product_name);
    const weeks = programWeeks(program);
    const endsAt = new Date();
    endsAt.setDate(endsAt.getDate() + weeks * 7);

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1);

    const leadId = lead && lead.length > 0 ? lead[0].id : null;

    if (leadId) {
      await db.from('leads').update({ status: 'converted' }).eq('id', leadId);
    }

    const folderPath = `clients/${Date.now()}`;

    const { data: client, error: clientErr } = await db.from('clients').insert({
      lead_id: leadId,
      phone,
      name: name || (lead && lead[0]?.name) || null,
      email,
      program,
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount ? parseInt(amount) : null,
      checkout_id,
      folder_url: folderPath,
      status: 'active',
    }).select().single();

    if (clientErr) {
      console.error('Client insert error:', clientErr.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    await sendWhatsApp({
      phone,
      templateName: `onboard_${program}`,
      bodyValues: [name || 'there', programWeeks(program).toString()],
    });

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host || 'fitnessbymaddy.com'}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch {}
    }

    return res.status(200).json({ success: true, client_id: client.id });

  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapExlyProduct(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}
