const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, detectMarket } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, gender, height, weight,
      goal, injuries, diet_preference, schedule, medical_conditions,
      current_activity, supplements
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'Missing lead_id or phone' });
    }

    const db = getSupabase();

    let lead;
    if (lead_id) {
      const { data } = await db.from('leads').select('*').eq('id', lead_id).single();
      lead = data;
    } else {
      const { data } = await db.from('leads').select('*').eq('phone', phone).single();
      lead = data;
    }

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await db.from('leads').update({
      name: name || lead.name,
      last_msg_at: new Date().toISOString()
    }).eq('id', lead.id);

    const intakeData = {
      age, gender, height, weight, goal, injuries,
      diet_preference, schedule, medical_conditions,
      current_activity, supplements, email
    };

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('lead_id', lead.id)
      .single();

    if (existingClient) {
      await db.from('clients').update({
        name: name || lead.name,
        email
      }).eq('id', existingClient.id);
    }

    if (medical_conditions && medical_conditions.trim()) {
      const { escalateToMaddy } = require('../lib/escalation');
      await escalateToMaddy({
        reason: 'Medical condition reported in intake form',
        phone: lead.phone,
        message: `Medical: ${medical_conditions}`,
        clientName: name
      });
    }

    if (injuries && injuries.trim()) {
      const { escalateToMaddy } = require('../lib/escalation');
      await escalateToMaddy({
        reason: 'Injury reported in intake form',
        phone: lead.phone,
        message: `Injuries: ${injuries}`,
        clientName: name
      });
    }

    const market = detectMarket(lead.phone);
    const isHinglish = market === 'IN';
    const confirmMsg = isHinglish
      ? `Thanks ${name || ''}! Aapka intake form mil gaya hai ✅ Maddy ki team jaldi aapka plan ready karegi. Payment complete karna mat bhulna!`
      : `Thanks ${name || ''}! Your intake form has been received ✅ Maddy's team will prepare your plan shortly. Don't forget to complete your payment!`;

    await sendWhatsApp({ phone: lead.phone, body: confirmMsg });

    return res.json({ success: true, lead_id: lead.id });
  } catch (err) {
    console.error('Lead intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
