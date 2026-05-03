const crypto = require('crypto');
const { getSupabase } = require('./_lib/supabase');
const { sendClientMessage, notifyMaddy } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/market');

const PROGRAM_DURATION = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30
};

function verifySignature(payload, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true; // skip verification if no secret configured
  const hash = crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
  return hash === signature;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const signature = req.headers['x-exly-signature'] || '';
    if (!verifySignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const { phone, name, email, product_name, amount, checkout_id } = req.body;
    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    // Match product to program type
    const productLower = (product_name || '').toLowerCase();
    let program = '6wk_gym';
    if (productLower.includes('home')) program = '6wk_home';
    else if (productLower.includes('12') || productLower.includes('custom') || productLower.includes('flagship')) program = '12wk';
    else if (productLower.includes('pcos')) program = 'pcos';
    else if (productLower.includes('40')) program = '40plus';
    else if (productLower.includes('zoom') && productLower.includes('trial')) program = 'zoom_trial';
    else if (productLower.includes('zoom') && productLower.includes('pack')) program = 'zoom_pack';

    const duration = PROGRAM_DURATION[program] || 42;
    const programEnds = new Date(Date.now() + duration * 24 * 60 * 60 * 1000).toISOString();

    // Find or update lead
    const { data: lead } = await db
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    // Create client
    const { data: client, error } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name,
      email,
      program,
      program_started_at: new Date().toISOString(),
      program_ends_at: programEnds,
      paid_amount: amount ? parseInt(amount, 10) : 0,
      checkout_id,
      status: 'active'
    }).select().single();

    if (error) throw error;

    // Create storage folder path
    const folderUrl = `/clients/${client.id}/`;
    await db.from('clients').update({ folder_url: folderUrl }).eq('id', client.id);

    // Send onboarding WhatsApp
    await sendClientMessage(phone, `onboard_${program}`, {
      name: name || 'there',
      templateParams: [name || 'there', program]
    });

    // For 12-week: trigger immediate Week 1 program generation
    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week 1 generation failed:', genErr.message);
      }
    }

    return res.status(200).json({ ok: true, client_id: client.id, program });
  } catch (err) {
    console.error('Exly webhook error:', err.message);

    // Payment failure for potential active client — notify Maddy
    if (req.body?.phone) {
      await notifyMaddy(
        'Payment Webhook Error',
        `Phone: ${maskPhone(req.body.phone)}\nError: ${err.message}`
      );
    }

    return res.status(500).json({ error: 'Internal error' });
  }
};
