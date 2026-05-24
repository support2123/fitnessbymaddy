const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { programLabel } = require('../lib/helpers');
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

    const { customer, product, order } = req.body;
    if (!customer || !customer.phone) {
      return res.status(400).json({ error: 'Missing customer phone' });
    }

    const phone = customer.phone;
    const email = customer.email;
    const name = customer.name || 'Client';

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const program = lead?.program_interest || mapExlyProduct(product?.name);
    const paidAmount = order?.amount || 0;

    const programDuration = {
      '6wk_gym': 42, '6wk_home': 42, '12wk': 84,
      'pcos': 42, '40plus': 42, 'zoom_trial': 7, 'zoom_pack': 30,
    };

    const daysToAdd = programDuration[program] || 42;
    const endsAt = new Date(Date.now() + daysToAdd * 24 * 60 * 60 * 1000).toISOString();

    const { data: client, error } = await supabase.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name,
      email,
      program,
      paid_amount: paidAmount,
      checkout_id: order?.id || null,
      program_ends_at: endsAt,
      status: 'active',
    }).select().single();

    if (error) {
      console.error('Client creation error:', error);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    if (lead) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const welcomeMsg = `Welcome to ${programLabel(program)}! Your journey starts now. We'll send your first check-in form on Day 7.`;
    await sendWhatsApp(phone, 'onboard_' + program, [welcomeMsg]);

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
  if (lower.includes('12') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}
