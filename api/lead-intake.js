const { supabase } = require('./_lib/supabase');
const { maskPhone } = require('./_lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, phone, age, gender, height, weight,
      goal, injuries, diet_pref, schedule, medical_conditions,
      experience_level, equipment_access
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    let lead;
    if (lead_id) {
      const { data } = await supabase.from('leads').select('*').eq('id', lead_id).single();
      lead = data;
    } else {
      const { data } = await supabase.from('leads').select('*').eq('phone', phone).single();
      lead = data;
    }

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const needsEscalation = [injuries, medical_conditions].some(
      field => field && /\b(injury|surgery|pregnant|pregnancy|medication|heart|diabetes|epilepsy)\b/i.test(field)
    );

    if (needsEscalation) {
      await supabase.from('escalations').insert({
        phone: lead.phone,
        reason: 'medical_intake',
        message_body: `Injuries: ${injuries || 'none'}, Medical: ${medical_conditions || 'none'}`
      });
    }

    await supabase.from('leads').update({
      name: name || lead.name
    }).eq('id', lead.id);

    const intakeData = {
      age, gender, height, weight, goal, injuries,
      diet_pref, schedule, medical_conditions,
      experience_level, equipment_access, email,
      submitted_at: new Date().toISOString()
    };

    const folderPath = `intakes/${lead.id}.json`;
    await supabase.storage
      .from('clients')
      .upload(folderPath, JSON.stringify(intakeData, null, 2), {
        contentType: 'application/json',
        upsert: true
      });

    console.log(`[Intake] Submitted for ${maskPhone(lead.phone)}`);
    return res.json({ status: 'ok', escalated: needsEscalation });
  } catch (err) {
    console.error('[Intake Error]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
