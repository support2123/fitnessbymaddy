const { getClient } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { logMessage } = require('../lib/rate-limit');
const crypto = require('crypto');

const PROGRAM_MAP = {
  '6_week_shred': '6wk_gym',
  '6_week_home': '6wk_home',
  '12_week_custom': '12wk',
  'pcos_warrior': 'pcos',
  '40_plus_strong': '40plus',
  'zoom_trial': 'zoom_trial',
  'zoom_pack': 'zoom_pack',
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const signature = req.headers['x-exly-signature'] || '';
  if (process.env.EXLY_WEBHOOK_SECRET && signature) {
    const expected = crypto
      .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
      .update(JSON.stringify(req.body))
      .digest('hex');
    if (signature !== expected) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  const db = getClient();
  const {
    phone,
    email,
    name,
    product,
    amount,
    checkout_id,
    currency,
  } = req.body;

  if (!phone) return res.status(400).json({ error: 'phone required' });

  const program = PROGRAM_MAP[product] || product || 'unknown';

  const { data: lead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  if (lead) {
    await db
      .from('leads')
      .update({ status: 'converted', last_msg_at: new Date().toISOString() })
      .eq('id', lead.id);
  }

  const now = new Date();
  const programWeeks = program === '12wk' ? 12 : 6;
  const endsAt = new Date(now.getTime() + programWeeks * 7 * 24 * 60 * 60 * 1000);

  const { data: client, error } = await db.from('clients').upsert({
    lead_id: lead?.id || null,
    phone,
    name: name || lead?.name || null,
    email: email || null,
    program,
    program_started_at: now.toISOString(),
    program_ends_at: endsAt.toISOString(),
    paid_amount: amount || null,
    checkout_id: checkout_id || null,
    status: 'active',
  }, { onConflict: 'phone' }).select().single();

  if (error) {
    console.error('Client upsert error:', error.message);
    return res.status(500).json({ error: 'Failed to create client' });
  }

  const clientId = client?.id;

  if (clientId) {
    try {
      await db.storage
        .from('clients')
        .upload(`${clientId}/.keep`, new Uint8Array(0), {
          contentType: 'application/octet-stream',
          upsert: true,
        });
    } catch (e) {
      console.error('Storage folder creation:', e.message);
    }
  }

  const templateName = `onboard_${program}`;
  await sendTemplate(phone, templateName, [name || 'there']);
  await logMessage(phone, 'out', `Onboarding: ${program}`, templateName);

  if (program === '12wk' && clientId) {
    try {
      const baseUrl = `https://${req.headers.host}`;
      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.INTERNAL_API_KEY}`,
        },
        body: JSON.stringify({ client_id: clientId, week_no: 1 }),
      });
    } catch (err) {
      console.error('Week-1 generation trigger failed:', err.message);
    }
  }

  return res.status(200).json({ ok: true, client_id: clientId });
};
