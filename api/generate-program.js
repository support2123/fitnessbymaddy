const Anthropic = require('@anthropic-ai/sdk');
const { getClient } = require('../lib/supabase');
const { generateProgramPDF } = require('../lib/pdf');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/utils');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 1000 cal', '800 cal', '600 cal',
  'clenbuterol', 'dnp', 'ephedrine', 'sarms', 'steroids',
  'lose 10 kg in 1 week', 'drop 20 pounds in',
  'starvation', 'extreme deficit',
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getClient();

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await db.from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: recentCheckins } = await db.from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: lastProgram } = await db.from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const prompt = buildPrompt(client, recentCheckins || [], lastProgram, week_no);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0].text;
    let parsed;
    try {
      const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content);
    } catch {
      console.error('Failed to parse Claude response');
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    const fullText = JSON.stringify(parsed).toLowerCase();
    const flagged = SAFETY_FLAGS.some(flag => fullText.includes(flag));

    if (flagged) {
      await db.from('programs').insert({
        client_id,
        week_no,
        workout_plan: parsed.workout,
        nutrition_plan: parsed.nutrition,
        notes: parsed.notes,
        flagged: true,
        flag_reason: 'Safety content detected — needs Maddy review',
      });
      await notifyMaddy(
        'Flagged Program',
        `Week ${week_no} for ${maskPhone(client.phone)} flagged for safety review`
      );
      return res.status(200).json({ ok: true, flagged: true });
    }

    const pdfBuffer = await generateProgramPDF(
      client.name || 'Client',
      week_no,
      parsed.workout,
      parsed.nutrition,
      parsed.notes
    );

    const pdfPath = `${client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await db.storage
      .from('clients')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadErr) {
      console.error('PDF upload error:', uploadErr.message);
    }

    const { data: urlData } = db.storage
      .from('clients')
      .getPublicUrl(pdfPath);
    const pdfUrl = urlData?.publicUrl || '';

    const { data: program } = await db.from('programs').insert({
      client_id,
      week_no,
      workout_plan: parsed.workout,
      nutrition_plan: parsed.nutrition,
      notes: parsed.notes,
      pdf_url: pdfUrl,
      flagged: false,
    }).select().single();

    const sendResult = await sendTemplate(
      client.phone,
      'program_delivery',
      [client.name || 'there', `Week ${week_no}`],
      pdfUrl
    );

    if (sendResult.ok) {
      await db.from('programs').update({
        whatsapp_sent_at: new Date().toISOString(),
      }).eq('id', program.id);
    }

    console.log(`Program generated: ${maskPhone(client.phone)} week ${week_no}`);
    return res.status(200).json({ ok: true, program_id: program.id });

  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, checkins, lastProgram, weekNo) {
  const checkinSummary = checkins.map(c =>
    `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
  ).join('\n');

  const lastProgramSummary = lastProgram
    ? `Previous workout: ${JSON.stringify(lastProgram.workout_plan)}\nPrevious nutrition: ${JSON.stringify(lastProgram.nutrition_plan)}`
    : 'No previous program (first week)';

  return `You are a certified fitness coach (NASM CPT, Precision Nutrition L1) creating a weekly training and nutrition program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Age: ${client.age || 'unknown'}
- Goal: ${client.goal || 'general fitness'}
- Injuries/limitations: ${client.injuries || 'none reported'}
- Diet preference: ${client.diet_pref || 'no restrictions'}
- Schedule: ${client.schedule || 'flexible'}
- Week number: ${weekNo} of ${client.program === '12wk' ? 12 : 6}

RECENT CHECK-INS:
${checkinSummary || 'No check-ins yet'}

PREVIOUS PROGRAM:
${lastProgramSummary}

INSTRUCTIONS:
1. Create a progressive program for Week ${weekNo}
2. Adjust based on compliance, energy, and any reported issues
3. If compliance is low, simplify. If energy is low, reduce volume.
4. Be realistic — no extreme calorie deficits, no banned substances
5. Include warm-up and cool-down guidance

Return ONLY valid JSON in this format:
\`\`\`json
{
  "workout": {
    "days": [
      {
        "name": "Day 1 - Upper Body",
        "focus": "Chest & Back emphasis",
        "exercises": [
          { "name": "Bench Press", "sets": "4", "reps": "8-10", "rest": "90s" }
        ]
      }
    ]
  },
  "nutrition": {
    "calories": 2000,
    "macros": { "protein": 150, "carbs": 200, "fats": 67 },
    "meals": [
      {
        "name": "Meal 1 - Breakfast",
        "items": ["4 egg whites + 1 whole egg scramble", "1 cup oats with berries"]
      }
    ]
  },
  "notes": "Focus on progressive overload this week. Increase bench press by 2.5kg if last week felt easy."
}
\`\`\``;
}
