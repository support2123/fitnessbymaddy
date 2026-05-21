const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { programDurationWeeks } = require('../lib/utils');

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

    const {
      phone,
      email,
      name,
      amount,
      checkout_id,
      product_name,
    } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Phone required' });
    }

    const db = getSupabase();

    const program = mapExlyProduct(product_name);
    const durationWeeks = programDurationWeeks(program);

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    let leadId = lead?.id;

    if (!lead) {
      const { data: newLead } = await db
        .from('leads')
        .insert({
          phone,
          name,
          source: 'exly',
          status: 'converted',
          program_interest: program,
        })
        .select('id')
        .single();
      leadId = newLead.id;
    } else {
      await db
        .from('leads')
        .update({ status: 'converted', program_interest: program })
        .eq('id', lead.id);
    }

    const now = new Date();
    const endsAt = new Date(now.getTime() + durationWeeks * 7 * 24 * 60 * 60 * 1000);

    const { data: client } = await db
      .from('clients')
      .insert({
        lead_id: leadId,
        phone,
        name: name || lead?.name,
        email,
        program,
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: amount,
        checkout_id,
        folder_url: `/clients/${leadId}/`,
        status: 'active',
      })
      .select('id')
      .single();

    await sendWhatsApp(phone, `onboard_${program}`, [
      name || 'there',
      `${durationWeeks} weeks`,
    ]);

    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: client.id,
            week_no: 1,
          }),
        });
      } catch (e) {
        console.error('Week 1 program generation failed:', e.message);
      }
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
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial') || lower.includes('zoom trial')) return 'zoom_trial';
  if (lower.includes('zoom pack')) return 'zoom_pack';
  return '6wk_gym';
}
