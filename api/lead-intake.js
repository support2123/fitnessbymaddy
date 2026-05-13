const { getSupabase } = require('./lib/supabase');
const { sendTemplate } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_pref, schedule,
      current_weight, height, activity_level
    } = req.body;

    if (!lead_id) {
      return res.status(400).json({ error: 'Missing lead_id' });
    }

    const supabase = getSupabase();

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    if (name) {
      await supabase.from('leads').update({ name }).eq('id', lead_id);
    }

    const intakeData = {
      age: parseInt(age) || null,
      gender,
      goal,
      injuries: injuries || null,
      diet_pref: diet_pref || null,
      schedule: schedule || null,
      current_weight: parseFloat(current_weight) || null,
      height: parseFloat(height) || null,
      activity_level: activity_level || null,
      email: email || null,
      submitted_at: new Date().toISOString()
    };

    await supabase.from('leads').update({
      name: name || lead.name,
      last_msg_at: new Date().toISOString()
    }).eq('id', lead_id);

    const leadPhone = phone || lead.phone;
    if (leadPhone) {
      await sendTemplate(leadPhone, 'intake_received', {
        name: name || lead.name || 'there',
        templateParams: [name || lead.name || 'there']
      });
    }

    return res.status(200).json({ ok: true, message: 'Intake form submitted' });

  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
