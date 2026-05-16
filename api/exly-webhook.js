const { supabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
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

    const { phone, email, name, amount, checkout_id, product_name } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'phone required' });
    }

    const program = mapProductToProgram(product_name || '');
    const programWeeks = { '6wk_gym': 6, '6wk_home': 6, '12wk': 12, 'pcos': 6, '40plus': 8, 'zoom_trial': 1, 'zoom_pack': 4 };
    const weeks = programWeeks[program] || 6;
    const endsAt = new Date();
    endsAt.setDate(endsAt.getDate() + weeks * 7);

    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .limit(1);

    const leadId = lead && lead.length > 0 ? lead[0].id : null;

    if (leadId) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', leadId);
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('program', program)
      .limit(1);

    let clientId;
    if (existingClient && existingClient.length > 0) {
      clientId = existingClient[0].id;
      await supabase.from('clients').update({
        status: 'active',
        paid_amount: amount ? parseInt(amount) : null,
        checkout_id,
        program_started_at: new Date().toISOString(),
        program_ends_at: endsAt.toISOString()
      }).eq('id', clientId);
    } else {
      const { data: newClient } = await supabase.from('clients').insert({
        lead_id: leadId,
        phone, name, email, program,
        paid_amount: amount ? parseInt(amount) : null,
        checkout_id,
        status: 'active',
        program_started_at: new Date().toISOString(),
        program_ends_at: endsAt.toISOString()
      }).select('id').single();
      clientId = newClient.id;
    }

    const folderPath = `clients/${clientId}`;
    await supabase.from('clients').update({ folder_url: folderPath }).eq('id', clientId);

    const ONBOARD_MESSAGES = {
      '12wk': '🎉 Welcome to the 12-Week Custom Flagship! Your personalised plan starts now. Week 1 program coming in 24 hours. Fill your intake form if you haven\'t already!',
      '6wk_gym': '🔥 Welcome to 6-Week Burn & Build! Your program starts NOW. Check your email for full plan details. First check-in is in 7 days!',
      'pcos': '💪 Welcome to the PCOS Warrior Program! Designed specifically for hormonal balance + sustainable fat loss. Details in your email!',
      '40plus': '✨ Welcome to 40+ Strong! Age-adapted training for real results. Check your email for your complete program!',
      'zoom_trial': '📹 Your Zoom Trial is confirmed! You\'ll receive a scheduling link within 24 hours. Get ready!'
    };

    const msg = ONBOARD_MESSAGES[program] || ONBOARD_MESSAGES['6wk_gym'];
    await sendWhatsApp({ phone, body: msg, templateName: `onboard_${program}` });

    return res.status(200).json({ success: true, client_id: clientId });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapProductToProgram(productName) {
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos') || lower.includes('hormonal')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}
