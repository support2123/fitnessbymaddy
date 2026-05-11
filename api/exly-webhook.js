const crypto = require('crypto');
const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, maskPhone } = require('./_lib/whatsapp');
const { PROGRAM_LABELS } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const signature = req.headers['x-exly-signature'];
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
      customer_name,
      customer_email,
      customer_phone,
      product_name,
      amount,
      checkout_id,
      status
    } = req.body;

    if (status !== 'completed' && status !== 'success') {
      return res.status(200).json({ action: 'ignored', reason: 'not a completed payment' });
    }

    const phone = normalizePhone(customer_phone || '');
    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    const db = getSupabase();

    const program = mapProductToProgram(product_name);

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    let leadId = lead?.id;

    if (!lead) {
      const { data: newLead } = await db.from('leads').insert({
        phone,
        name: customer_name,
        source: 'exly',
        status: 'converted',
        program_interest: program,
        market: detectMarketSimple(phone)
      }).select().single();
      leadId = newLead.id;
    } else {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const programDays = program === '12wk' ? 84 : program.startsWith('6wk') ? 42 : 30;
    const endsAt = new Date(Date.now() + programDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: client } = await db.from('clients').insert({
      lead_id: leadId,
      phone,
      name: customer_name,
      email: customer_email,
      program,
      program_started_at: new Date().toISOString(),
      program_ends_at: endsAt,
      paid_amount: Math.round(parseFloat(amount) * 100),
      checkout_id,
      status: 'active'
    }).select().single();

    const folderPath = `clients/${client.id}`;
    await db.storage.from('programs').upload(`${folderPath}/.keep`, new Uint8Array(0), {
      contentType: 'text/plain',
      upsert: true
    });

    await db.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    const programLabel = PROGRAM_LABELS[program] || program;
    await sendTemplate(phone, `onboard_${program}`, {
      name: customer_name || 'there',
      templateParams: [
        customer_name || 'there',
        programLabel,
        `Week 1 check-in in 7 days!`
      ]
    });

    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
          },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week 1 program generation failed:', genErr.message);
      }
    }

    return res.status(200).json({ success: true, client_id: client.id, program });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function normalizePhone(phone) {
  let cleaned = phone.replace(/[^+\d]/g, '');
  if (cleaned && !cleaned.startsWith('+')) cleaned = '+' + cleaned;
  return cleaned;
}

function detectMarketSimple(phone) {
  if (phone.startsWith('+91')) return 'IN';
  if (phone.startsWith('+971')) return 'UAE';
  if (phone.startsWith('+44')) return 'UK';
  return 'GLOBAL';
}

function mapProductToProgram(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}
