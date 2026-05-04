const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { isHinglish } = require('../lib/market');
const crypto = require('crypto');

const PROGRAM_MAP = {
  '6-week-shred':    { program: '6wk_gym',    weeks: 6 },
  '6-week-home':     { program: '6wk_home',   weeks: 6 },
  '12-week-custom':  { program: '12wk',       weeks: 12 },
  'pcos-warrior':    { program: 'pcos',        weeks: 6 },
  '40-plus-strong':  { program: '40plus',      weeks: 6 },
  'zoom-trial':      { program: 'zoom_trial',  weeks: 1 },
  'zoom-pack':       { program: 'zoom_pack',   weeks: 4 }
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret && req.headers['x-exly-signature']) {
      const sig = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (sig !== req.headers['x-exly-signature']) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const { phone, email, name, checkout_id, product_slug, amount } = req.body;

    if (!phone || !product_slug) {
      return res.status(400).json({ error: 'phone and product_slug required' });
    }

    const mapping = PROGRAM_MAP[product_slug];
    if (!mapping) {
      return res.status(400).json({ error: 'Unknown product' });
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + mapping.weeks * 7);

    const { data: client, error } = await supabase
      .from('clients')
      .insert({
        lead_id: lead ? lead.id : null,
        phone,
        name: name || (lead ? lead.name : null),
        email,
        program: mapping.program,
        program_started_at: startDate.toISOString(),
        program_ends_at: endDate.toISOString(),
        paid_amount: amount || 0,
        checkout_id,
        folder_url: null,
        status: 'active'
      })
      .select()
      .single();

    if (error) {
      console.error('Client insert error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}`;
    await supabase.storage
      .from('clients')
      .upload(`${folderPath}/.keep`, new Uint8Array(0), {
        contentType: 'text/plain',
        upsert: true
      });

    await supabase
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    const market = lead ? lead.market : 'GLOBAL';
    const templateName = isHinglish(market)
      ? `onboard_${mapping.program}`
      : `onboard_${mapping.program}_en`;

    await sendWhatsApp({
      phone,
      templateName,
      params: [name || 'there', mapping.program]
    });

    if (mapping.program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host || 'fitnessbymaddy.com'}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (err) {
        console.error('Week-1 program generation trigger failed:', err.message);
      }
    }

    return res.status(200).json({
      message: 'Client onboarded',
      client_id: client.id,
      program: mapping.program
    });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
