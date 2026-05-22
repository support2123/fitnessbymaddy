const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { PROGRAM_LABELS, corsHeaders } = require('./_lib/utils');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (corsHeaders(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret) {
      const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
      if (sig) {
        const expected = crypto
          .createHmac('sha256', secret)
          .update(JSON.stringify(req.body))
          .digest('hex');
        if (sig !== expected) {
          return res.status(401).json({ error: 'Invalid signature' });
        }
      }
    }

    const {
      phone,
      email,
      name,
      amount,
      checkout_id,
      product_name,
      lead_id,
    } = req.body;

    if (!phone) return res.status(400).json({ error: 'Phone required' });

    const db = getSupabase();

    let lead;
    if (lead_id) {
      const { data } = await db.from('leads').select('*').eq('id', lead_id).single();
      lead = data;
    }
    if (!lead) {
      const { data } = await db.from('leads').select('*').eq('phone', phone).single();
      lead = data;
    }

    const program = lead?.program_interest || inferProgram(product_name, amount);

    if (lead) {
      await db
        .from('leads')
        .update({ status: 'converted', name: name || lead.name })
        .eq('id', lead.id);
    }

    const programWeeks = program === '12wk' ? 12 : program?.startsWith('6wk') ? 6 : 4;
    const endsAt = new Date();
    endsAt.setDate(endsAt.getDate() + programWeeks * 7);

    const { data: client, error } = await db
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone,
        name: name || lead?.name,
        email,
        program,
        paid_amount: amount,
        checkout_id,
        program_ends_at: endsAt.toISOString(),
        folder_url: null,
      })
      .select()
      .single();

    if (error) throw error;

    const folderPath = `clients/${client.id}`;
    await db
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    const label = PROGRAM_LABELS[program] || program;
    await sendWhatsApp({
      phone,
      templateName: `onboard_${program}`,
      templateParams: {
        name: name || 'there',
        params: [name || 'there', label],
      },
    });

    if (program === '12wk') {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://fitnessbymaddy.com';

      try {
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (genErr) {
        console.error('Week-1 program generation failed:', genErr.message);
      }
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function inferProgram(productName, amount) {
  if (!productName) {
    if (amount <= 25) return 'zoom_trial';
    if (amount <= 50) return 'pcos';
    if (amount <= 100) return '6wk_gym';
    return '12wk';
  }
  const lower = productName.toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('12') || lower.includes('custom')) return '12wk';
  if (lower.includes('zoom') || lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}
