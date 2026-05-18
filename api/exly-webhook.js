const crypto = require('crypto');
const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('./_lib/whatsapp');
const { PROGRAMS } = require('./_lib/constants');

function verifySignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const signature = req.headers['x-exly-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && !verifySignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const { checkout_id, customer_phone, customer_name, customer_email, product_name, amount } = req.body;

    if (!customer_phone) return res.status(400).json({ error: 'Missing customer phone' });

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', customer_phone)
      .limit(1);

    const leadId = lead && lead.length > 0 ? lead[0].id : null;
    const programKey = lead && lead.length > 0 ? lead[0].program_interest : detectProgram(product_name);

    if (leadId) {
      await db.from('leads')
        .update({ status: 'converted' })
        .eq('id', leadId);
    }

    const programInfo = PROGRAMS[programKey] || PROGRAMS['6wk_gym'];
    const programEnd = new Date();
    programEnd.setDate(programEnd.getDate() + (programInfo.duration * 7));

    const { data: newClient, error: clientErr } = await db.from('clients').insert({
      lead_id: leadId,
      phone: customer_phone,
      name: customer_name,
      email: customer_email,
      program: programKey || '6wk_gym',
      program_started_at: new Date().toISOString(),
      program_ends_at: programEnd.toISOString(),
      paid_amount: amount || programInfo.price,
      checkout_id: checkout_id || null,
      status: 'active'
    }).select().single();

    if (clientErr) {
      console.error('Client creation error:', clientErr.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${newClient.id}`;
    await db.storage.from('client-files').upload(
      `${folderPath}/.keep`,
      new Uint8Array([]),
      { contentType: 'text/plain', upsert: true }
    );

    await sendWhatsApp(customer_phone, `onboard_${programKey}`, {
      name: customer_name,
      templateParams: [customer_name, programInfo.name, String(programInfo.duration)]
    });

    if (programKey === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: newClient.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week 1 program generation failed:', genErr.message);
      }
    }

    return res.status(200).json({ success: true, client_id: newClient.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function detectProgram(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}
