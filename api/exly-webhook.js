const { getClient } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');
const crypto = require('crypto');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42, '6wk_home': 42,
  '12wk': 84,
  pcos: 42, '40plus': 42,
  zoom_trial: 7, zoom_pack: 28,
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret) {
      const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'] || '';
      const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
      if (sig && sig !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const { buyer_phone, buyer_name, buyer_email, product_name, amount, checkout_id, order_id } = parseExlyPayload(req.body);

    if (!buyer_phone) {
      return res.status(400).json({ error: 'buyer_phone required' });
    }

    const db = getClient();

    const program = mapProductToProgram(product_name);
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: lead } = await db
      .from('leads')
      .select('id')
      .eq('phone', buyer_phone)
      .limit(1)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const folderPath = `clients/${checkout_id || order_id || Date.now()}`;

    const { data: client, error } = await db.from('clients').upsert({
      lead_id: lead ? lead.id : null,
      phone: buyer_phone,
      name: buyer_name || null,
      email: buyer_email || null,
      program,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount ? Math.round(parseFloat(amount) * 100) : null,
      checkout_id: checkout_id || order_id || null,
      folder_url: folderPath,
      status: 'active',
    }, { onConflict: 'phone' }).select().single();

    if (error) throw error;

    try {
      await db.storage.from('clients').upload(`${folderPath}/.keep`, new Uint8Array(0), {
        contentType: 'application/octet-stream',
        upsert: true,
      });
    } catch (storageErr) {
      console.log('Storage folder creation skipped:', storageErr.message);
    }

    await sendWhatsApp({
      phone: buyer_phone,
      templateName: `onboard_${program}`,
      bodyValues: [
        buyer_name || 'there',
        `Your ${programLabel(program)} starts now!`,
        `https://www.fitnessbymaddy.com/intake?lead=${lead ? lead.id : client.id}`,
      ],
    });

    if (program === '12wk') {
      try {
        await fetch(`https://www.fitnessbymaddy.com/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-key': process.env.INTERNAL_API_KEY,
          },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (genErr) {
        console.log('Week-1 generation queued for:', maskPhone(buyer_phone));
      }
    }

    console.log(`Conversion: ${maskPhone(buyer_phone)} → ${program}`);
    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parseExlyPayload(body) {
  return {
    buyer_phone: body.buyer_phone || body.phone || body.customer_phone || '',
    buyer_name: body.buyer_name || body.name || body.customer_name || '',
    buyer_email: body.buyer_email || body.email || body.customer_email || '',
    product_name: body.product_name || body.product || body.item_name || '',
    amount: body.amount || body.total || body.price || 0,
    checkout_id: body.checkout_id || body.transaction_id || '',
    order_id: body.order_id || body.id || '',
  };
}

function mapProductToProgram(productName) {
  const lower = (productName || '').toLowerCase();
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}

function programLabel(program) {
  const labels = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Custom Program',
    pcos: 'PCOS Warrior Program',
    '40plus': '40+ Strong Program',
    zoom_trial: 'Zoom Trial Session',
    zoom_pack: 'Zoom Session Pack',
  };
  return labels[program] || program;
}
