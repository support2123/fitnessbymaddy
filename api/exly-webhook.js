const crypto = require('crypto');
const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42, '6wk_home': 42,
  '12wk': 84,
  'pcos': 42, '40plus': 42,
  'zoom_trial': 7, 'zoom_pack': 30
};

function verifySignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const hash = crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature || ''));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const signature = req.headers['x-exly-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && !verifySignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const { email, phone, name, amount, checkoutId, productName } = req.body;

    if (!phone) return res.status(400).json({ error: 'Phone required' });

    let program = '6wk_gym';
    const pn = (productName || '').toLowerCase();
    if (pn.includes('12') || pn.includes('custom') || pn.includes('flagship')) program = '12wk';
    else if (pn.includes('pcos')) program = 'pcos';
    else if (pn.includes('40') || pn.includes('strong')) program = '40plus';
    else if (pn.includes('home')) program = '6wk_home';
    else if (pn.includes('trial') || pn.includes('zoom')) program = 'zoom_trial';
    else if (pn.includes('pack')) program = 'zoom_pack';

    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const now = new Date();
    const endDate = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const { data: client, error: clientError } = await supabase
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone, name, email, program,
        program_started_at: now.toISOString(),
        program_ends_at: endDate.toISOString(),
        paid_amount: amount || 0,
        checkout_id: checkoutId || null,
        folder_url: null,
        status: 'active'
      })
      .select()
      .single();

    if (clientError) {
      console.error('Client creation error:', clientError.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}`;
    const placeholder = new Uint8Array([0]);
    await supabase.storage
      .from('client-files')
      .upload(`${folderPath}/.keep`, placeholder, { upsert: true });

    await supabase
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    const templateName = `onboard_${program}`;
    await sendTemplate(phone, templateName, [name || 'there']);

    if (program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
          },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week-1 program generation failed:', genErr.message);
      }
    }

    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
