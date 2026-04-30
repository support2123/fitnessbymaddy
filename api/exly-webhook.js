const crypto = require('crypto');
const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { isHinglish } = require('../lib/market');

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
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    if (process.env.EXLY_WEBHOOK_SECRET) {
      const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (sig && sig !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const { email, phone, name, amount, checkout_id, product_name } = parseExlyPayload(req.body);

    if (!phone) return res.status(400).json({ error: 'Phone required' });

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const program = lead?.program_interest || inferProgram(product_name, amount);
    const durationDays = PROGRAM_DURATIONS[program] || 42;

    if (lead) {
      await supabase.from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const programEnds = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: client, error: insertErr } = await supabase
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone,
        name: name || lead?.name,
        email,
        program,
        program_ends_at: programEnds,
        paid_amount: amount ? Math.round(amount * 100) : null,
        checkout_id,
        folder_url: null,
        status: 'active'
      })
      .select()
      .single();

    if (insertErr) {
      console.error('Client insert error:', insertErr.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}`;
    await supabase.storage.from('programs').upload(
      `${folderPath}/.keep`,
      new Uint8Array(0),
      { contentType: 'application/octet-stream', upsert: true }
    );
    await supabase.from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    const hinglish = lead ? isHinglish(lead.market) : false;
    await sendWhatsApp({
      phone,
      templateName: `onboard_${program}`,
      body: hinglish
        ? `Welcome aboard! 🎉 Aapka ${program} program start ho gaya hai. Pehla check-in Day 7 pe aayega. Let's crush it!`
        : `Welcome aboard! 🎉 Your ${program} program has started. First check-in comes on Day 7. Let's crush it!`,
      params: [name || 'there', program]
    });

    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week-1 program gen failed:', genErr.message);
      }
    }

    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parseExlyPayload(body) {
  return {
    email: body.email || body.buyer_email || body.customer?.email,
    phone: body.phone || body.buyer_phone || body.customer?.phone,
    name: body.name || body.buyer_name || body.customer?.name,
    amount: body.amount || body.total_amount || body.payment?.amount,
    checkout_id: body.checkout_id || body.order_id || body.id,
    product_name: body.product_name || body.item_name || body.product?.name
  };
}

function inferProgram(productName, amount) {
  if (!productName) {
    if (amount <= 25) return 'zoom_trial';
    if (amount <= 50) return 'pcos';
    if (amount <= 100) return '6wk_gym';
    return '12wk';
  }
  const lower = productName.toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  return '6wk_gym';
}
