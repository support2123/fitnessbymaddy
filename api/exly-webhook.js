const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, maskPhone } = require('../lib/whatsapp');
const { logMessage } = require('../lib/rate-limit');
const { escalateToMaddy } = require('../lib/escalation');

const PROGRAM_MAP = {
  '6wk_gym': { name: '6-Week Burn & Build (Gym)', weeks: 6 },
  '6wk_home': { name: '6-Week Burn & Build (Home)', weeks: 6 },
  '12wk': { name: '12-Week Flagship', weeks: 12 },
  'pcos': { name: 'PCOS Warrior', weeks: 6 },
  '40plus': { name: '40+ Strong', weeks: 6 },
  'zoom_trial': { name: 'Zoom Trial', weeks: 1 },
  'zoom_pack': { name: 'Zoom Pack', weeks: 4 }
};

function verifyWebhookSignature(body, signature) {
  if (!process.env.EXLY_WEBHOOK_SECRET) return true;
  const expected = crypto
    .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
    .update(JSON.stringify(body))
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const signature = req.headers['x-exly-signature'];
  if (process.env.EXLY_WEBHOOK_SECRET && !verifyWebhookSignature(req.body, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const { phone, email, name, amount, checkout_id, product_id, status: paymentStatus } = req.body;

  if (paymentStatus === 'failed') {
    await escalateToMaddy('Payment failure', { phone, name, message: `Payment failed for checkout ${checkout_id}` });
    return res.status(200).json({ action: 'payment_failed_escalated' });
  }

  if (paymentStatus !== 'success' && paymentStatus !== 'completed') {
    return res.status(200).json({ action: 'ignored', reason: `Status: ${paymentStatus}` });
  }

  const supabase = getSupabase();

  const programKey = product_id || '6wk_gym';
  const programInfo = PROGRAM_MAP[programKey] || PROGRAM_MAP['6wk_gym'];

  const { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .limit(1)
    .single();

  if (lead) {
    await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
  }

  const programStarted = new Date();
  const programEnds = new Date(programStarted);
  programEnds.setDate(programEnds.getDate() + programInfo.weeks * 7);

  const { data: client, error } = await supabase.from('clients').insert({
    lead_id: lead?.id,
    phone,
    name: name || lead?.name,
    email,
    program: programKey,
    program_started_at: programStarted.toISOString(),
    program_ends_at: programEnds.toISOString(),
    paid_amount: amount ? parseFloat(amount) : 0,
    checkout_id,
    status: 'active'
  }).select().single();

  if (error) {
    console.error(`Client creation failed for ${maskPhone(phone)}:`, error.message);
    return res.status(500).json({ error: 'Failed to create client' });
  }

  const folderPath = `clients/${client.id}`;
  await supabase.storage.from('programs').upload(
    `${folderPath}/.keep`,
    new Uint8Array(0),
    { contentType: 'text/plain', upsert: true }
  );

  await supabase.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

  const templateName = `onboard_${programKey}`;
  await sendWhatsApp(phone, templateName, {
    name: name || 'there',
    templateParams: [name || 'there', programInfo.name]
  });
  await logMessage(phone, 'out', `Onboarding: ${programInfo.name}`, templateName);

  if (programKey === '12wk') {
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://www.fitnessbymaddy.com';

    await fetch(`${baseUrl}/api/generate-program`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
      },
      body: JSON.stringify({ client_id: client.id, week_no: 1 })
    });
  }

  console.log(`Conversion: ${maskPhone(phone)} → ${programKey}`);
  return res.status(200).json({ success: true, clientId: client.id, program: programKey });
};
