const crypto = require('crypto');
const { supabase } = require('./_lib/supabase');
const { sendTemplate, notifyMaddy } = require('./_lib/whatsapp');
const { detectMarket, isHinglish } = require('./_lib/market');

const PROGRAM_MAP = {
  '6_week_shred': '6wk_gym',
  '6_week_home': '6wk_home',
  '12_week_custom': '12wk',
  'pcos_warrior': 'pcos',
  '40_plus': '40plus',
  'zoom_trial': 'zoom_trial',
  'zoom_pack': 'zoom_pack'
};

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  try {
    if (process.env.EXLY_WEBHOOK_SECRET) {
      const sig = req.headers['x-exly-signature'] || '';
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (sig !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const { customer_phone, customer_name, customer_email, product_id, product_name, amount, checkout_id, status } = req.body;

    if (status !== 'completed' && status !== 'paid') {
      if (status === 'failed') {
        const { data: client } = await supabase
          .from('clients')
          .select('*')
          .eq('checkout_id', checkout_id)
          .single();
        if (client && client.status === 'active') {
          await notifyMaddy('Payment Failed', `Active client ${customer_name || customer_phone} payment failed for ${product_name}`);
        }
      }
      return res.status(200).json({ action: 'ignored', status });
    }

    const phone = normalizePhone(customer_phone || '');
    if (!phone) {
      return res.status(400).json({ error: 'No phone number' });
    }

    const program = PROGRAM_MAP[product_id] || detectProgramFromName(product_name) || '6wk_gym';
    const market = detectMarket(phone);
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const endsAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    let leadId = lead?.id;

    if (!lead) {
      const { data: newLead } = await supabase.from('leads').insert({
        phone,
        name: customer_name,
        source: 'exly',
        status: 'converted',
        market,
        program_interest: program
      }).select().single();
      leadId = newLead.id;
    } else {
      await supabase.from('leads').update({ status: 'converted', program_interest: program }).eq('id', lead.id);
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('program', program)
      .single();

    let clientId;
    if (existingClient) {
      await supabase.from('clients').update({
        status: 'active',
        paid_amount: amount,
        checkout_id,
        program_started_at: new Date().toISOString(),
        program_ends_at: endsAt
      }).eq('id', existingClient.id);
      clientId = existingClient.id;
    } else {
      const { data: client } = await supabase.from('clients').insert({
        lead_id: leadId,
        phone,
        name: customer_name || lead?.name,
        email: customer_email,
        program,
        paid_amount: amount,
        checkout_id,
        folder_url: `/clients/${leadId}/`,
        status: 'active',
        program_started_at: new Date().toISOString(),
        program_ends_at: endsAt
      }).select().single();
      clientId = client.id;
    }

    const templateName = isHinglish(market) ? `onboard_${program}_hi` : `onboard_${program}_en`;
    await sendTemplate(phone, templateName, [customer_name || 'there'], customer_name);

    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : process.env.SITE_URL;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-key': process.env.INTERNAL_API_KEY
          },
          body: JSON.stringify({ client_id: clientId, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week 1 program generation trigger failed:', genErr.message);
      }
    }

    return res.status(200).json({ ok: true, client_id: clientId, program });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function detectProgramFromName(name) {
  if (!name) return null;
  const lower = name.toLowerCase();
  if (lower.includes('12') && lower.includes('week')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('zoom') && lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom')) return 'zoom_pack';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}

function normalizePhone(phone) {
  let p = phone.replace(/[^0-9+]/g, '');
  if (!p.startsWith('+') && p.length >= 10) {
    if (p.startsWith('91') && p.length >= 12) p = '+' + p;
    else if (p.startsWith('971') || p.startsWith('44')) p = '+' + p;
    else p = '+91' + p;
  }
  return p;
}
