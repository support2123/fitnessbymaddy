const supabase = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { isHinglishMarket } = require('./_lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { lead_id, name, email, phone, age, goal, injuries, diet_pref, schedule, experience } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id is required' });

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const updates = {};
    if (name) updates.name = name;

    await supabase.from('leads').update(updates).eq('id', lead_id);

    const intakeData = {
      lead_id,
      name: name || lead.name,
      email,
      phone: phone || lead.phone,
      age: age ? parseInt(age) : null,
      goal,
      injuries,
      diet_pref,
      schedule,
      experience
    };

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .single();

    if (existingClient) {
      await supabase.from('clients').update({
        name: intakeData.name,
        email: intakeData.email,
        age: intakeData.age,
        goal: intakeData.goal,
        injuries: intakeData.injuries,
        diet_pref: intakeData.diet_pref,
        schedule: intakeData.schedule
      }).eq('id', existingClient.id);
    }

    const market = lead.market || 'GLOBAL';
    const confirmation = isHinglishMarket(market)
      ? 'Intake form mil gaya! Ab payment complete karo aur hum shuru karte hain.'
      : 'Got your intake form! Complete your payment and we\'ll get started right away.';

    await sendWhatsApp(lead.phone, confirmation, null, true);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
