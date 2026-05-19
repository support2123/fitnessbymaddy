const crypto = require('crypto');
const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { handleCors } = require('./_lib/cors');

const PROGRAM_MAP = {
  '6wk-burn-build': { program: '6wk_gym', weeks: 6 },
  '6wk-home': { program: '6wk_home', weeks: 6 },
  'pcos-warrior': { program: 'pcos', weeks: 6 },
  '40plus-strong': { program: '40plus', weeks: 6 },
  '12wk-custom': { program: '12wk', weeks: 12 },
  'zoom-trial': { program: 'zoom_trial', weeks: 1 },
  'zoom-pack': { program: 'zoom_pack', weeks: 4 }
};

function verifyExlySignature(body, signature) {
  if (!process.env.EXLY_WEBHOOK_SECRET) return true;
  const expected = crypto
    .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
    .update(JSON.stringify(body))
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const signature = req.headers['x-exly-signature'];
  if (process.env.EXLY_WEBHOOK_SECRET && !verifyExlySignature(req.body, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const db = getSupabase();

  try {
    const { phone, email, name, checkout_id, amount, product_id } = req.body;
    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const programInfo = PROGRAM_MAP[product_id] || PROGRAM_MAP['6wk-burn-build'];
    const now = new Date();
    const endsAt = new Date(now);
    endsAt.setDate(endsAt.getDate() + programInfo.weeks * 7);

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const { data: client, error } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name || null,
      email: email || null,
      program: programInfo.program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount ? parseInt(amount) : null,
      checkout_id,
      folder_url: null,
      status: 'active'
    }).select().single();

    if (error) throw error;

    const folderPath = `clients/${client.id}`;
    await db.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    const templateName = `onboard_${programInfo.program}`;
    await sendWhatsApp({
      phone,
      templateName,
      params: [name || 'Champion']
    });

    if (programInfo.program === '12wk') {
      try {
        await fetch(`${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : ''}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
          },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Initial program generation failed:', genErr.message);
      }
    }

    return res.json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
