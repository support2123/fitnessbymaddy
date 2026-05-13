const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { normalizePhone, maskPhone } = require('../lib/utils');
const { escalateToMaddy } = require('../lib/escalation');

const PROGRAM_DURATION = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30,
};

function inferProgram(amount, productName) {
  const name = (productName || '').toLowerCase();
  if (name.includes('12') || name.includes('flagship') || name.includes('custom')) return '12wk';
  if (name.includes('pcos')) return 'pcos';
  if (name.includes('40')) return '40plus';
  if (name.includes('zoom') && name.includes('trial')) return 'zoom_trial';
  if (name.includes('zoom')) return 'zoom_pack';

  if (amount >= 15000) return '12wk';
  if (amount >= 4000 && amount <= 5500) return 'pcos';
  if (amount >= 3500 && amount <= 5500) return '40plus';
  if (amount >= 7000 && amount <= 12000) return '6wk_gym';
  if (amount <= 2500) return 'zoom_trial';
  return '6wk_gym';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const signature = req.headers['x-exly-signature'] || '';
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
      customer_phone, customer_name, customer_email,
      amount, product_name, checkout_id, status,
    } = req.body;

    if (status && status !== 'paid' && status !== 'completed') {
      if (status === 'failed') {
        const phone = normalizePhone(customer_phone);
        const { data: client } = await getSupabase()
          .from('clients')
          .select('*')
          .eq('phone', phone)
          .eq('status', 'active')
          .limit(1)
          .single();

        if (client) {
          await escalateToMaddy({
            reason: 'Payment failure for active client',
            phone,
            name: customer_name,
            context: `Checkout: ${checkout_id}, Amount: ${amount}`,
          });
        }
      }
      return res.json({ ok: true, action: 'non_paid_event' });
    }

    const phone = normalizePhone(customer_phone);
    if (!phone) return res.status(400).json({ error: 'No phone' });

    const db = getSupabase();
    const program = inferProgram(amount, product_name);
    const durationDays = PROGRAM_DURATION[program] || 42;
    const now = new Date();
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const { data: client, error: clientErr } = await db
      .from('clients')
      .insert({
        lead_id: lead ? lead.id : null,
        phone,
        name: customer_name || (lead ? lead.name : null),
        email: customer_email || null,
        program,
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: amount,
        checkout_id: checkout_id || null,
        folder_url: null,
        status: 'active',
      })
      .select()
      .single();

    if (clientErr) {
      console.error('Client insert error:', clientErr);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}`;
    await db.storage.from('client-files').upload(
      `${folderPath}/.keep`,
      new Uint8Array([0]),
      { contentType: 'application/octet-stream', upsert: true }
    );

    await db.from('clients').update({
      folder_url: folderPath,
    }).eq('id', client.id);

    await sendWhatsApp({
      phone,
      templateName: `onboard_${program}`,
      bodyValues: [customer_name || 'there'],
    });

    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://www.fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (err) {
        console.error('Week-1 program gen failed:', err.message);
      }
    }

    console.log(`Conversion: ${maskPhone(phone)} → ${program}`);
    return res.json({ ok: true, action: 'converted', client_id: client.id, program });

  } catch (err) {
    console.error('Exly webhook error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
