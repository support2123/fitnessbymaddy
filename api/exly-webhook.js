const crypto = require('crypto');
const { supabase } = require('./lib/supabase');
const { sendTemplate } = require('./lib/whatsapp');
const { PROGRAM_DURATIONS_WEEKS, PROGRAM_NAMES } = require('./lib/helpers');

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
      checkout_id,
      amount
    } = req.body;

    if (event !== 'payment.success' && event !== 'order.completed') {
      return res.status(200).json({ action: 'ignored', event });
    }

    const phone = customer_phone;
    if (!phone) {
      return res.status(400).json({ error: 'No phone number' });
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    const program = lead?.program_interest || mapExlyProduct(product_id);
    const durationWeeks = PROGRAM_DURATIONS_WEEKS[program] || 6;
    const endsAt = new Date();
    endsAt.setDate(endsAt.getDate() + durationWeeks * 7);

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const { data: client, error } = await supabase
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone,
        name: customer_name || lead?.name,
        email: customer_email,
        program,
        program_started_at: new Date().toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: amount ? parseInt(amount) : null,
        checkout_id,
        status: 'active'
      })
      .select()
      .single();

    if (error) {
      console.error('Client insert error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}/`;
    await supabase.storage.from('client-files').upload(
      `${folderPath}.keep`,
      '',
      { contentType: 'text/plain', upsert: true }
    );

    await supabase
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    const templateName = `onboard_${program}`;
    const programName = PROGRAM_NAMES[program] || program;
    await sendTemplate(phone, templateName, [
      customer_name || 'there',
      programName
    ]);

    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://www.fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (e) {
        console.error('Week-1 program generation failed:', e.message);
      }
    }

    return res.status(200).json({
      ok: true,
      client_id: client.id,
      program,
      action: 'converted'
    });
  } catch (error) {
    console.error('Exly webhook error:', error.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapExlyProduct(productId) {
  const map = {
    'shred_6wk': '6wk_gym',
    'shred_home': '6wk_home',
    'custom_12wk': '12wk',
    'pcos_warrior': 'pcos',
    '40plus_strong': '40plus',
    'zoom_trial': 'zoom_trial',
    'zoom_pack': 'zoom_pack'
  };
  return map[productId] || '6wk_gym';
}
