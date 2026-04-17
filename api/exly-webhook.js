const crypto = require('crypto');
const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/market');
const { getProgramDuration } = require('./_lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (secret) {
    const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
    if (signature) {
      const expected = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (signature !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }
  }

  try {
    const {
      phone, name, email, checkout_id, amount,
      product_name, product_id,
    } = parseExlyPayload(req.body);

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    const supabase = getSupabase();

    let leadId;
    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      leadId = lead.id;
      await supabase
        .from('leads')
        .update({ status: 'converted', last_msg_at: new Date().toISOString() })
        .eq('id', lead.id);
    } else {
      const { data: newLead } = await supabase
        .from('leads')
        .insert({ phone, name, source: 'exly', status: 'converted' })
        .select()
        .single();
      leadId = newLead.id;
    }

    const program = detectProgram(product_name, product_id, lead?.program_interest);
    const durationDays = getProgramDuration(program);
    const now = new Date();
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: client } = await supabase.from('clients').insert({
      lead_id: leadId,
      phone,
      name: name || lead?.name,
      email,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount,
      checkout_id,
      folder_url: `/clients/${leadId}/`,
      status: 'active',
    }).select().single();

    const folderPath = `clients/${client.id}/`;
    await supabase.storage
      .from('client-files')
      .upload(`${folderPath}.keep`, new Uint8Array(0), { upsert: true });

    await sendWhatsApp({
      phone,
      templateName: `onboard_${program}`,
      body: `Welcome to FitnessByMaddy! \u{1F389} You're now enrolled in the ${formatProgramName(program)} program. We'll send your first check-in form in 7 days. Let's crush it! \u{1F4AA}`,
      params: { name: name || 'there', templateParams: [name || 'there', formatProgramName(program)] },
    });

    console.log(`Conversion: ${maskPhone(phone)} → ${program} $${amount}`);
    return res.status(200).json({ success: true, clientId: client.id, program });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parseExlyPayload(body) {
  return {
    phone: body?.phone || body?.customer_phone || body?.mobile,
    name: body?.name || body?.customer_name,
    email: body?.email || body?.customer_email,
    checkout_id: body?.checkout_id || body?.order_id || body?.transaction_id,
    amount: body?.amount || body?.total_amount,
    product_name: body?.product_name || body?.item_name,
    product_id: body?.product_id || body?.item_id,
  };
}

function detectProgram(productName, productId, leadInterest) {
  if (leadInterest) return leadInterest;
  const name = (productName || '').toLowerCase();
  if (name.includes('pcos')) return 'pcos';
  if (name.includes('40')) return '40plus';
  if (name.includes('12') || name.includes('custom') || name.includes('flagship')) return '12wk';
  if (name.includes('trial') || name.includes('zoom')) return 'zoom_trial';
  if (name.includes('home')) return '6wk_home';
  return '6wk_gym';
}

function formatProgramName(program) {
  const names = {
    '6wk_gym': '6-Week Burn & Build',
    '6wk_home': '6-Week Home Program',
    '12wk': '12-Week Flagship',
    'pcos': 'PCOS Warrior',
    '40plus': '40+ Strong',
    'zoom_trial': 'Zoom Trial',
    'zoom_pack': 'Zoom Pack',
  };
  return names[program] || program;
}
