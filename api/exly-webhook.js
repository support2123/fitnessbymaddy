const { getSupabase } = require('./lib/supabase');
const { sendTemplate, sendMessage } = require('./lib/whatsapp');
const { logMessage } = require('./lib/ratelimit');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (secret) {
    const signature = req.headers['x-exly-signature'] || '';
    const expected = crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(req.body))
      .digest('hex');
    if (signature !== expected) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  const db = getSupabase();
  const { phone, email, amount, checkout_id, product_name } = req.body;

  if (!phone) return res.status(400).json({ error: 'phone required' });

  const { data: lead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  if (!lead) {
    return res.status(404).json({ error: 'Lead not found for this phone' });
  }

  const program = lead.program_interest || mapProductToProgram(product_name);
  const now = new Date();
  const programWeeks = program === '12wk' ? 12 : 6;
  const endsAt = new Date(now.getTime() + programWeeks * 7 * 24 * 60 * 60 * 1000);

  await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);

  const { data: client, error } = await db.from('clients').upsert({
    lead_id: lead.id,
    phone: lead.phone,
    name: lead.name,
    email: email || null,
    program,
    program_started_at: now.toISOString(),
    program_ends_at: endsAt.toISOString(),
    paid_amount: amount || 0,
    checkout_id: checkout_id || null,
    status: 'active',
  }, { onConflict: 'lead_id' }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  const folderPath = `clients/${client.id}`;
  await db.storage.from('programs').upload(`${folderPath}/.keep`, new Uint8Array(0), {
    upsert: true,
  });

  await db.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

  const market = lead.market || 'GLOBAL';
  const welcomeMsg = market === 'IN'
    ? `🎉 Welcome to the team, ${lead.name || 'champion'}! Tumhara ${programWeeks}-week journey ab start hota hai. Day 7 pe first check-in form aayega. Let's crush it!`
    : `🎉 Welcome to the team, ${lead.name || 'champion'}! Your ${programWeeks}-week journey starts now. First check-in form arrives on Day 7. Let's crush it!`;

  await sendTemplate(phone, `onboard_${program}`, [lead.name || 'there']);
  await logMessage(phone, 'out', welcomeMsg, `onboard_${program}`);

  if (program === '12wk') {
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://fitnessbymaddy.com';
    try {
      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 }),
      });
    } catch (e) {
      console.error('Week 1 program generation failed:', e.message);
    }
  }

  return res.status(200).json({ success: true, client_id: client.id });
};

function mapProductToProgram(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  return '6wk_gym';
}
