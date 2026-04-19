const { getSupabase } = require('./lib/supabase');
const { sendTemplate } = require('./lib/whatsapp');
const { detectMarket, isHinglish } = require('./lib/market');
const { formatProgram } = require('./lib/pdf');

const PROGRAM_MAP = {
  '6wk-burn-build': '6wk_gym',
  '6wk-home': '6wk_home',
  '12wk-flagship': '12wk',
  'pcos-warrior': 'pcos',
  '40plus-strong': '40plus',
  'zoom-trial': 'zoom_trial',
  'zoom-pack': 'zoom_pack'
};

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 28
};

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const webhookSecret = req.headers['x-webhook-secret'] || req.query.secret;
  if (webhookSecret !== process.env.EXLY_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Invalid webhook secret' });
  }

  try {
    const { phone, name, email, product_id, amount, checkout_id } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    const db = getSupabase();
    const normalizedPhone = normalizePhone(phone);
    const program = PROGRAM_MAP[product_id] || 'zoom_trial';
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const now = new Date();
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    let { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', normalizedPhone)
      .single();

    if (lead) {
      await db.from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    } else {
      const { data: newLead } = await db.from('leads').insert({
        phone: normalizedPhone,
        name,
        source: 'exly_direct',
        status: 'converted',
        market: detectMarket(normalizedPhone)
      }).select().single();
      lead = newLead;
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('phone', normalizedPhone)
      .eq('program', program)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      return res.status(200).json({ action: 'already_active', client_id: existingClient.id });
    }

    const folderPath = `clients/${lead.id}`;

    const { data: client, error } = await db.from('clients').insert({
      lead_id: lead.id,
      phone: normalizedPhone,
      name: name || lead.name,
      email,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount ? parseInt(amount) : null,
      checkout_id,
      folder_url: folderPath,
      status: 'active'
    }).select().single();

    if (error) throw error;

    const market = lead.market || detectMarket(normalizedPhone);
    const templateName = isHinglish(market) ? `onboard_${program}` : `onboard_${program}_en`;
    await sendTemplate(normalizedPhone, templateName, [
      name || lead.name || 'there',
      formatProgram(program)
    ]);

    if (program === '12wk') {
      await fetch(`https://www.fitnessbymaddy.com/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
        },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      });
    }

    return res.status(200).json({ action: 'converted', client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function normalizePhone(phone) {
  let p = (phone || '').replace(/[\s\-\(\)]/g, '');
  if (!p.startsWith('+') && p.length >= 10) p = '+' + p;
  return p;
}
