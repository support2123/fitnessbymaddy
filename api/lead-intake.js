import supabase from './_lib/supabase.js';
import { needsEscalation, escalateToMaddy } from './_lib/escalation.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, age, gender, height, weight,
      goal, injuries, medical_conditions, diet_preference,
      schedule, experience_level, phone,
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'Missing lead_id or phone' });
    }

    let lead;
    if (lead_id) {
      const { data } = await supabase
        .from('leads')
        .select('*')
        .eq('id', lead_id)
        .single();
      lead = data;
    } else {
      const { data } = await supabase
        .from('leads')
        .select('*')
        .eq('phone', phone)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      lead = data;
    }

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const medicalInfo = [injuries, medical_conditions].filter(Boolean).join('; ');
    if (medicalInfo && needsEscalation(medicalInfo)) {
      await escalateToMaddy('Medical flag on intake form', lead.phone, medicalInfo);
    }

    await supabase
      .from('leads')
      .update({
        name: name || lead.name,
        status: 'qualified',
        last_msg_at: new Date().toISOString(),
      })
      .eq('id', lead.id);

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('lead_id', lead.id)
      .maybeSingle();

    const intakeData = {
      age: parseInt(age) || null,
      gender,
      height,
      weight: parseFloat(weight) || null,
      goal,
      injuries: injuries || null,
      medical_conditions: medical_conditions || null,
      diet_preference: diet_preference || null,
      schedule: schedule || null,
      experience_level: experience_level || null,
    };

    if (existingClient) {
      await supabase
        .from('clients')
        .update({ name: name || undefined, email: email || undefined, intake_data: intakeData })
        .eq('id', existingClient.id);
    } else {
      await supabase.from('clients').insert({
        lead_id: lead.id,
        phone: lead.phone,
        name: name || lead.name,
        email: email || null,
        program: lead.program_interest,
        status: 'pending',
        intake_data: intakeData,
      });
    }

    return res.status(200).json({ success: true, message: 'Intake received' });
  } catch (err) {
    console.error(`Intake error: ${err.message}`);
    return res.status(500).json({ error: 'Internal error' });
  }
}
