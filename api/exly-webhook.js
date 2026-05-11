const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp, sendEscalation } = require('./_lib/whatsapp');
const { isHinglish, detectMarket } = require('./_lib/market');
const crypto = require('crypto');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30,
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const signature = req.headers['x-exly-signature'] || '';
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret && signature) {
      const expected = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (signature !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      phone, name, email, product_name, amount,
      checkout_id, lead_id,
    } = req.body || {};

    if (!phone) return res.status(400).json({ error: 'phone required' });

    const db = getSupabase();
    const program = mapProductToProgram(product_name) || '6wk_gym';
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    let resolvedLeadId = lead_id;
    if (!resolvedLeadId) {
      const { data: lead } = await db
        .from('leads')
        .select('id')
        .eq('phone', phone)
        .limit(1)
        .single();
      resolvedLeadId = lead?.id || null;
    }

    if (resolvedLeadId) {
      await db.from('leads')
        .update({ status: 'converted' })
        .eq('id', resolvedLeadId);
    }

    const now = new Date();
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: client, error } = await db.from('clients').insert({
      lead_id: resolvedLeadId,
      phone,
      name,
      email,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount ? parseInt(amount, 10) : 0,
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
      new Blob([''], { type: 'text/plain' }),
      { upsert: true }
    );
    await db.from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    const templateName = hinglish ? `onboard_${program}_hi` : `onboard_${program}`;
    await sendWhatsApp({
      phone,
      templateName,
      params: [name || 'there'],
    });

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (e) {
        console.error('Week 1 program generation failed:', e.message);
      }
    }

    return res.json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    await sendEscalation(`Payment webhook error: ${err.message}`);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapProductToProgram(productName) {
  if (!productName) return null;
  const lower = productName.toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('6') || lower.includes('shred') || lower.includes('burn')) return '6wk_gym';
  return null;
}
