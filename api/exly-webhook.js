const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');

const PROGRAM_DURATION = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30,
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

    const { phone, email, name, product, amount, checkout_id } = req.body;
    if (!phone) return res.status(400).json({ error: 'phone required' });

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const program = lead?.program_interest || mapExlyProduct(product);
    const durationDays = PROGRAM_DURATION[program] || 42;
    const programEnds = new Date(Date.now() + durationDays * 86400000).toISOString();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .single();

    let clientId;
    if (existingClient) {
      await db.from('clients').update({
        program,
        paid_amount: amount,
        checkout_id,
        status: 'active',
        program_started_at: new Date().toISOString(),
        program_ends_at: programEnds,
        name: name || undefined,
        email: email || undefined,
      }).eq('id', existingClient.id);
      clientId = existingClient.id;
    } else {
      const { data: newClient } = await db.from('clients').insert({
        lead_id: lead?.id,
        phone,
        name: name || lead?.name,
        email,
        program,
        paid_amount: amount,
        checkout_id,
        status: 'active',
        program_started_at: new Date().toISOString(),
        program_ends_at: programEnds,
      }).select('id').single();
      clientId = newClient.id;
    }

    const folderPath = `clients/${clientId}`;
    await db.from('clients').update({ folder_url: folderPath }).eq('id', clientId);

    const market = lead?.market || detectMarket(phone);
    const welcomeParams = isHinglish(market)
      ? [`Welcome to FitnessByMaddy! Tera ${program} program shuru ho gaya hai. Week 1 ka plan jaldi aayega!`]
      : [`Welcome to FitnessByMaddy! Your ${program} program has started. Week 1 plan coming soon!`];

    await sendWhatsApp(phone, `onboard_${program}`, welcomeParams);

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: clientId, week_no: 1 }),
        });
      } catch (genErr) {
        console.error('[exly-webhook] program generation failed:', genErr.message);
      }
    }

    return res.status(200).json({ success: true, client_id: clientId });
  } catch (err) {
    console.error('[exly-webhook]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapExlyProduct(product) {
  if (!product) return '6wk_gym';
  const lower = product.toLowerCase();
  if (lower.includes('12') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  return '6wk_gym';
}
