const crypto = require('crypto');
const { supabase } = require('../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');

const PROGRAM_MAP = {
  '6wk_gym': { weeks: 6, label: '6-Week Burn & Build (Gym)' },
  '6wk_home': { weeks: 6, label: '6-Week Burn & Build (Home)' },
  '12wk': { weeks: 12, label: '12-Week Custom Training' },
  'pcos': { weeks: 8, label: 'PCOS Warrior' },
  '40plus': { weeks: 8, label: '40+ Strong' },
  'zoom_trial': { weeks: 1, label: 'Zoom Trial Session' },
  'zoom_pack': { weeks: 4, label: 'Zoom Pack (4 Sessions)' }
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'] || '';
    if (process.env.EXLY_WEBHOOK_SECRET && signature) {
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (signature !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      phone, name, email, amount, checkout_id,
      program, product_name
    } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const programKey = program || inferProgram(product_name, amount);
    const programInfo = PROGRAM_MAP[programKey] || PROGRAM_MAP['6wk_gym'];

    const now = new Date();
    const endsAt = new Date(now);
    endsAt.setDate(endsAt.getDate() + programInfo.weeks * 7);

    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .maybeSingle();

    if (lead) {
      await supabase.from('leads')
        .update({ status: 'converted', program_interest: programKey })
        .eq('id', lead.id);
    }

    const { data: client, error: clientError } = await supabase
      .from('clients')
      .insert({
        lead_id: lead ? lead.id : null,
        phone,
        name: name || null,
        email: email || null,
        program: programKey,
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: amount ? Math.round(parseFloat(amount) * 100) : null,
        checkout_id: checkout_id || null,
        folder_url: null,
        status: 'active'
      })
      .select()
      .single();

    if (clientError) {
      console.error('Client insert error:', clientError.message);
      await notifyMaddy(
        'Payment received but client creation failed',
        `Phone: ${maskPhone(phone)}\nName: ${name}\nProgram: ${programKey}\nError: ${clientError.message}`
      );
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}`;
    await supabase.storage
      .from('programs')
      .upload(`${folderPath}/.keep`, new Uint8Array(0), { upsert: true });

    await supabase.from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    const templateName = `onboard_${programKey}`;
    await sendTemplate(phone, templateName, [name || 'there', programInfo.label]);

    if (programKey === '12wk') {
      const generateRes = await fetch(
        `https://${req.headers.host}/api/generate-program`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
          },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        }
      );

      if (!generateRes.ok) {
        await notifyMaddy(
          'Week 1 program generation failed',
          `Client: ${maskPhone(phone)} (${name})\nProgram: 12wk`
        );
      }
    }

    return res.status(200).json({ success: true, client_id: client.id });

  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function inferProgram(productName, amount) {
  if (!productName) return '6wk_gym';
  const lower = (productName || '').toLowerCase();
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('home')) return '6wk_home';
  if (amount && parseFloat(amount) >= 150) return '12wk';
  return '6wk_gym';
}
