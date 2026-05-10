const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { computeProgramEndDate, PROGRAM_NAMES } = require('../lib/helpers');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (process.env.EXLY_WEBHOOK_SECRET) {
      const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
      if (signature) {
        const expected = crypto
          .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
          .update(JSON.stringify(req.body))
          .digest('hex');
        if (signature !== expected) {
          return res.status(401).json({ error: 'Invalid signature' });
        }
      }
    }

    const {
      customer_name, customer_email, customer_phone,
      product_name, amount, checkout_id, status,
    } = req.body;

    if (status && status !== 'completed' && status !== 'success') {
      return res.status(200).json({ ok: true, skipped: 'not_completed' });
    }

    if (!customer_phone) {
      return res.status(400).json({ error: 'customer_phone required' });
    }

    const db = getSupabase();
    const phone = normalizePhone(customer_phone);
    const program = detectProgramFromProduct(product_name, amount);

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    let leadId = lead?.id;

    if (lead) {
      await db.from('leads').update({
        status: 'converted',
        name: customer_name || lead.name,
        program_interest: program,
        last_msg_at: new Date().toISOString(),
      }).eq('id', lead.id);
    } else {
      const { data: newLead } = await db.from('leads').insert({
        phone,
        name: customer_name,
        source: 'exly',
        status: 'converted',
        program_interest: program,
      }).select().single();
      leadId = newLead?.id;
    }

    const now = new Date();
    const programEndDate = computeProgramEndDate(now, program);

    const { data: client, error: clientErr } = await db.from('clients').insert({
      lead_id: leadId,
      phone,
      name: customer_name,
      email: customer_email,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: programEndDate,
      paid_amount: amount ? Math.round(amount * 100) : 0,
      checkout_id: checkout_id || null,
      status: 'active',
    }).select().single();

    if (clientErr) {
      console.error('Client insert error:', clientErr.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}`;
    await db.storage.from('clients').upload(`${folderPath}/.keep`, new Uint8Array(0), {
      upsert: true,
    });

    await db.from('clients').update({
      folder_url: folderPath,
    }).eq('id', client.id);

    const programName = PROGRAM_NAMES[program] || program;
    await sendWhatsApp(phone, 'onboard_welcome', [
      customer_name || 'there',
      programName,
    ]);

    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (genErr) {
        console.error('Week-1 program generation failed:', genErr.message);
      }
    }

    return res.status(200).json({ ok: true, clientId: client.id, program });

  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function normalizePhone(phone) {
  let cleaned = phone.replace(/[^0-9+]/g, '');
  if (!cleaned.startsWith('+')) {
    if (cleaned.length === 10) cleaned = '+91' + cleaned;
    else cleaned = '+' + cleaned;
  }
  return cleaned;
}

function detectProgramFromProduct(productName, amount) {
  if (!productName) {
    if (amount <= 25) return 'zoom_trial';
    if (amount <= 50) return 'pcos';
    if (amount <= 100) return '6wk_gym';
    return '12wk';
  }

  const lower = productName.toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('shred') || lower.includes('6 week') || lower.includes('burn')) return '6wk_gym';
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('pack')) return 'zoom_pack';

  return '6wk_gym';
}
