const { getSupabase } = require('./_lib/supabase');
const { needsEscalation } = require('./_lib/escalation');
const { notifyMaddy } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const {
      lead_id, name, email, age, phone,
      goal, injuries, diet_pref, schedule,
      medical_conditions, current_weight, height
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    let lead;
    if (lead_id) {
      const { data } = await db.from('leads').select('*').eq('id', lead_id).single();
      lead = data;
    } else if (phone) {
      const { data } = await db.from('leads').select('*').eq('phone', phone).single();
      lead = data;
    }

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    if (name) {
      await db.from('leads').update({ name }).eq('id', lead.id);
    }

    const intakeData = {
      name: name || lead.name,
      email,
      age: age ? parseInt(age) : null,
      goal,
      injuries: injuries || null,
      diet_pref: diet_pref || null,
      schedule: schedule || null,
      medical_conditions: medical_conditions || null,
      current_weight: current_weight || null,
      height: height || null,
      submitted_at: new Date().toISOString()
    };

    await db.from('leads').update({
      name: intakeData.name,
      intake_data: intakeData
    }).eq('id', lead.id);

    const allText = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    if (needsEscalation(allText)) {
      await notifyMaddy(
        'Intake form - medical flag',
        `Lead: ${maskPhone(lead.phone)}\nName: ${name}\nIssue: ${allText.slice(0, 300)}`
      );
    }

    return res.status(200).json({ success: true, lead_id: lead.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
