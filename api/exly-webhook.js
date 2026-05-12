const crypto = require('crypto');
const { supabase } = require('./lib/supabase');
const { sendTemplate } = require('./lib/whatsapp');
const { detectMarket, isHinglish } = require('./lib/market');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30
};

function verifyWebhookSignature(payload, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const hash = crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
  return hash === signature;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const signature = req.headers['x-exly-signature'] || '';
  if (!verifyWebhookSignature(req.body, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  try {
    const {
      phone, name, email, amount, checkout_id, product_name
    } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'phone required' });
    }

    const programKey = detectProgramFromProduct(product_name || '');
    const durationDays = PROGRAM_DURATIONS[programKey] || 42;
    const endsAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: lead } = await supabase
      .from('leads')
      .select('id, market')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .limit(1)
      .single();

    let clientId;

    if (existingClient) {
      await supabase
        .from('clients')
        .update({
          name, email,
          program: programKey,
          program_started_at: new Date().toISOString(),
          program_ends_at: endsAt,
          paid_amount: amount,
          checkout_id,
          status: 'active'
        })
        .eq('id', existingClient.id);
      clientId = existingClient.id;
    } else {
      const { data: newClient } = await supabase
        .from('clients')
        .insert({
          lead_id: lead?.id || null,
          phone, name, email,
          program: programKey,
          program_started_at: new Date().toISOString(),
          program_ends_at: endsAt,
          paid_amount: amount,
          checkout_id,
          folder_url: `/clients/${crypto.randomUUID()}`,
          status: 'active'
        })
        .select()
        .single();
      clientId = newClient?.id;
    }

    const market = lead?.market || detectMarket(phone);
    const templateName = `onboard_${programKey}`;
    await sendTemplate(phone, templateName, {
      name: name || 'there',
      templateParams: [name || 'there', programKey]
    });

    if (programKey === '12wk') {
      try {
        await fetch(`https://fitnessbymaddy.com/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
          },
          body: JSON.stringify({ client_id: clientId, week_no: 1 })
        });
      } catch (e) {
        console.error('Week 1 program generation trigger failed:', e.message);
      }
    }

    return res.status(200).json({ success: true, client_id: clientId });

  } catch (err) {
    console.error('exly-webhook error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

function detectProgramFromProduct(productName) {
  const lower = productName.toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus') || lower.includes('forty')) return '40plus';
  if (lower.includes('12') || lower.includes('twelve') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('trial') || lower.includes('zoom trial')) return 'zoom_trial';
  if (lower.includes('zoom pack') || lower.includes('zoom_pack')) return 'zoom_pack';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}
