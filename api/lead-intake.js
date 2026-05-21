const { getClient } = require('./_lib/supabase');
const { notifyMaddy } = require('./_lib/whatsapp');
const { normalizePhone, maskPhone, needsEscalation, jsonResponse } = require('./_lib/helpers');

module.exports = async function handler(req, res) {
  /* ── CORS preflight ── */
  if (req.method === 'OPTIONS') {
    return jsonResponse(res, 200, { ok: true });
  }

  /* ── Only POST allowed ── */
  if (req.method !== 'POST') {
    return jsonResponse(res, 405, { error: 'Method not allowed' });
  }

  let phone;

  try {
    const {
      lead_id,
      name,
      email,
      phone: rawPhone,
      age,
      goal,
      injuries,
      diet_pref,
      schedule,
      photos
    } = req.body || {};

    phone = normalizePhone(rawPhone || '');
    const db = getClient();

    /* ── 1. If lead_id provided, update leads row with name if missing ── */
    if (lead_id) {
      const { data: lead } = await db
        .from('leads')
        .select('id, name')
        .eq('id', lead_id)
        .limit(1)
        .single();

      if (lead && !lead.name && name) {
        await db
          .from('leads')
          .update({ name })
          .eq('id', lead_id);
      }
    }

    /* ── 2. Upsert clients row ── */
    const intakeData = {
      phone,
      name: name || undefined,
      email: email || undefined,
      age: age || undefined,
      goal: goal || undefined,
      injuries: injuries || undefined,
      diet_pref: diet_pref || undefined,
      schedule: schedule || undefined,
      photos: photos || undefined
    };

    // Remove undefined values so we don't overwrite existing data with null
    Object.keys(intakeData).forEach(k => {
      if (intakeData[k] === undefined) delete intakeData[k];
    });

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (existingClient) {
      /* Update existing client with intake fields */
      await db
        .from('clients')
        .update({
          ...(email && { email }),
          ...(age && { age }),
          ...(goal && { goal }),
          ...(injuries && { injuries }),
          ...(diet_pref && { diet_pref }),
          ...(schedule && { schedule }),
          ...(name && { name })
        })
        .eq('id', existingClient.id);
    } else {
      /* Insert new client — active but no program yet */
      await db
        .from('clients')
        .upsert({
          ...intakeData,
          status: 'active'
        }, { onConflict: 'phone' });
    }

    /* ── 3. Escalation check on goal / injuries ── */
    const escalateGoal = needsEscalation(goal);
    const escalateInjuries = needsEscalation(injuries);

    if (escalateGoal || escalateInjuries) {
      const reasons = [];
      if (escalateGoal) reasons.push(`Goal: ${goal}`);
      if (escalateInjuries) reasons.push(`Injuries: ${injuries}`);

      await notifyMaddy(
        'Intake form needs review',
        `Client: ${name || 'Unknown'}\nPhone: ${maskPhone(phone)}\n${reasons.join('\n')}`
      );
    }

    return jsonResponse(res, 200, { ok: true });
  } catch (err) {
    console.error(`[lead-intake] Error for ${maskPhone(phone || '')}: ${err.message}`);
    return jsonResponse(res, 500, { error: 'Internal server error' });
  }
};
