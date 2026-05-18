const crypto = require('crypto');
const { getSupabase } = require('./lib/supabase');
const { sendTemplate } = require('./lib/whatsapp');

const PROGRAM_MAP = {
  '6wk_gym': { weeks: 6, name: '6-Week Burn & Build (Gym)' },
  '6wk_home': { weeks: 6, name: '6-Week Burn & Build (Home)' },
  '12wk': { weeks: 12, name: '12-Week Flagship Program' },
  'pcos': { weeks: 6, name: 'PCOS Warrior Program' },
  '40plus': { weeks: 6, name: '40+ Strong Program' },
  'zoom_trial': { weeks: 1, name: 'Zoom Trial Session' },
  'zoom_pack': { weeks: 4, name: 'Zoom Session Pack' }
};

module.exports = async function handler(req, res) {
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

    const { phone, email, name, amount, checkout_id, product_id, status } = req.body;

    if (status !== 'completed' && status !== 'success') {
      return res.status(200).json({ ok: true, action: 'ignored_status' });
    }

    const db = getSupabase();

    const normalizedPhone = phone?.startsWith('+') ? phone : '+' + phone;

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', normalizedPhone)
      .single();

    const program = lead?.program_interest || mapProductToProgram(product_id) || '6wk_gym';
    const programInfo = PROGRAM_MAP[program] || PROGRAM_MAP['6wk_gym'];

    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + programInfo.weeks * 7 * 24 * 60 * 60 * 1000);

    const { data: client, error: clientError } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone: normalizedPhone,
      name: name || lead?.name,
      email,
      program,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount ? Math.round(parseFloat(amount) * 100) : null,
      checkout_id,
      status: 'active'
    }).select().single();

    if (clientError) {
      console.error('Client insert error:', clientError.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const folderPath = `clients/${client.id}/`;
    await db.storage.from('client-files').upload(
      `${folderPath}.keep`,
      '',
      { contentType: 'text/plain', upsert: true }
    );

    await db.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    const templateName = `onboard_${program}`;
    await sendTemplate(normalizedPhone, templateName, [
      client.name || 'there',
      programInfo.name,
      `${programInfo.weeks} weeks`
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

    return res.status(200).json({ ok: true, client_id: client.id, program });

  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function mapProductToProgram(productId) {
  if (!productId) return null;
  const lower = String(productId).toLowerCase();
  if (lower.includes('shred') || lower.includes('6wk') || lower.includes('burn')) return '6wk_gym';
  if (lower.includes('12wk') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('plus')) return '40plus';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  return null;
}
