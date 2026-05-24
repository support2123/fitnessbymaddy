const { getSupabase } = require('../lib/supabase');
const { sendTemplate, detectMarket } = require('../lib/whatsapp');
const crypto = require('crypto');

const PROGRAM_MAP = {
  '6_week_shred': '6wk_gym',
  '6_week_home': '6wk_home',
  '12_week_custom': '12wk',
  pcos_warrior: 'pcos',
  '40_plus': '40plus',
  zoom_trial: 'zoom_trial',
  zoom_pack: 'zoom_pack',
};

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  pcos: 42,
  '40plus': 42,
  zoom_trial: 7,
  zoom_pack: 30,
};

function verifyExlySignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(body))
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature || ''),
    Buffer.from(expected)
  );
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const signature = req.headers['x-exly-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && !verifyExlySignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const {
      phone, email, name, product_id, amount,
      checkout_id, product_name,
    } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    const cleanPhone = phone.replace(/[^0-9]/g, '');
    const program = PROGRAM_MAP[product_id] || product_id || null;
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const market = detectMarket(cleanPhone);

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', cleanPhone)
      .single();

    const leadId = lead?.id || null;

    if (leadId) {
      await db
        .from('leads')
        .update({ status: 'converted', program_interest: program })
        .eq('id', leadId);
    }

    const programEnds = new Date();
    programEnds.setDate(programEnds.getDate() + durationDays);

    const { data: client, error } = await db.from('clients').insert({
      lead_id: leadId,
      phone: cleanPhone,
      name: name || lead?.name,
      email,
      program,
      paid_amount: amount ? parseInt(amount, 10) : null,
      checkout_id,
      program_started_at: new Date().toISOString(),
      program_ends_at: programEnds.toISOString(),
      folder_url: null,
      status: 'active',
    }).select().single();

    if (error) throw error;

    const folderPath = `clients/${client.id}`;
    await db.storage.from('clients').upload(
      `${client.id}/.keep`,
      Buffer.from(''),
      { contentType: 'text/plain', upsert: true }
    );

    await db.from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    const templateName = `onboard_${program || 'general'}`;
    await sendTemplate(cleanPhone, templateName, [
      name || 'there',
      product_name || program,
    ]);

    if (program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (genErr) {
        console.error('Week-1 program generation failed:', genErr.message);
      }
    }

    return res.json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
