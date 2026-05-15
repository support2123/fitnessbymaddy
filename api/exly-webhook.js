const crypto = require('crypto');
const { supabase } = require('./_lib/supabase');
const { sendTemplate, notifyMaddy } = require('./_lib/whatsapp');
const { isHinglish, detectMarket } = require('./_lib/market');

const PROGRAM_MAP = {
  '6wk_gym': { duration: 42, label: '6-Week Burn & Build (Gym)' },
  '6wk_home': { duration: 42, label: '6-Week Home Burn' },
  '12wk': { duration: 84, label: '12-Week Custom Training' },
  'pcos': { duration: 42, label: 'PCOS Warrior' },
  '40plus': { duration: 42, label: '40+ Strong' },
  'zoom_trial': { duration: 7, label: 'Zoom Trial Session' },
  'zoom_pack': { duration: 30, label: 'Zoom Pack' }
};

function verifyExlySignature(body, signature) {
  if (!process.env.EXLY_WEBHOOK_SECRET) return true;
  const expected = crypto
    .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
    .update(JSON.stringify(body))
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature || ''),
    Buffer.from(expected)
  );
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && !verifyExlySignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const {
      phone, email, name, amount, checkout_id,
      program, status: paymentStatus
    } = req.body || {};

    if (!phone || paymentStatus !== 'completed') {
      return res.status(200).json({ action: 'ignored', reason: 'incomplete or no phone' });
    }

    const cleanPhone = phone.replace(/\s+/g, '').replace(/^0+/, '');
    const programKey = program || '12wk';
    const programInfo = PROGRAM_MAP[programKey] || PROGRAM_MAP['12wk'];
    const market = detectMarket(cleanPhone);

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', cleanPhone)
      .single();

    if (lead) {
      await supabase.from('leads').update({
        status: 'converted',
        last_msg_at: new Date().toISOString()
      }).eq('id', lead.id);
    }

    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + programInfo.duration * 24 * 60 * 60 * 1000);

    const { data: client, error } = await supabase.from('clients').insert({
      lead_id: lead?.id || null,
      phone: cleanPhone,
      name: name || lead?.name || null,
      email: email || null,
      program: programKey,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount ? parseInt(amount) : null,
      checkout_id: checkout_id || null,
      folder_url: null,
      status: 'active'
    }).select().single();

    if (error) {
      console.error('Client insert error:', error);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}`;
    await supabase.storage.from('programs').upload(
      `${folderPath}/.folder`,
      new Blob([''])
    );

    await supabase.from('clients').update({
      folder_url: folderPath
    }).eq('id', client.id);

    const templateName = isHinglish(market)
      ? `onboard_${programKey}`
      : `onboard_${programKey}_en`;

    await sendTemplate(cleanPhone, templateName, [
      client.name || 'Champion',
      programInfo.label,
      endDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    ], true);

    if (programKey === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week 1 generation trigger failed:', genErr.message);
      }
    }

    return res.status(200).json({
      success: true,
      client_id: client.id,
      program: programKey
    });
  } catch (err) {
    console.error('Exly webhook error:', err.message);

    if (req.body?.phone) {
      await notifyMaddy(
        'Payment webhook error',
        `Phone: ${req.body.phone}\nError: ${err.message}`
      ).catch(() => {});
    }

    return res.status(500).json({ error: 'Internal error' });
  }
};
