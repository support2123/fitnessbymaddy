const crypto = require('crypto');
const { supabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');

const PROGRAM_DURATION = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30
};

function verifySignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(body))
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature || '', 'utf8'),
    Buffer.from(expected, 'utf8')
  );
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const signature = req.headers['x-exly-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && !verifySignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const {
      customer_phone, customer_name, customer_email,
      product_name, amount, checkout_id
    } = req.body;

    if (!customer_phone) {
      return res.status(400).json({ error: 'customer_phone required' });
    }

    const cleanPhone = customer_phone.replace(/[^0-9]/g, '');

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', cleanPhone)
      .maybeSingle();

    const program = lead?.program_interest || '12wk';
    const durationDays = PROGRAM_DURATION[program] || 84;
    const programEnds = new Date(Date.now() + durationDays * 86400000).toISOString();

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
        phone: cleanPhone,
        name: customer_name || lead?.name,
        email: customer_email,
        program,
        program_started_at: new Date().toISOString(),
        program_ends_at: programEnds,
        paid_amount: amount ? parseInt(amount) : null,
        checkout_id,
        folder_url: null,
        status: 'active'
      })
      .select()
      .single();

    if (error) {
      console.error('Client creation failed:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}`;
    await supabase.storage
      .from('client-files')
      .upload(`${folderPath}/.keep`, new Uint8Array(0), {
        contentType: 'application/octet-stream',
        upsert: true
      });

    await supabase
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    await sendTemplate(cleanPhone, `onboard_${program}`, [
      customer_name || lead?.name || 'there'
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

    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
