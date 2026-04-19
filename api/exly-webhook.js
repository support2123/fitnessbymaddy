const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalate');
const { maskPhone, PROGRAM_NAMES } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const secret = req.headers['x-webhook-secret'] || req.query.secret;
    if (secret !== process.env.EXLY_WEBHOOK_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const {
      phone, email, name, amount, checkout_id,
      product_name, status: paymentStatus,
    } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Phone required' });
    }

    if (paymentStatus === 'failed') {
      await escalateToMaddy('Payment failed', phone, `Amount: $${amount}, Product: ${product_name}`);
      return res.status(200).json({ action: 'payment_failed_escalated' });
    }

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await db.from('leads').update({
        status: 'converted',
        name: name || lead.name,
      }).eq('id', lead.id);
    }

    const program = lead?.program_interest || mapProduct(product_name);
    const programWeeks = program === '12wk' ? 12 : program?.startsWith('6wk') ? 6 : 4;
    const endsAt = new Date();
    endsAt.setDate(endsAt.getDate() + programWeeks * 7);

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .single();

    let clientId;

    if (existingClient) {
      await db.from('clients').update({
        program,
        paid_amount: amount ? parseInt(amount) : 0,
        checkout_id,
        status: 'active',
        program_started_at: new Date().toISOString(),
        program_ends_at: endsAt.toISOString(),
        email: email || undefined,
        name: name || undefined,
      }).eq('id', existingClient.id);
      clientId = existingClient.id;
    } else {
      const { data: newClient } = await db.from('clients').insert({
        lead_id: lead?.id || null,
        phone,
        name: name || lead?.name,
        email,
        program,
        paid_amount: amount ? parseInt(amount) : 0,
        checkout_id,
        status: 'active',
        program_started_at: new Date().toISOString(),
        program_ends_at: endsAt.toISOString(),
      }).select().single();
      clientId = newClient.id;
    }

    const folderPath = `clients/${clientId}`;
    await db.storage.from('clients').upload(`${clientId}/.keep`, new Blob(['']));

    await db.from('clients').update({ folder_url: folderPath }).eq('id', clientId);

    const programLabel = PROGRAM_NAMES[program] || product_name || 'your program';
    await sendWhatsApp({
      phone,
      templateName: `onboard_${program || 'general'}`,
      params: [name || 'there', programLabel],
    });

    if (program === '12wk') {
      try {
        const origin = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: clientId, week_no: 1 }),
        });
      } catch (e) {
        console.error('[PROGRAM GEN ERROR]', e.message);
      }
    }

    console.log(`[CONVERTED] ${maskPhone(phone)} → ${program} ($${amount})`);
    return res.status(200).json({ success: true, client_id: clientId });
  } catch (err) {
    console.error('[EXLY WEBHOOK ERROR]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapProduct(productName) {
  if (!productName) return null;
  const lower = productName.toLowerCase();
  if (lower.includes('shred') || lower.includes('6 week') || lower.includes('burn')) return '6wk_gym';
  if (lower.includes('12 week') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  return null;
}
