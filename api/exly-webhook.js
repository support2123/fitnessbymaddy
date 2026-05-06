const crypto = require('crypto');
const supabase = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { maskPhone, programWeekCount, PROGRAM_NAMES } = require('../lib/helpers');
const { escalateToMaddy } = require('../lib/escalation');

function verifySignature(payload, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && !verifySignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const { phone, name, email, checkout_id, amount, product_name } = req.body;

    if (!phone || !checkout_id) {
      return res.status(400).json({ error: 'Missing phone or checkout_id' });
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('checkout_id', checkout_id)
      .single();

    if (existingClient) {
      return res.status(200).json({ action: 'already_processed' });
    }

    let program = detectProgramFromProduct(product_name);
    let lead = null;

    const { data: leadData } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (leadData) {
      lead = leadData;
      if (!program && leadData.program_interest) {
        program = leadData.program_interest;
      }
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const weeks = programWeekCount(program);
    const endsAt = new Date();
    endsAt.setDate(endsAt.getDate() + weeks * 7);

    const folderPath = `clients/${phone.replace(/[^0-9]/g, '')}`;

    const { data: client, error } = await supabase
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone,
        name: name || lead?.name,
        email,
        program: program || '6wk_gym',
        program_started_at: new Date().toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: amount || 0,
        checkout_id,
        folder_url: folderPath,
        status: 'active'
      })
      .select()
      .single();

    if (error) {
      console.error('[Exly] Client insert error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const templateName = `onboard_${program || 'general'}`;
    await sendTemplate(phone, templateName, [
      name || lead?.name || 'there',
      PROGRAM_NAMES[program] || 'your program'
    ]);

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
          },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('[Exly] Week-1 program generation failed:', genErr.message);
      }
    }

    console.log(`[Exly] Conversion: ${maskPhone(phone)} → ${program} ($${amount})`);
    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('[Exly] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function detectProgramFromProduct(productName) {
  if (!productName) return null;
  const lower = productName.toLowerCase();
  if (lower.includes('12') && lower.includes('week')) return '12wk';
  if (lower.includes('shred') || lower.includes('6 week') || lower.includes('burn')) return '6wk_gym';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('home')) return '6wk_home';
  return null;
}
