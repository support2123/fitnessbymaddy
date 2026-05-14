const crypto = require('crypto');
const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, detectMarket } = require('./_lib/whatsapp');
const { PROGRAM_NAMES } = require('./_lib/qualify');

function verifyExlySignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const signature = req.headers['x-exly-signature'] || '';
    if (!verifyExlySignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const { phone, name, email, amount, checkout_id, product_name } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    const db = getSupabase();

    let program = '6wk_gym';
    const pName = (product_name || '').toLowerCase();
    if (pName.includes('12') || pName.includes('custom') || pName.includes('flagship')) program = '12wk';
    else if (pName.includes('pcos')) program = 'pcos';
    else if (pName.includes('40') || pName.includes('strong')) program = '40plus';
    else if (pName.includes('trial') || pName.includes('zoom trial')) program = 'zoom_trial';
    else if (pName.includes('zoom pack')) program = 'zoom_pack';
    else if (pName.includes('home')) program = '6wk_home';

    const programWeeks = program === '12wk' ? 12 : program.startsWith('6wk') ? 6 : 8;
    const endsAt = new Date();
    endsAt.setDate(endsAt.getDate() + programWeeks * 7);

    const { data: lead } = await db
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .maybeSingle();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const { data: client, error } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || null,
      email: email || null,
      program,
      program_started_at: new Date().toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount ? parseInt(amount) : null,
      checkout_id: checkout_id || null,
      folder_url: null,
      status: 'active'
    }).select('id').single();

    if (error) throw error;

    const folderPath = `clients/${client.id}`;
    await db.storage.from('client-files').upload(`${folderPath}/.keep`, new Uint8Array(0), {
      contentType: 'application/octet-stream',
      upsert: true
    });
    await db.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    const market = detectMarket(phone);
    const templateName = market === 'IN' ? `onboard_${program}_hinglish` : `onboard_${program}_en`;
    await sendTemplate(phone, templateName, {
      name: name || 'there',
      templateParams: [name || 'there', PROGRAM_NAMES[program] || program]
    });

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week-1 program generation failed:', genErr.message);
      }
    }

    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
