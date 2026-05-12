const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { PROGRAM_DETAILS } = require('../lib/utils');
const { escalateToMaddy } = require('../lib/escalate');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getSupabase();

  try {
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret) {
      const signature = req.headers['x-exly-signature'] || '';
      const body = JSON.stringify(req.body);
      const expected = crypto
        .createHmac('sha256', secret)
        .update(body)
        .digest('hex');
      if (signature && signature !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      phone,
      email,
      name,
      checkout_id,
      product_name,
      amount,
      status: paymentStatus,
    } = req.body;

    if (paymentStatus !== 'success' && paymentStatus !== 'completed') {
      if (paymentStatus === 'failed') {
        const { data: existingClient } = await db
          .from('clients')
          .select('id')
          .eq('phone', phone)
          .eq('status', 'active')
          .limit(1)
          .single();

        if (existingClient) {
          await escalateToMaddy('Payment failure for active client', {
            phone,
            checkout_id,
            amount,
          });
        }
      }
      return res.status(200).json({ action: 'payment_not_success' });
    }

    let program = null;
    const productLower = (product_name || '').toLowerCase();
    if (productLower.includes('12') || productLower.includes('custom') || productLower.includes('flagship')) {
      program = '12wk';
    } else if (productLower.includes('pcos')) {
      program = 'pcos';
    } else if (productLower.includes('40')) {
      program = '40plus';
    } else if (productLower.includes('trial') || productLower.includes('zoom')) {
      program = 'zoom_trial';
    } else if (productLower.includes('home')) {
      program = '6wk_home';
    } else {
      program = '6wk_gym';
    }

    const programInfo = PROGRAM_DETAILS[program];
    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + programInfo.duration);

    const { data: lead } = await db
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (lead) {
      await db
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const { data: client, error: clientErr } = await db
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone,
        name: name || null,
        email: email || null,
        program,
        program_started_at: startDate.toISOString(),
        program_ends_at: endDate.toISOString(),
        paid_amount: amount,
        checkout_id,
        status: 'active',
      })
      .select()
      .single();

    if (clientErr) {
      console.error('Client creation error:', clientErr.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}`;
    await db.storage.from('clients').upload(
      `${client.id}/.keep`,
      new Blob([''], { type: 'text/plain' }),
      { upsert: true }
    );

    await db
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    await sendWhatsApp(phone, `onboard_${program}`, [
      name || 'there',
      programInfo.name,
      `${programInfo.duration} days`,
    ]);

    if (program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: client.id,
            week_no: 1,
          }),
        });
      } catch (genErr) {
        console.error('Week 1 program generation failed:', genErr.message);
      }
    }

    return res.status(200).json({
      success: true,
      action: 'converted',
      client_id: client.id,
      program,
    });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
