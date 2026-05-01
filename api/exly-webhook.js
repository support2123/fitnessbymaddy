const crypto = require('crypto');
const { getSupabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { detectMarket, isHinglish } = require('./_lib/market');

const PROGRAM_DURATION_WEEKS = {
  '6wk_gym': 6,
  '6wk_home': 6,
  '12wk': 12,
  'pcos': 8,
  '40plus': 8,
  'zoom_trial': 1,
  'zoom_pack': 4,
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    // Verify webhook signature if secret is set
    if (process.env.EXLY_WEBHOOK_SECRET) {
      const signature = req.headers['x-exly-signature'] || '';
      const payload = JSON.stringify(req.body);
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(payload)
        .digest('hex');
      if (signature !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      checkout_id, phone, name, email,
      product_name, amount, status,
    } = req.body;

    if (status !== 'completed' && status !== 'success') {
      return res.status(200).json({ action: 'ignored', reason: 'not completed' });
    }

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();
    const market = detectMarket(phone);

    // Determine program from product name
    const program = mapProductToProgram(product_name);
    const durationWeeks = PROGRAM_DURATION_WEEKS[program] || 6;
    const now = new Date();
    const endsAt = new Date(now.getTime() + durationWeeks * 7 * 24 * 60 * 60 * 1000);

    // Find or update lead
    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await db.from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    // Create or update client
    const { data: existingClient } = await db
      .from('clients')
      .select('*')
      .eq('phone', phone)
      .single();

    let clientId;
    const clientData = {
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name,
      email,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount || 0,
      checkout_id,
      status: 'active',
    };

    if (existingClient) {
      await db.from('clients').update(clientData).eq('id', existingClient.id);
      clientId = existingClient.id;
    } else {
      const { data: newClient } = await db
        .from('clients')
        .insert(clientData)
        .select('id')
        .single();
      clientId = newClient.id;
    }

    // Create storage folder
    const folderPath = `clients/${clientId}/.keep`;
    await db.storage.from('programs').upload(folderPath, Buffer.from(''), {
      upsert: true,
    });

    await db.from('clients')
      .update({ folder_url: `clients/${clientId}/` })
      .eq('id', clientId);

    // Send onboarding template
    const templateName = isHinglish(market)
      ? `onboard_${program}_hi`
      : `onboard_${program}`;
    await sendTemplate(phone, templateName, [name || 'there']);

    // For 12-week program, trigger Week 1 generation
    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: clientId, week_no: 1 }),
        });
      } catch (genErr) {
        console.error('Week 1 generation failed:', genErr.message);
      }
    }

    return res.status(200).json({ action: 'converted', clientId, program });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapProductToProgram(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}
