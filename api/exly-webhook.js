const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalation');
const crypto = require('crypto');

function programDurationWeeks(program) {
  switch (program) {
    case '6wk_gym':
    case '6wk_home': return 6;
    case '12wk': return 12;
    case 'pcos': return 8;
    case '40plus': return 8;
    case 'zoom_trial': return 1;
    case 'zoom_pack': return 4;
    default: return 6;
  }
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const signature = req.headers['x-exly-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && signature) {
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (signature !== expected) {
        return res.status(401).json({ error: 'invalid signature' });
      }
    }

    const {
      phone, email, name, amount, checkout_id,
      product_name, status: paymentStatus,
    } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    if (paymentStatus === 'failed') {
      const { data: existingClient } = await db
        .from('clients')
        .select('*')
        .eq('phone', phone)
        .eq('status', 'active')
        .single();

      if (existingClient) {
        await escalateToMaddy({
          reason: 'Payment failure for active client',
          phone,
          details: `Checkout: ${checkout_id}, Amount: ${amount}`,
        });
      }
      return res.json({ action: 'payment_failed' });
    }

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    const programKey = lead?.program_interest || mapProductToProgram(product_name);
    const durationWeeks = programDurationWeeks(programKey);
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + durationWeeks * 7 * 24 * 60 * 60 * 1000);

    if (lead) {
      await db.from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const { data: client, error } = await db.from('clients').upsert({
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name || null,
      email: email || null,
      program: programKey,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount ? parseInt(amount) : null,
      checkout_id,
      folder_url: null,
      status: 'active',
    }, { onConflict: 'phone' }).select().single();

    if (error) throw error;

    const folderPath = `clients/${client.id}`;
    await db.storage.from('clients').upload(
      `${client.id}/.keep`,
      new Uint8Array(0),
      { contentType: 'text/plain', upsert: true }
    );
    await db.from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    await sendWhatsApp({
      phone,
      templateName: `onboard_${programKey}`,
      bodyValues: [name || 'there', durationWeeks.toString()],
    });

    if (programKey === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (genErr) {
        console.error('Week-1 generation trigger failed:', genErr.message);
      }
    }

    return res.json({ action: 'converted', client_id: client.id });

  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};

function mapProductToProgram(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  if (lower.includes('zoom') || lower.includes('trial')) return 'zoom_trial';
  return '6wk_gym';
}
