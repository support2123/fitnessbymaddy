const crypto = require('crypto');
const { getSupabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { PROGRAM_META, weekNumber } = require('./_lib/helpers');
const { notifyMaddy } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

    const db = getSupabase();
    const {
      phone,
      name,
      email,
      checkout_id,
      amount,
      product_name,
    } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    const program = mapExlyProduct(product_name);
    const meta = PROGRAM_META[program] || PROGRAM_META['6wk_gym'];

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await db
        .from('leads')
        .update({ status: 'converted', name: name || lead.name })
        .eq('id', lead.id);
    }

    const programStarted = new Date();
    const programEnds = new Date(programStarted);
    programEnds.setDate(programEnds.getDate() + meta.weeks * 7);

    const folderPath = `clients/${crypto.randomUUID()}`;

    const { data: client } = await db
      .from('clients')
      .insert({
        lead_id: lead ? lead.id : null,
        phone,
        name: name || (lead ? lead.name : null),
        email,
        program,
        program_started_at: programStarted.toISOString(),
        program_ends_at: programEnds.toISOString(),
        paid_amount: amount || meta.price,
        checkout_id,
        folder_url: folderPath,
        status: 'active',
      })
      .select()
      .single();

    const market = lead ? lead.market : 'GLOBAL';
    const welcomeMsg =
      market === 'IN'
        ? `Welcome to ${meta.name}! 🎉 Tumhara program shuru ho gaya hai. Pehla check-in Day 7 pe aayega. Let's crush it!`
        : `Welcome to ${meta.name}! 🎉 Your program starts now. First check-in arrives on Day 7. Let's crush it!`;

    await sendTemplate(phone, `onboard_${program}`, [welcomeMsg]);

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (_) {
        console.error('[exly-webhook] Failed to trigger week-1 program');
      }
    }

    return res.status(200).json({ success: true, clientId: client.id });
  } catch (err) {
    console.error('[exly-webhook]', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapExlyProduct(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}
