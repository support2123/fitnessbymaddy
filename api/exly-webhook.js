const crypto = require('crypto');
const supabase = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');

const PROGRAM_MAP = {
  '6_week_shred': '6wk_gym',
  '6_week_home': '6wk_home',
  '12_week_custom': '12wk',
  'pcos_warrior': 'pcos',
  '40_plus_strong': '40plus',
  'zoom_trial': 'zoom_trial',
  'zoom_pack': 'zoom_pack'
};

function verifySignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true; // Skip verification if no secret configured
  const expected = crypto.createHmac('sha256', secret)
    .update(typeof body === 'string' ? body : JSON.stringify(body))
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature || ''),
    Buffer.from(expected)
  );
}

function calculateEndDate(program, startDate) {
  const start = new Date(startDate);
  const weeks = program.startsWith('12wk') ? 12 :
                program.startsWith('6wk') ? 6 :
                program === 'zoom_trial' ? 1 :
                program === 'zoom_pack' ? 4 : 8;
  start.setDate(start.getDate() + (weeks * 7));
  return start.toISOString();
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

    if (process.env.EXLY_WEBHOOK_SECRET && !verifySignature(rawBody, signature)) {
      console.error('Invalid Exly webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const {
      customer_phone, customer_name, customer_email,
      product_name, amount, checkout_id, lead_id
    } = body;

    if (!customer_phone) {
      return res.status(400).json({ error: 'Missing customer_phone' });
    }

    const normalizedPhone = customer_phone.startsWith('+') ? customer_phone : '+' + customer_phone;
    const program = PROGRAM_MAP[product_name] || product_name || '6wk_gym';
    const now = new Date().toISOString();

    console.log(`Purchase: ${maskPhone(normalizedPhone)} → ${program} ($${amount || 0})`);

    // Find or create lead
    let leadId = lead_id;
    if (!leadId) {
      const { data: lead } = await supabase
        .from('leads')
        .select('id')
        .eq('phone', normalizedPhone)
        .limit(1)
        .single();
      leadId = lead?.id;
    }

    // Update lead status
    if (leadId) {
      await supabase.from('leads')
        .update({ status: 'converted', last_msg_at: now })
        .eq('id', leadId);
    }

    // Create client record
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .insert({
        lead_id: leadId,
        phone: normalizedPhone,
        name: customer_name,
        email: customer_email,
        program,
        program_started_at: now,
        program_ends_at: calculateEndDate(program, now),
        paid_amount: amount ? Math.round(amount * 100) : 0,
        checkout_id,
        status: 'active'
      })
      .select()
      .single();

    if (clientError) {
      console.error('Client creation error:', clientError);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    // Create storage folder
    await supabase.storage
      .from('clients')
      .upload(`${client.id}/.keep`, Buffer.from(''), {
        contentType: 'text/plain',
        upsert: true
      });

    // Send onboarding WhatsApp
    await sendTemplate(
      normalizedPhone,
      `onboard_${program}`,
      [customer_name || 'there'],
      customer_name
    );

    // For 12-week program: trigger immediate Week 1 generation
    if (program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week 1 generation failed:', genErr.message);
      }
    }

    return res.status(200).json({ ok: true, client_id: client.id });

  } catch (err) {
    console.error('Exly webhook error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
