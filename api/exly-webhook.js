const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('../lib/whatsapp');
const { maskPhone, programLabel } = require('../lib/utils');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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
      checkout_id, phone, email, name,
      amount, product_name, status: paymentStatus,
    } = req.body;

    if (paymentStatus !== 'completed' && paymentStatus !== 'success') {
      if (paymentStatus === 'failed') {
        const db = getSupabase();
        const { data: client } = await db
          .from('clients')
          .select('*')
          .eq('phone', normalizePhone(phone))
          .eq('status', 'active')
          .single();

        if (client) {
          await notifyMaddy(
            'Payment failed for active client',
            `Client: ${name || 'unknown'} (${maskPhone(phone)})\nCheckout: ${checkout_id}`
          );
        }
      }
      return res.status(200).json({ action: 'non_success_status', status: paymentStatus });
    }

    const normalizedPhone = normalizePhone(phone);
    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', normalizedPhone)
      .single();

    if (lead) {
      await db.from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const program = lead?.program_interest || detectProgramFromProduct(product_name);
    const programWeeks = program === '12wk' ? 12 : 6;
    const now = new Date();
    const endsAt = new Date(now.getTime() + programWeeks * 7 * 24 * 60 * 60 * 1000);

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('phone', normalizedPhone)
      .single();

    let clientId;

    if (existingClient) {
      await db.from('clients').update({
        name: name || undefined,
        email: email || undefined,
        program,
        paid_amount: amount ? parseInt(amount, 10) : null,
        checkout_id,
        status: 'active',
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
      }).eq('id', existingClient.id);
      clientId = existingClient.id;
    } else {
      const { data: newClient } = await db.from('clients').insert({
        lead_id: lead?.id || null,
        phone: normalizedPhone,
        name,
        email,
        program,
        paid_amount: amount ? parseInt(amount, 10) : null,
        checkout_id,
        status: 'active',
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
      }).select().single();
      clientId = newClient.id;
    }

    const folderPath = `clients/${clientId}/`;
    await db.storage.from('programs').upload(
      `${folderPath}.keep`,
      new Uint8Array(0),
      { contentType: 'text/plain', upsert: true }
    );

    await db.from('clients')
      .update({ folder_url: folderPath })
      .eq('id', clientId);

    const label = programLabel(program);
    await sendWhatsApp({
      phone: normalizedPhone,
      body: `Welcome to ${label}! 🎉\n\nYour program starts now. Here's what happens next:\n\n1. You'll receive your first check-in form on Day 7\n2. Fill it honestly — it helps us customise your plan\n3. For any questions, just reply here\n\nLet's build something amazing together 💪`,
    });

    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
          },
          body: JSON.stringify({ client_id: clientId, week_no: 1 }),
        });
      } catch (genErr) {
        console.error('Week 1 program gen failed:', genErr.message);
      }
    }

    return res.status(200).json({ ok: true, client_id: clientId });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function normalizePhone(raw) {
  if (!raw) return '';
  let cleaned = raw.replace(/[^0-9+]/g, '');
  if (!cleaned.startsWith('+') && cleaned.length >= 10) {
    cleaned = '+' + cleaned;
  }
  return cleaned;
}

function detectProgramFromProduct(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}
