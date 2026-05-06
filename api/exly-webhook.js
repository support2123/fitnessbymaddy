const crypto = require('crypto');
const { getSupabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { maskPhone, programWeeks, corsHeaders } = require('./_lib/helpers');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = req.body || {};
    const signature = req.headers['x-exly-signature'];
    const secret = process.env.EXLY_WEBHOOK_SECRET;

    if (secret && signature) {
      const expected = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(body))
        .digest('hex');
      if (signature !== expected) {
        return res.status(401).json({ error: 'invalid_signature' });
      }
    }

    const {
      phone,
      email,
      name,
      checkout_id,
      amount,
      product_name,
    } = body;

    if (!phone) return res.status(400).json({ error: 'missing phone' });

    const supabase = getSupabase();

    const program = mapProduct(product_name);

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    let leadId = lead?.id;

    if (!lead) {
      const { data: newLead } = await supabase
        .from('leads')
        .insert({
          phone,
          name,
          source: 'exly',
          status: 'converted',
          program_interest: program,
        })
        .select()
        .single();
      leadId = newLead.id;
    } else {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', leadId);
    }

    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + programWeeks(program) * 7);

    const folderPath = `clients/${leadId}`;

    const { data: client, error } = await supabase
      .from('clients')
      .insert({
        lead_id: leadId,
        phone,
        name: name || lead?.name,
        email,
        program,
        program_started_at: startDate.toISOString(),
        program_ends_at: endDate.toISOString(),
        paid_amount: amount ? parseInt(amount) : null,
        checkout_id,
        folder_url: folderPath,
        status: 'active',
      })
      .select()
      .single();

    if (error) {
      console.error('[EXLY] Client insert failed:', error.message);
      return res.status(500).json({ error: 'client_insert_failed' });
    }

    await sendTemplate(phone, `onboard_${program}`, [
      name || 'there',
      program,
    ]);

    if (program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (err) {
        console.error('[EXLY] Week-1 generation trigger failed:', err.message);
      }
    }

    console.log(`[CONVERSION] ${maskPhone(phone)} → ${program}`);
    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('[EXLY ERROR]', err.message);
    return res.status(500).json({ error: 'internal_error' });
  }
};

function mapProduct(productName) {
  if (!productName) return '6wk_gym';
  const p = productName.toLowerCase();
  if (p.includes('12') || p.includes('custom') || p.includes('flagship')) return '12wk';
  if (p.includes('pcos')) return 'pcos';
  if (p.includes('40') || p.includes('strong')) return '40plus';
  if (p.includes('home')) return '6wk_home';
  if (p.includes('trial') || p.includes('zoom')) return 'zoom_trial';
  if (p.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}
