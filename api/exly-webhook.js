const { getClient } = require('../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');
const { maskPhone, PROGRAM_DURATIONS_WEEKS, PROGRAM_NAMES } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = req.headers['x-webhook-secret'] || req.headers['x-exly-secret'];
  if (secret !== process.env.EXLY_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Invalid webhook secret' });
  }

  const db = getClient();

  try {
    const {
      customer_phone, customer_name, customer_email,
      product_name, amount, checkout_id, lead_id,
    } = req.body;

    if (!customer_phone) {
      return res.status(400).json({ error: 'customer_phone required' });
    }

    const cleanPhone = customer_phone.replace(/\D/g, '');
    const program = mapExlyProduct(product_name);

    if (!program) {
      await notifyMaddy('Unknown Product', `Purchase: ${product_name} by ${maskPhone(cleanPhone)}`);
      return res.status(200).json({ ok: true, warning: 'unknown_product' });
    }

    const { data: lead } = await db.from('leads')
      .select('*')
      .eq('phone', cleanPhone)
      .limit(1)
      .single();

    const leadId = lead?.id || lead_id;

    if (leadId) {
      await db.from('leads').update({ status: 'converted' }).eq('id', leadId);
    }

    const durationWeeks = PROGRAM_DURATIONS_WEEKS[program] || 6;
    const endsAt = new Date();
    endsAt.setDate(endsAt.getDate() + durationWeeks * 7);

    const { data: client, error } = await db.from('clients').insert({
      lead_id: leadId,
      phone: cleanPhone,
      name: customer_name || lead?.name,
      email: customer_email,
      program,
      program_started_at: new Date().toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount,
      checkout_id,
      status: 'active',
    }).select().single();

    if (error) {
      console.error('Client insert error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}`;
    await db.storage.from('clients').upload(
      `${client.id}/.keep`,
      new Uint8Array([0]),
      { contentType: 'application/octet-stream', upsert: true }
    );

    await db.from('clients').update({
      folder_url: folderPath,
    }).eq('id', client.id);

    const programName = PROGRAM_NAMES[program] || program;
    await sendTemplate(cleanPhone, `onboard_${program}`, [
      customer_name || 'there',
      programName,
    ]);

    if (program === '12wk') {
      try {
        await fetch(`${getBaseUrl(req)}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
          },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (e) {
        console.error('Program gen trigger failed:', e.message);
      }
    }

    console.log(`Conversion: ${maskPhone(cleanPhone)} → ${program}`);
    return res.status(200).json({ ok: true, client_id: client.id });

  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapExlyProduct(productName) {
  if (!productName) return null;
  const lower = productName.toLowerCase();
  if (lower.includes('12') && lower.includes('week')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('shred') || lower.includes('burn') || lower.includes('6')) return '6wk_gym';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') || lower.includes('pack')) return 'zoom_pack';
  return null;
}

function getBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}
