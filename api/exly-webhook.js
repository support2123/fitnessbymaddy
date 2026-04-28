const crypto = require('crypto');
const { getSupabase } = require('./lib/supabase');
const { sendTemplate } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (secret) {
    const sig = req.headers['x-exly-signature'] || '';
    const raw = JSON.stringify(req.body);
    const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
    if (sig !== expected) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  const db = getSupabase();

  try {
    const { phone, email, name, checkout_id, amount, product } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    const normalizedPhone = phone.startsWith('+') ? phone : '+' + phone;

    const programKey = mapExlyProduct(product || checkout_id);

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', normalizedPhone)
      .single();

    const leadId = lead?.id || null;

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const programDuration = programKey === '12wk' ? 84 : 42;
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + programDuration * 24 * 60 * 60 * 1000);

    const { data: client, error } = await db.from('clients').insert({
      lead_id: leadId,
      phone: normalizedPhone,
      name: name || lead?.name || 'Unknown',
      email: email || null,
      program: programKey,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount ? parseFloat(amount) : null,
      checkout_id: checkout_id || null,
      folder_url: null,
      status: 'active',
    }).select().single();

    if (error) {
      console.error('Client insert error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}`;
    await db.storage.from('programs').upload(`${folderPath}/.keep`, new Blob(['']));
    await db.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    const templateName = `onboard_${programKey}`;
    await sendTemplate(normalizedPhone, templateName, [name || 'there']);

    if (programKey === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (genErr) {
        console.error('Week 1 program generation failed:', genErr.message);
      }
    }

    return res.status(200).json({ status: 'ok', client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapExlyProduct(product) {
  const p = (product || '').toLowerCase();
  if (p.includes('12') || p.includes('flagship') || p.includes('custom')) return '12wk';
  if (p.includes('pcos')) return 'pcos';
  if (p.includes('40') || p.includes('strong')) return '40plus';
  if (p.includes('trial') || p.includes('zoom')) return 'zoom_trial';
  if (p.includes('home')) return '6wk_home';
  return '6wk_gym';
}
