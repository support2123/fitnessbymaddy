import { supa } from './_lib/supabase.js';
import { json, readBody, requireMethod, requireAuth } from './_lib/http.js';
import { generateProgram, riskCheck } from './_lib/claude.js';
import { renderProgramPdf } from './_lib/pdf.js';
import { sendWhatsApp } from './_lib/whatsapp.js';
import { render, TEMPLATES } from './_lib/templates.js';
import { marketFromPhone } from './_lib/market.js';
import { escalate } from './_lib/escalation.js';

export default async function handler(req, res) {
  if (!requireMethod(req, res, 'POST')) return;
  if (!requireAuth(req, res, 'ADMIN_TOKEN')) return;

  try {
    const { client_id, week_no } = await readBody(req);
    if (!client_id || !week_no) return json(res, 400, { error: 'client_id, week_no required' });

    const db = supa();
    const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'clients';

    const { data: client } = await db.from('clients').select('*').eq('id', client_id).maybeSingle();
    if (!client) return json(res, 404, { error: 'client not found' });

    // Load profile + last 2 checkins
    let profile = null;
    try {
      const dl = await db.storage.from(bucket).download(`leads/${client.lead_id}/profile.json`);
      if (dl.data) profile = JSON.parse(await dl.data.text());
    } catch {}

    const { data: checkins } = await db.from('checkins')
      .select('*').eq('client_id', client_id)
      .order('week_no', { ascending: false }).limit(2);

    // Call Claude
    const { market } = marketFromPhone(client.phone);
    const plan = await generateProgram({
      client: { ...client, market },
      profile,
      lastCheckins: checkins || []
    });

    // Safety gate
    const risks = riskCheck(plan);
    if (risks.length) {
      await db.from('programs').upsert({
        client_id, week_no,
        workout_plan: plan.workout_plan || null,
        nutrition_plan: plan.nutrition_plan || null,
        notes: plan.notes || null,
        flagged: true,
        flag_reason: risks.join('; ')
      }, { onConflict: 'client_id,week_no' });

      await escalate({
        phone: client.phone,
        clientId: client.id,
        reason: 'program_flagged',
        context: risks.join('; ')
      });
      return json(res, 202, { ok: true, flagged: true, reasons: risks });
    }

    // Render PDF → Supabase Storage
    const pdf = await renderProgramPdf({ client, weekNo: week_no, plan });
    const path = `clients/${client_id}/week_${week_no}.pdf`;
    const up = await db.storage.from(bucket).upload(path, pdf, {
      contentType: 'application/pdf',
      upsert: true
    });
    if (up.error) throw up.error;

    const { data: signed } = await db.storage.from(bucket).createSignedUrl(path, 60 * 60 * 24 * 14);
    const pdfUrl = signed?.signedUrl || `${process.env.SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;

    // Persist program
    await db.from('programs').upsert({
      client_id, week_no,
      pdf_url: pdfUrl,
      workout_plan: plan.workout_plan,
      nutrition_plan: plan.nutrition_plan,
      notes: plan.notes,
      generated_at: new Date().toISOString()
    }, { onConflict: 'client_id,week_no' });

    // Deliver over WhatsApp
    if (process.env.AUTO_SEND_PROGRAM !== 'false') {
      const { lang } = marketFromPhone(client.phone);
      const body = render('program_ready', lang, {
        name: client.name || 'there',
        week: week_no,
        note: (plan.notes || '').split('.').slice(0, 1).join('.') || '',
        url: pdfUrl
      });
      await sendWhatsApp({
        to: client.phone,
        templateName: TEMPLATES.program_ready.name,
        body,
        params: [client.name || 'there', String(week_no), pdfUrl],
        bypassRateLimit: true
      });
      await db.from('programs').update({
        whatsapp_sent_at: new Date().toISOString()
      }).eq('client_id', client_id).eq('week_no', week_no);
    }

    return json(res, 200, { ok: true, pdf_url: pdfUrl });
  } catch (e) {
    console.error('generate-program error', e.message);
    return json(res, 500, { error: 'internal', message: e.message });
  }
}
