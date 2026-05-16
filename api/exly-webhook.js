const crypto = require('crypto');
const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { escalateToMaddy } = require('../lib/escalation');

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

    const {
      customer_phone,
      customer_name,
      customer_email,
      product_name,
      amount,
      checkout_id,
      currency,
    } = req.body;

    if (!customer_phone) {
      return res.status(400).json({ error: 'Missing customer phone' });
    }

    const phone = customer_phone.replace(/[^0-9]/g, '');
    const program = mapExlyProduct(product_name);
    const market = detectMarket(phone);

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .maybeSingle();

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const programEnd = new Date();
    if (program === '12wk') {
      programEnd.setDate(programEnd.getDate() + 84);
    } else if (program.startsWith('6wk')) {
      programEnd.setDate(programEnd.getDate() + 42);
    } else {
      programEnd.setDate(programEnd.getDate() + 42);
    }

    const { data: client, error } = await supabase
      .from('clients')
      .insert({
        lead_id: lead ? lead.id : null,
        phone,
        name: customer_name || (lead ? lead.name : null),
        email: customer_email || null,
        program,
        program_started_at: new Date().toISOString(),
        program_ends_at: programEnd.toISOString(),
        paid_amount: amount || 0,
        checkout_id: checkout_id || null,
        status: 'active',
      })
      .select()
      .single();

    if (error) {
      console.error('Client insert error:', error.message);
      await escalateToMaddy(phone, 'Payment received but client creation failed', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    await supabase.storage
      .from('clients')
      .upload(`${client.id}/.keep`, new Uint8Array(0), {
        contentType: 'application/octet-stream',
        upsert: true,
      });

    const templateName = `onboard_${program}`;
    const params = isHinglish(market)
      ? [customer_name || 'there', program]
      : [customer_name || 'there', program];
    await sendTemplate(phone, templateName, params);

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
        console.error('Week-1 generation trigger error:', genErr.message);
      }
    }

    return res.status(200).json({
      success: true,
      clientId: client.id,
      program,
    });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function mapExlyProduct(productName) {
  const lower = (productName || '').toLowerCase();
  if (lower.includes('12') || lower.includes('twelve') || lower.includes('flagship')) return '12wk';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('forty')) return '40plus';
  if (lower.includes('zoom') || lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}
