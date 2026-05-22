import Anthropic from '@anthropic-ai/sdk';
import { jsPDF } from 'jspdf';
import supabase from '../lib/supabase.js';
import { sendMediaMessage, notifyMaddy } from '../lib/whatsapp.js';

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 calories', 'extreme deficit',
  'clenbuterol', 'dnp', 'ephedrine', 'steroid',
  'lose 10kg in 1 week', 'lose 20 pounds in a week'
];

function checkSafetyViolations(text) {
  const lower = text.toLowerCase();
  return SAFETY_FLAGS.filter(flag => lower.includes(flag));
}

async function generateWithClaude(client, checkins) {
  const lastCheckin = checkins[0] || {};
  const prevCheckin = checkins[1] || {};

  const prompt = `You are a NASM-certified fitness coach creating a weekly program for a client.

CLIENT PROFILE:
- Name: ${client.name}
- Program: ${client.program}
- Week: ${lastCheckin.week_no ? lastCheckin.week_no + 1 : 1}

LATEST CHECK-IN (Week ${lastCheckin.week_no || 'N/A'}):
- Weight: ${lastCheckin.weight || 'N/A'} kg
- Waist: ${lastCheckin.waist || 'N/A'} cm
- Compliance: ${lastCheckin.compliance_score || 'N/A'}/10
- Energy: ${lastCheckin.energy || 'N/A'}/10
- Issues: ${lastCheckin.issues || 'None reported'}

PREVIOUS CHECK-IN (Week ${prevCheckin.week_no || 'N/A'}):
- Weight: ${prevCheckin.weight || 'N/A'} kg
- Waist: ${prevCheckin.waist || 'N/A'} cm
- Compliance: ${prevCheckin.compliance_score || 'N/A'}/10

Generate a JSON response with:
1. "workout_plan": 5-6 day split with exercises, sets, reps, rest periods
2. "nutrition_plan": daily calories, macros (protein/carbs/fats), meal timing, sample meals
3. "notes": 2-3 sentence coaching note for the client (warm, motivating)
4. "next_week_focus": one key focus area

Rules:
- Calories must be reasonable (minimum 1200 for women, 1500 for men)
- No banned substances or supplements
- Progressive overload from previous week if available
- Adjust based on compliance and energy scores

Respond ONLY with valid JSON.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content[0].text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Failed to parse Claude response as JSON');

  return JSON.parse(jsonMatch[0]);
}

function buildPdf(client, weekNo, plan) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFillColor(44, 44, 44);
  doc.rect(0, 0, pageWidth, 45, 'F');

  doc.setTextColor(184, 150, 90);
  doc.setFontSize(10);
  doc.text('FITNESS BY MADDY', 20, 18);

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(22);
  doc.text(`WEEK ${weekNo} PROGRAM`, 20, 35);

  doc.setTextColor(184, 150, 90);
  doc.setFontSize(10);
  doc.text(`${client.name || 'Client'} | ${new Date().toLocaleDateString('en-GB')}`, pageWidth - 20, 35, { align: 'right' });

  let y = 60;

  doc.setTextColor(44, 44, 44);
  doc.setFontSize(14);
  doc.text('WORKOUT PLAN', 20, y);
  y += 10;

  doc.setFontSize(9);
  doc.setTextColor(107, 107, 107);

  if (plan.workout_plan) {
    const workout = typeof plan.workout_plan === 'string'
      ? plan.workout_plan
      : JSON.stringify(plan.workout_plan, null, 2);

    const lines = doc.splitTextToSize(workout, pageWidth - 40);
    for (const line of lines) {
      if (y > 270) { doc.addPage(); y = 20; }
      doc.text(line, 20, y);
      y += 5;
    }
  }

  y += 10;
  if (y > 250) { doc.addPage(); y = 20; }

  doc.setTextColor(44, 44, 44);
  doc.setFontSize(14);
  doc.text('NUTRITION PLAN', 20, y);
  y += 10;

  doc.setFontSize(9);
  doc.setTextColor(107, 107, 107);

  if (plan.nutrition_plan) {
    const nutrition = typeof plan.nutrition_plan === 'string'
      ? plan.nutrition_plan
      : JSON.stringify(plan.nutrition_plan, null, 2);

    const lines = doc.splitTextToSize(nutrition, pageWidth - 40);
    for (const line of lines) {
      if (y > 270) { doc.addPage(); y = 20; }
      doc.text(line, 20, y);
      y += 5;
    }
  }

  if (plan.notes) {
    y += 10;
    if (y > 250) { doc.addPage(); y = 20; }
    doc.setTextColor(184, 150, 90);
    doc.setFontSize(11);
    doc.text('COACH\'S NOTE', 20, y);
    y += 8;
    doc.setTextColor(44, 44, 44);
    doc.setFontSize(10);
    const noteLines = doc.splitTextToSize(plan.notes, pageWidth - 40);
    for (const line of noteLines) {
      doc.text(line, 20, y);
      y += 6;
    }
  }

  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFillColor(44, 44, 44);
    doc.rect(0, doc.internal.pageSize.getHeight() - 15, pageWidth, 15, 'F');
    doc.setTextColor(107, 107, 107);
    doc.setFontSize(8);
    doc.text('fitnessbymaddy.com', 20, doc.internal.pageSize.getHeight() - 5);
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - 20, doc.internal.pageSize.getHeight() - 5, { align: 'right' });
  }

  return Buffer.from(doc.output('arraybuffer'));
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const plan = await generateWithClaude(client, checkins || []);

    const fullText = JSON.stringify(plan);
    const violations = checkSafetyViolations(fullText);
    if (violations.length > 0) {
      await notifyMaddy(
        'Safety flag in generated program',
        `Client: ${client.name}\nWeek: ${week_no}\nFlags: ${violations.join(', ')}\n\nProgram NOT sent — needs manual review.`
      );
      return res.status(200).json({
        success: false,
        reason: 'safety_flagged',
        violations
      });
    }

    const pdfBuffer = buildPdf(client, week_no, plan);
    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;

    const { error: uploadError } = await supabase.storage
      .from('clients')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage
      .from('clients')
      .getPublicUrl(pdfPath);

    const pdfUrl = urlData.publicUrl;

    const { error: dbError } = await supabase
      .from('programs')
      .upsert({
        client_id,
        week_no: parseInt(week_no),
        generated_at: new Date().toISOString(),
        pdf_url: pdfUrl,
        workout_plan: plan.workout_plan,
        nutrition_plan: plan.nutrition_plan,
        notes: plan.notes
      }, { onConflict: 'client_id,week_no' });

    if (dbError) throw dbError;

    const contextNote = plan.notes || `Your Week ${week_no} program is ready!`;
    await sendMediaMessage(client.phone, pdfUrl, contextNote);

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no));

    return res.status(200).json({
      success: true,
      program_week: week_no,
      pdf_url: pdfUrl
    });

  } catch (err) {
    console.error('Generate program error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
