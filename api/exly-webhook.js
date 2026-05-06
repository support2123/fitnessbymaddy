const { getSupabase } = require('./lib/supabase');
const { sendTemplate, maskPhone, notifyMaddy } = require('./lib/whatsapp');
const { logMessage } = require('./lib/ratelimit');
const crypto = require('crypto');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 28,
};

function verifyExlySignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature || ''));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const signature = req.headers['x-exly-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && !verifyExlySignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const {
      phone,
      email,
      name,
      amount,
      checkout_id,
      product_name,
    } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    const db = getSupabase();

    const normalizedPhone = phone.replace(/\D/g, '').replace(/^(\d{10})$/, '91$1');

    let program = null;
    const pn = (product_name || '').toLowerCase();
    if (pn.includes('12') || pn.includes('flagship') || pn.includes('custom')) program = '12wk';
    else if (pn.includes('pcos')) program = 'pcos';
    else if (pn.includes('40') || pn.includes('plus')) program = '40plus';
    else if (pn.includes('home')) program = '6wk_home';
    else if (pn.includes('trial')) program = 'zoom_trial';
    else if (pn.includes('zoom') || pn.includes('pack')) program = 'zoom_pack';
    else if (pn.includes('6') || pn.includes('shred') || pn.includes('burn')) program = '6wk_gym';

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', normalizedPhone)
      .single();

    if (lead) {
      await db.from('leads').update({
        status: 'converted',
        name: name || lead.name,
      }).eq('id', lead.id);
    }

    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const programEnds = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: client, error } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone: normalizedPhone,
      name: name || lead?.name || null,
      email: email || null,
      program,
      program_started_at: new Date().toISOString(),
      program_ends_at: programEnds,
      paid_amount: amount ? parseInt(amount) : 0,
      checkout_id: checkout_id || null,
      folder_url: null,
      status: 'active',
    }).select().single();

    if (error) {
      console.error('Client insert error:', error);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}`;
    await db.storage.from('clients').upload(`${folderPath}/.keep`, new Blob(['']));
    await db.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    const templateName = `onboard_${program || 'general'}`;
    try {
      await sendTemplate(normalizedPhone, templateName, {
        name: name || 'there',
        templateParams: [name || 'there'],
      });
      await logMessage(normalizedPhone, 'out', `Onboarding template sent: ${templateName}`, templateName);
    } catch (sendErr) {
      console.error(`Onboard template failed for ${maskPhone(normalizedPhone)}:`, sendErr.message);
    }

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (genErr) {
        console.error('Week 1 program generation failed:', genErr.message);
      }
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
