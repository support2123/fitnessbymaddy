const crypto = require('crypto');
const { getSupabase } = require('./lib/supabase');
const { sendTemplate, notifyMaddy, maskPhone } = require('./lib/whatsapp');

const PROGRAM_MAP = {
  '6_week_shred': '6wk_gym',
  '6_week_home': '6wk_home',
  '12_week_custom': '12wk',
  'pcos_warrior': 'pcos',
  '40_plus_strong': '40plus',
  'zoom_trial': 'zoom_trial',
  'zoom_pack': 'zoom_pack'
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

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (secret) {
    const sig = req.headers['x-exly-signature'] || '';
    const rawBody = JSON.stringify(req.body);
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    if (sig && sig !== expected) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  const db = getSupabase();

  try {
    const { phone, name, email, product, amount, checkout_id } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    const program = PROGRAM_MAP[product] || '12wk';
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const endsAt = new Date(Date.now() + durationDays * 86400000).toISOString();

    const { data: lead } = await db
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .single();

    const leadId = lead ? lead.id : null;

    if (leadId) {
      await db.from('leads').update({ status: 'converted' }).eq('id', leadId);
    }

    const { data: client, error: insertErr } = await db.from('clients').insert({
      lead_id: leadId,
      phone,
      name: name || null,
      email: email || null,
      program,
      program_started_at: new Date().toISOString(),
      program_ends_at: endsAt,
      paid_amount: amount || 0,
      checkout_id: checkout_id || null,
      folder_url: null,
      status: 'active'
    }).select().single();

    if (insertErr) throw insertErr;

    const folderUrl = `/clients/${client.id}/`;
    await db.from('clients').update({ folder_url: folderUrl }).eq('id', client.id);

    const templateName = `onboard_${program}`;
    await sendTemplate(phone, templateName, [name || 'Champion']);

    if (program === '12wk') {
      try {
        const baseUrl = req.headers['x-forwarded-proto'] + '://' + req.headers['x-forwarded-host'];
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-key': process.env.SUPABASE_SERVICE_KEY
          },
          body: JSON.stringify({ clientId: client.id, weekNo: 1 })
        });
      } catch (e) {
        console.error('Week-1 program generation trigger failed:', e.message);
      }
    }

    return res.status(200).json({
      ok: true,
      clientId: client.id,
      program
    });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    await notifyMaddy('Payment webhook error', `Error: ${err.message}`);
    return res.status(500).json({ error: 'Processing failed' });
  }
};
