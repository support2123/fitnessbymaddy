const { supabase } = require('./lib/supabase');
const { parseBody, corsHeaders, json, normalizePhone } = require('./lib/helpers');
const { needsEscalation, escalateToMaddy } = require('./lib/escalation');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true });
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });

  try {
    const body = await parseBody(req);
    const {
      lead_id, name, email, phone: rawPhone, age, gender,
      goal, injuries, diet_pref, schedule, experience,
      medical_conditions, current_weight, height
    } = body;

    if (!lead_id && !rawPhone) {
      return json(res, 400, { error: 'lead_id or phone required' });
    }

    const allText = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    if (needsEscalation(allText)) {
      await escalateToMaddy('Intake form flagged — medical/injury concern', {
        phone: rawPhone,
        name,
        details: allText.slice(0, 300)
      });
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
      const phone = normalizePhone(rawPhone);
      const { data } = await supabase
        .from('leads')
        .select('*')
        .eq('phone', phone)
        .single();
      lead = data;
    }

    if (!lead) {
      return json(res, 404, { error: 'Lead not found' });
    }

    const intakeData = {
      name: name || lead.name,
      email,
      age: age ? parseInt(age) : null,
      gender,
      goal,
      injuries: injuries || null,
      diet_pref: diet_pref || null,
      schedule: schedule || null,
      experience: experience || null,
      medical_conditions: medical_conditions || null,
      current_weight: current_weight ? parseFloat(current_weight) : null,
      height: height ? parseFloat(height) : null
    };

    await supabase.from('leads').update({
      name: intakeData.name,
      status: lead.status === 'new' ? 'qualified' : lead.status
    }).eq('id', lead.id);

    const { data: client, error: clientError } = await supabase.from('clients').upsert({
      lead_id: lead.id,
      phone: lead.phone,
      name: intakeData.name,
      email: intakeData.email,
      status: 'active'
    }, { onConflict: 'lead_id' }).select().single();

    return json(res, 200, {
      ok: true,
      lead_id: lead.id,
      client_id: client?.id,
      message: 'Intake form submitted successfully'
    });

  } catch (err) {
    console.error('Intake error:', err.message);
    return json(res, 500, { error: 'Internal error' });
  }
};
