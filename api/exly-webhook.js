const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { getProgramWeeks, PROGRAM_NAMES } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = req.headers['x-exly-secret'] || req.query.secret;
  if (secret !== process.env.EXLY_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Invalid webhook secret' });
  }

  try {
    const {
      checkout_id, phone, email, name, amount,
      product_name, lead_id
    } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone is required' });

    let program = mapExlyProduct(product_name);

    let resolvedLeadId = lead_id;
    if (!resolvedLeadId) {
      const { data: lead } = await supabase
        .from('leads')
        .select('id, program_interest')
        .eq('phone', phone)
        .order('created_at', { ascending: false })
        .limit(1);

      if (lead && lead.length > 0) {
        resolvedLeadId = lead[0].id;
        if (!program) program = lead[0].program_interest || '6wk_gym';
      }
    }

    if (resolvedLeadId) {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', resolvedLeadId);
    }

    const weeks = getProgramWeeks(program);
    const now = new Date();
    const endsAt = new Date(now.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);

    const { data: client, error } = await supabase
      .from('clients')
      .insert({
        lead_id: resolvedLeadId,
        phone,
        name: name || null,
        email: email || null,
        program: program || '6wk_gym',
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: amount ? parseInt(amount, 10) : 0,
        checkout_id: checkout_id || null,
        folder_url: null,
        status: 'active'
      })
      .select()
      .single();

    if (error) throw error;

    const folderPath = `clients/${client.id}`;
    await supabase.storage.from('programs').upload(
      `${folderPath}/.keep`,
      new Uint8Array(0),
      { contentType: 'text/plain', upsert: true }
    );

    await supabase
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    const templateName = `onboard_${program}`;
    await sendTemplate(phone, templateName, [
      name || 'there',
      PROGRAM_NAMES[program] || program
    ]);

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-key': process.env.INTERNAL_API_KEY
          },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week-1 generation trigger failed:', genErr.message);
      }
    }

    return res.status(200).json({ success: true, client_id: client.id });

  } catch (err) {
    console.error('exly-webhook error:', err.message);
    return res.status(500).json({ error: 'Failed to process purchase' });
  }
};

function mapExlyProduct(productName) {
  if (!productName) return null;
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('trial') || lower.includes('zoom trial')) return 'zoom_trial';
  if (lower.includes('zoom pack') || lower.includes('session pack')) return 'zoom_pack';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('shred') || lower.includes('burn') || lower.includes('6')) return '6wk_gym';
  return null;
}
