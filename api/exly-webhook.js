const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { getProgramEndDate, isHinglishMarket, detectMarket } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret) {
      const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
      if (sig) {
        const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
        if (sig !== expected) {
          return res.status(401).json({ error: 'Invalid signature' });
        }
      }
    }

    const { email, phone, name, amount, checkout_id, product_name } = parseExlyPayload(req.body);
    if (!phone) return res.status(400).json({ error: 'Missing phone in payload' });

    const db = getSupabase();
    const program = mapProductToProgram(product_name, amount);

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const now = new Date();
    const programEnds = getProgramEndDate(now, program);

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('program', program)
      .single();

    let clientId;

    if (existingClient) {
      await db.from('clients').update({
        paid_amount: amount,
        checkout_id,
        program_started_at: now.toISOString(),
        program_ends_at: programEnds,
        status: 'active',
      }).eq('id', existingClient.id);
      clientId = existingClient.id;
    } else {
      const { data: newClient, error } = await db
        .from('clients')
        .insert({
          lead_id: lead?.id || null,
          phone,
          name: name || lead?.name,
          email,
          program,
          paid_amount: amount,
          checkout_id,
          program_started_at: now.toISOString(),
          program_ends_at: programEnds,
          folder_url: `/clients/${crypto.randomUUID()}/`,
          status: 'active',
        })
        .select('id')
        .single();

      if (error) throw error;
      clientId = newClient.id;
    }

    const market = detectMarket(phone);
    const hinglish = isHinglishMarket(market);
    const welcomeBody = hinglish
      ? `Welcome to the family! Tumhara ${program.replace(/_/g, ' ')} program start ho gaya hai. Intake form zaroor fill karo: https://fitnessbymaddy.com/intake?lead=${lead?.id || clientId}`
      : `Welcome to the family! Your ${program.replace(/_/g, ' ')} program has started. Please fill out your intake form: https://fitnessbymaddy.com/intake?lead=${lead?.id || clientId}`;

    await sendWhatsApp({
      phone,
      templateName: `onboard_${program}`,
      body: welcomeBody,
      params: [name || 'there'],
    });

    if (program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
          },
          body: JSON.stringify({ client_id: clientId, week_no: 1 }),
        });
      } catch (e) {
        console.error('Week 1 program generation failed:', e.message);
      }
    }

    return res.json({ success: true, client_id: clientId, program });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Failed to process payment' });
  }
};

function parseExlyPayload(body) {
  return {
    email: body.email || body.customer_email,
    phone: body.phone || body.customer_phone || body.mobile,
    name: body.name || body.customer_name,
    amount: body.amount || body.paid_amount || body.total,
    checkout_id: body.checkout_id || body.order_id || body.id,
    product_name: body.product_name || body.listing_name || body.product || '',
  };
}

function mapProductToProgram(productName, amount) {
  if (!productName) {
    if (amount <= 25) return 'zoom_trial';
    if (amount <= 50) return 'pcos';
    if (amount <= 100) return '6wk_gym';
    return '12wk';
  }
  const lower = productName.toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  if (lower.includes('zoom') || lower.includes('trial')) return 'zoom_trial';
  return '6wk_gym';
}
