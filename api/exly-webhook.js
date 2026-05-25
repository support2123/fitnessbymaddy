const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');

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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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
      customer_phone,
      customer_name,
      customer_email,
      product_name,
      amount,
      checkout_id,
      status,
    } = req.body;

    if (status !== 'completed' && status !== 'success') {
      return res.status(200).json({ action: 'ignored', reason: 'not completed' });
    }

    if (!customer_phone) {
      return res.status(400).json({ error: 'No customer phone' });
    }

    const db = getSupabase();

    const program = mapProductToProgram(product_name);

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', customer_phone)
      .single();

    if (lead) {
      await db
        .from('leads')
        .update({ status: 'converted', program_interest: program })
        .eq('id', lead.id);
    } else {
      const { data: newLead } = await db
        .from('leads')
        .insert({
          phone: customer_phone,
          name: customer_name,
          source: 'exly_direct',
          status: 'converted',
          program_interest: program,
        })
        .select()
        .single();
    }

    const { data: updatedLead } = await db
      .from('leads')
      .select('id')
      .eq('phone', customer_phone)
      .single();

    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const endsAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('phone', customer_phone)
      .eq('status', 'active')
      .single();

    let clientId;

    if (existingClient) {
      await db
        .from('clients')
        .update({
          program,
          paid_amount: amount ? parseInt(amount) : null,
          checkout_id,
          program_started_at: new Date().toISOString(),
          program_ends_at: endsAt,
        })
        .eq('id', existingClient.id);
      clientId = existingClient.id;
    } else {
      const { data: client } = await db
        .from('clients')
        .insert({
          lead_id: updatedLead.id,
          phone: customer_phone,
          name: customer_name,
          email: customer_email,
          program,
          paid_amount: amount ? parseInt(amount) : null,
          checkout_id,
          program_ends_at: endsAt,
          status: 'active',
        })
        .select()
        .single();
      clientId = client.id;
    }

    const folderPath = `clients/${clientId}`;
    await db.storage.from('programs').upload(`${folderPath}/.keep`, new Blob(['']));

    await db
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', clientId);

    const templateName = `onboard_${program}`;
    await sendTemplate(customer_phone, templateName, [customer_name || 'Champion']);

    if (program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.INTERNAL_API_KEY}`,
          },
          body: JSON.stringify({ client_id: clientId, week_no: 1 }),
        });
      } catch (genErr) {
        console.error('Week 1 program generation error:', genErr.message);
      }
    }

    return res.status(200).json({ action: 'converted', client_id: clientId, program });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapProductToProgram(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos') || lower.includes('warrior')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  if (lower.includes('zoom') || lower.includes('trial')) return 'zoom_trial';
  return '6wk_gym';
}
