const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { programWeeks, programLabel } = require('./_lib/helpers');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

    const { checkout_id, customer_phone, customer_name, customer_email, amount, product_name } = req.body;

    if (!customer_phone) {
      return res.status(400).json({ error: 'customer_phone required' });
    }

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', customer_phone)
      .limit(1)
      .single();

    const program = lead?.program_interest || detectProgramFromProduct(product_name);
    const weeks = programWeeks(program);
    const now = new Date();
    const endsAt = new Date(now.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);

    const { data: client } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone: customer_phone,
      name: customer_name || lead?.name,
      email: customer_email,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount ? Math.round(amount * 100) : null,
      checkout_id,
      folder_url: `/clients/${lead?.id || 'unknown'}/`,
      status: 'active',
    }).select().single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const label = programLabel(program);
    await sendWhatsApp({
      phone: customer_phone,
      templateName: `onboard_${program}`,
      bodyValues: [customer_name || 'there', label, `${weeks} weeks`],
    });

    await db.from('messages').insert({
      phone: customer_phone.slice(0, 4) + 'XXX...' + customer_phone.slice(-3),
      direction: 'out',
      body: `Onboarding: ${label}`,
      template_name: `onboard_${program}`,
      status: 'sent',
    });

    return res.status(200).json({ ok: true, client_id: client?.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function detectProgramFromProduct(name) {
  if (!name) return '6wk_gym';
  const lower = name.toLowerCase();
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}
