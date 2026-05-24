const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { isHinglish } = require('../lib/market');
const crypto = require('crypto');

const PROGRAM_MAP = {
  '6wk-gym': '6wk_gym',
  '6wk-home': '6wk_home',
  '12wk-custom': '12wk',
  'pcos-warrior': 'pcos',
  '40plus-strong': '40plus',
  'zoom-trial': 'zoom_trial',
  'zoom-pack': 'zoom_pack'
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
      event,
      customer_phone,
      customer_name,
      customer_email,
      product_id,
      amount,
      checkout_id
    } = req.body;

    if (event !== 'purchase.completed') {
      return res.status(200).json({ action: 'ignored', event });
    }

    if (!customer_phone) {
      return res.status(400).json({ error: 'No phone in purchase data' });
    }

    const programKey = PROGRAM_MAP[product_id] || '12wk';
    const durationDays = PROGRAM_DURATIONS[programKey] || 42;

    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

    let { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', customer_phone)
      .single();

    if (!lead) {
      const { data: newLead } = await supabase
        .from('leads')
        .insert({
          phone: customer_phone,
          name: customer_name,
          source: 'exly_purchase',
          status: 'converted'
        })
        .select()
        .single();
      lead = newLead;
    } else {
      await supabase
        .from('leads')
        .update({ status: 'converted', name: customer_name || lead.name })
        .eq('id', lead.id);
    }

    const folderPath = `clients/${lead.id}`;
    const { data: client } = await supabase
      .from('clients')
      .insert({
        lead_id: lead.id,
        phone: customer_phone,
        name: customer_name || lead.name,
        email: customer_email,
        program: programKey,
        program_started_at: startDate.toISOString(),
        program_ends_at: endDate.toISOString(),
        paid_amount: parseInt(amount) || 0,
        checkout_id,
        folder_url: folderPath,
        status: 'active'
      })
      .select()
      .single();

    await supabase.storage
      .from('client-files')
      .upload(`${folderPath}/.keep`, new Uint8Array(0), {
        contentType: 'text/plain',
        upsert: true
      });

    const hinglish = isHinglish(lead.market || 'GLOBAL');
    const templateName = hinglish ? `onboard_${programKey}` : `onboard_${programKey}_en`;
    await sendTemplate(customer_phone, templateName, [
      customer_name || 'there',
      programKey.replace(/_/g, ' ')
    ]);

    if (programKey === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
          },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week 1 generation failed:', genErr.message);
      }
    }

    return res.status(200).json({
      success: true,
      client_id: client.id,
      program: programKey
    });

  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Failed to process purchase' });
  }
};
