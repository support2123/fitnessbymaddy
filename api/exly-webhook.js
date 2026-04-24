const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { getProgramDetails, getProgramEndDate, maskPhone } = require('../lib/utils');

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
      customer_phone,
      customer_name,
      customer_email,
      product_id,
      product_name,
      amount,
      checkout_id,
      status: paymentStatus,
    } = req.body;

    if (paymentStatus !== 'completed' && paymentStatus !== 'success') {
      if (paymentStatus === 'failed') {
        const db = getSupabase();
        const { data: client } = await db
          .from('clients')
          .select('*')
          .eq('phone', customer_phone)
          .eq('status', 'active')
          .single();

        if (client) {
          await sendWhatsApp('+917082478374', 'escalation_alert', [
            maskPhone(customer_phone),
            'payment_failure',
            `Payment failed for active client: ${customer_name}`,
          ]);
        }
      }
      return res.status(200).json({ action: 'payment_not_completed' });
    }

    const db = getSupabase();

    const programMap = {
      '6wk-gym': '6wk_gym',
      '6wk-home': '6wk_home',
      '12wk-custom': '12wk',
      'pcos-warrior': 'pcos',
      '40plus-strong': '40plus',
      'zoom-trial': 'zoom_trial',
      'zoom-pack': 'zoom_pack',
    };

    let programKey = null;
    if (product_id && programMap[product_id]) {
      programKey = programMap[product_id];
    } else if (product_name) {
      const lower = product_name.toLowerCase();
      if (lower.includes('12') && lower.includes('week')) programKey = '12wk';
      else if (lower.includes('pcos')) programKey = 'pcos';
      else if (lower.includes('40')) programKey = '40plus';
      else if (lower.includes('zoom') && lower.includes('trial')) programKey = 'zoom_trial';
      else if (lower.includes('zoom')) programKey = 'zoom_pack';
      else if (lower.includes('home')) programKey = '6wk_home';
      else programKey = '6wk_gym';
    } else {
      programKey = '6wk_gym';
    }

    const programDetails = getProgramDetails(programKey);
    const now = new Date();
    const endsAt = getProgramEndDate(now, programDetails.weeks);

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', customer_phone)
      .single();

    if (lead) {
      await db
        .from('leads')
        .update({ status: 'converted', last_msg_at: now.toISOString() })
        .eq('id', lead.id);
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('*')
      .eq('phone', customer_phone)
      .eq('program', programKey)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      return res.status(200).json({ action: 'already_active', client_id: existingClient.id });
    }

    const { data: client } = await db
      .from('clients')
      .insert({
        lead_id: lead ? lead.id : null,
        phone: customer_phone,
        name: customer_name,
        email: customer_email,
        program: programKey,
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: amount || programDetails.price * 100,
        checkout_id: checkout_id || null,
        folder_url: `clients/${null}`,
        status: 'active',
      })
      .select()
      .single();

    await db
      .from('clients')
      .update({ folder_url: `clients/${client.id}` })
      .eq('id', client.id);

    await db.storage
      .from('client-data')
      .upload(`clients/${client.id}/.folder`, 'initialized', {
        contentType: 'text/plain',
        upsert: true,
      });

    const templateName = `onboard_${programKey}`;
    await sendWhatsApp(customer_phone, templateName, [
      customer_name || 'there',
      programDetails.name,
    ]);

    if (programKey === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
          },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (e) {
        console.error('Week 1 program generation failed:', e.message);
      }
    }

    return res.status(200).json({
      success: true,
      action: 'converted',
      client_id: client.id,
      program: programKey,
    });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
