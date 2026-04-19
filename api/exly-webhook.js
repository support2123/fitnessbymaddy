const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

const PROGRAM_MAP = {
  '6_week_shred_gym': { program: '6wk_gym', weeks: 6, template: 'onboard_6wk' },
  '6_week_shred_home': { program: '6wk_home', weeks: 6, template: 'onboard_6wk' },
  '12_week_custom': { program: '12wk', weeks: 12, template: 'onboard_12wk' },
  'pcos_warrior': { program: 'pcos', weeks: 6, template: 'onboard_pcos' },
  '40_plus_strong': { program: '40plus', weeks: 6, template: 'onboard_40plus' },
  'zoom_trial': { program: 'zoom_trial', weeks: 1, template: 'onboard_trial' },
  'zoom_pack': { program: 'zoom_pack', weeks: 4, template: 'onboard_zoom' },
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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
      customer_phone, customer_name, customer_email,
      product_name, amount, checkout_id, status,
    } = req.body;

    if (status !== 'completed' && status !== 'success') {
      if (status === 'failed') {
        await handlePaymentFailure(customer_phone, customer_name);
      }
      return res.status(200).json({ action: 'ignored', status });
    }

    const phone = normalizePhone(customer_phone);
    if (!phone) return res.status(400).json({ error: 'No phone' });

    const db = getSupabase();

    const programKey = Object.keys(PROGRAM_MAP).find((k) =>
      (product_name || '').toLowerCase().includes(k.replace(/_/g, ' '))
    ) || '12_week_custom';

    const programInfo = PROGRAM_MAP[programKey];
    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + programInfo.weeks * 7);

    const { data: lead } = await db
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const { data: client } = await db.from('clients').insert({
      lead_id: lead ? lead.id : null,
      phone,
      name: customer_name,
      email: customer_email,
      program: programInfo.program,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount ? Math.round(parseFloat(amount) * 100) : null,
      checkout_id,
      folder_url: null,
      status: 'active',
    }).select().single();

    const folderPath = `clients/${client.id}`;
    await db.storage.from('clients').upload(`${folderPath}/.keep`, new Uint8Array(0), {
      upsert: true,
    });
    await db.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    await sendWhatsApp({
      phone,
      templateName: programInfo.template,
      bodyValues: [
        customer_name || 'Champion',
        programInfo.program,
        `Week 1 check-in: ${formatDate(new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000))}`,
      ],
    });

    if (programInfo.program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://www.fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
          },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (e) {
        console.error('Week-1 program generation failed:', e.message);
      }
    }

    return res.status(200).json({ success: true, clientId: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handlePaymentFailure(phone, name) {
  if (!phone) return;
  const normalized = normalizePhone(phone);
  const db = getSupabase();

  const { data: client } = await db
    .from('clients')
    .select('id')
    .eq('phone', normalized)
    .eq('status', 'active')
    .single();

  if (client) {
    const { escalateToMaddy } = require('../lib/escalation');
    await escalateToMaddy({
      reason: 'Payment failure for active client',
      phone: normalized,
      message: `Payment failed for ${name || 'client'}`,
    });
  }
}

function normalizePhone(phone) {
  if (!phone) return null;
  let cleaned = phone.replace(/[^0-9+]/g, '');
  if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
  return cleaned;
}

function formatDate(d) {
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
