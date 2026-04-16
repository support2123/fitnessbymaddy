// POST /api/generate-program
// Body: { client_id, week_no }
//
// Pipeline:
//   1. Load client + last 2 check-ins.
//   2. Call Claude with the program-architect system prompt.
//   3. Run local safety filter → flag for Maddy if anything risky.
//   4. Render branded PDF, upload to Supabase Storage.
//   5. Insert programs row, signed URL, send WhatsApp.

import { supabase, STORAGE_BUCKET } from './_lib/supabase.js';
import { sendTemplate } from './_lib/whatsapp.js';
import { generateProgram } from './_lib/claude.js';
import { renderProgramPDF } from './_lib/pdf.js';
import { detectMarket, json, assertCron } from './_lib/utils.js';
import { openEscalation } from './_lib/escalation.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  if (!assertCron(req))       return json(res, 401, { error: 'unauthorized' });

  const { client_id, week_no } = req.body || {};
  if (!client_id || !week_no) return json(res, 400, { error: 'missing_args' });

  const { data: client, error } = await supabase.from('clients')
    .select('*').eq('id', client_id).single();
  if (error || !client) return json(res, 404, { error: 'client_not_found' });
  if (client.program !== '12wk') {
    return json(res, 200, { ok: true, skipped: 'not_12wk' });
  }
  if (client.status !== 'active') {
    return json(res, 200, { ok: true, skipped: 'client_inactive' });
  }

  // Idempotency: if program already generated for this week, return it.
  const { data: existing } = await supabase.from('programs')
    .select('*').eq('client_id', client.id).eq('week_no', week_no).maybeSingle();
  if (existing && existing.pdf_url && existing.whatsapp_sent_at) {
    return json(res, 200, { ok: true, already: true });
  }

  const { data: checkins } = await supabase.from('checkins')
    .select('*').eq('client_id', client.id).order('week_no', { ascending: false }).limit(2);

  // ── Claude call ────────────────────────────────────────
  let result;
  try {
    result = await generateProgram({ client, lastCheckins: checkins || [], weekNo: week_no });
  } catch (e) {
    console.error('[generate] claude failed', e?.message);
    await openEscalation({
      reason: 'program_gen_failed',
      phone: client.phone, clientId: client.id,
      payload: { week_no, error: e?.message?.slice(0, 300) },
    });
    return json(res, 502, { error: 'claude_failed' });
  }

  if (result.flagged) {
    await supabase.from('programs').upsert({
      client_id: client.id, week_no,
      flagged_for_review: true,
      flag_reason: result.reason,
      notes: 'Claude output failed safety filter; awaiting Maddy review.',
    }, { onConflict: 'client_id,week_no' });
    await openEscalation({
      reason: `program_unsafe:${result.reason}`,
      phone: client.phone, clientId: client.id,
      payload: { week_no, raw: result.raw },
    });
    return json(res, 200, { ok: false, flagged: true, reason: result.reason });
  }

  const plan = result.plan;

  // ── PDF render + storage upload ────────────────────────
  let pdfUrl = null;
  try {
    const pdfBuffer = await renderProgramPDF({ client, weekNo: week_no, plan });
    const path = `clients/${client.id}/week_${week_no}.pdf`;
    await supabase.storage.from(STORAGE_BUCKET).upload(path, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });
    const { data: signed } = await supabase.storage.from(STORAGE_BUCKET)
      .createSignedUrl(path, 60 * 60 * 24 * 30); // 30-day link
    pdfUrl = signed?.signedUrl || null;
  } catch (e) {
    console.error('[generate] pdf/upload failed', e?.message);
  }

  // ── Audit row first (so nothing goes out unlogged) ─────
  await supabase.from('programs').upsert({
    client_id: client.id, week_no,
    workout_plan: plan.workout_plan,
    nutrition_plan: plan.nutrition_plan,
    notes: plan.coach_note || null,
    pdf_url: pdfUrl,
    flagged_for_review: false,
    flag_reason: null,
  }, { onConflict: 'client_id,week_no' });

  if (!pdfUrl) {
    await openEscalation({
      reason: 'pdf_render_failed',
      phone: client.phone, clientId: client.id,
      payload: { week_no },
    });
    return json(res, 500, { error: 'pdf_failed' });
  }

  // ── WhatsApp delivery ──────────────────────────────────
  await sendTemplate({
    phone: client.phone,
    templateName: 'program_ready',
    market: detectMarket(client.phone),
    params: { week: week_no, focus: plan.week_focus || '', pdf: pdfUrl },
    isClient: true, force: true,
  });
  await supabase.from('programs').update({
    whatsapp_sent_at: new Date().toISOString(),
  }).eq('client_id', client.id).eq('week_no', week_no);

  return json(res, 200, { ok: true, pdf_url: pdfUrl });
}
