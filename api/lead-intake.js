import { supa } from './_lib/supabase.js';
import { normalizePhone } from './_lib/mask.js';
import { json, readBody, requireMethod } from './_lib/http.js';
import { detectRedFlags, escalate } from './_lib/escalation.js';

// Receives the /intake.html form submission.
export default async function handler(req, res) {
  if (!requireMethod(req, res, 'POST')) return;
  const db = supa();

  try {
    const body = await readBody(req);
    const {
      lead_id = null,
      name,
      email,
      phone,
      age,
      goal,
      injuries,
      medical,
      diet_pref,
      schedule,
      notes
    } = body;

    if (!phone || !name) return json(res, 400, { error: 'name and phone required' });

    const normalized = normalizePhone(phone);
    const profile = { age, goal, injuries, medical, diet_pref, schedule, notes };

    // Attach profile to lead (or create lead if none)
    let leadId = lead_id;
    if (leadId) {
      await db.from('leads').update({
        name, program_interest: goal,
        last_msg_at: new Date().toISOString()
      }).eq('id', leadId);
    } else {
      const { data, error } = await db.from('leads').upsert({
        phone: normalized, name, source: 'intake_form',
        status: 'qualified', program_interest: goal,
        last_msg_at: new Date().toISOString()
      }, { onConflict: 'phone' }).select('id').single();
      if (error) throw error;
      leadId = data.id;
    }

    // Store the full profile in a dedicated JSON column on the lead via side-table.
    // We piggyback on leads.first_msg for a compact summary, full payload goes in escalations if risk.
    const risky = detectRedFlags(`${injuries || ''} ${medical || ''} ${notes || ''}`);
    if (risky.length) {
      await escalate({
        phone: normalized,
        leadId,
        reason: risky.join(','),
        context: JSON.stringify(profile).slice(0, 1000)
      });
    }

    // Persist profile JSON in Supabase Storage so the program generator can read it.
    try {
      const key = `leads/${leadId}/profile.json`;
      await db.storage
        .from(process.env.SUPABASE_STORAGE_BUCKET || 'clients')
        .upload(key, Buffer.from(JSON.stringify({ ...profile, name, email, phone: normalized }, null, 2)), {
          contentType: 'application/json',
          upsert: true
        });
    } catch (e) {
      console.error('profile upload failed', e?.message || e);
    }

    return json(res, 200, { ok: true, lead_id: leadId });
  } catch (e) {
    console.error('lead-intake error', e.message);
    return json(res, 500, { error: 'internal' });
  }
}
