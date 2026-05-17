const { supabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const crypto = require('crypto');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  pcos: 42,
  '40plus': 42,
  zoom_trial: 7,
  zoom_pack: 30
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
    const signature = req.headers['x-exly-signature'];
    if (!verifyExlySignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const { phone, name, email, program, amount, checkout_id } = req.body;

    if (!phone || !program) {
      return res.status(400).json({ error: 'phone and program required' });
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await supabase.from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const startDate = new Date();
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: existingClient } = await supabase
      .from('clients')
      .select('*')
      .eq('phone', phone)
      .single();

    let clientId;

    if (existingClient) {
      await supabase.from('clients').update({
        program,
        program_started_at: startDate.toISOString(),
        program_ends_at: endDate.toISOString(),
        paid_amount: amount ? parseInt(amount) : null,
        checkout_id,
        status: 'active',
        name: name || existingClient.name,
        email: email || existingClient.email
      }).eq('id', existingClient.id);
      clientId = existingClient.id;
    } else {
      const { data: newClient } = await supabase.from('clients').insert({
        lead_id: lead?.id || null,
        phone,
        name: name || lead?.name,
        email,
        program,
        program_started_at: startDate.toISOString(),
        program_ends_at: endDate.toISOString(),
        paid_amount: amount ? parseInt(amount) : null,
        checkout_id,
        status: 'active'
      }).select().single();
      clientId = newClient.id;
    }

    const folderPath = `clients/${clientId}`;
    await supabase.storage.from('clients').upload(
      `${folderPath}/.keep`,
      new Blob([''], { type: 'text/plain' }),
      { upsert: true }
    );

    await supabase.from('clients')
      .update({ folder_url: folderPath })
      .eq('id', clientId);

    await sendWhatsApp(phone, `onboard_${program}`, {
      name: name || lead?.name || 'there',
      templateParams: [name || lead?.name || 'there']
    });

    if (program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: clientId, week_no: 1 })
        });
      } catch (e) {
        console.error('Week-1 program generation failed:', e.message);
      }
    }

    return res.status(200).json({ success: true, client_id: clientId });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
