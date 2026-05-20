const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');

const RISKY_PATTERNS = [
  /under\s*1[0-2]00\s*cal/i,
  /starvation/i,
  /clenbuterol/i,
  /dnp/i,
  /ephedrine/i,
  /steroids?/i,
  /testosterone\s*(injection|cycle)/i,
  /lose\s*\d{2,}\s*(kg|lb|pound).*per\s*week/i,
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = req.headers.authorization;
  if (auth !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: intake } = await supabase
      .from('intake_submissions')
      .select('*')
      .eq('lead_id', client.lead_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const clientProfile = {
      name: client.name,
      program: client.program,
      weekNumber: week_no,
      intake: intake ? {
        age: intake.age,
        gender: intake.gender,
        goal: intake.goal,
        injuries: intake.injuries,
        dietPref: intake.diet_pref,
        schedule: intake.schedule,
        experience: intake.experience,
      } : {},
      recentCheckins: (recentCheckins || []).map(c => ({
        week: c.week_no,
        weight: c.weight,
        waist: c.waist,
        compliance: c.compliance_score,
        energy: c.energy,
        issues: c.issues,
      })),
    };

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: `You are Maddy's program architect. Create personalised weekly training and nutrition plans for fitness coaching clients. Output ONLY valid JSON with two keys: "workout_plan" and "nutrition_plan". Each should be detailed, practical, and tailored to the client's data. Workout plan should have day-by-day exercises with sets/reps. Nutrition plan should have daily targets and meal suggestions. Be safe — no extreme calorie restrictions below 1200cal, no banned substances, no unrealistic timelines. Keep it evidence-based and achievable.`,
      messages: [{
        role: 'user',
        content: `Generate Week ${week_no} program for this client:\n\n${JSON.stringify(clientProfile, null, 2)}`,
      }],
    });

    const aiText = response.content[0].text;

    let parsed;
    try {
      const jsonMatch = aiText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : aiText);
    } catch {
      return res.status(500).json({ error: 'Failed to parse AI response' });
    }

    const fullText = JSON.stringify(parsed);
    for (const pattern of RISKY_PATTERNS) {
      if (pattern.test(fullText)) {
        const { createEscalation } = require('./_lib/escalation');
        await createEscalation(
          client.phone,
          `Risky content in generated program: ${pattern.toString()}`,
          `Client: ${client.name}, Week: ${week_no}`
        );
        return res.status(200).json({
          ok: false,
          reason: 'flagged_for_review',
          pattern: pattern.toString(),
        });
      }
    }

    const { data: program, error } = await supabase
      .from('programs')
      .upsert({
        client_id,
        week_no,
        workout_plan: parsed.workout_plan || {},
        nutrition_plan: parsed.nutrition_plan || {},
        generated_at: new Date().toISOString(),
        notes: `Auto-generated for week ${week_no}`,
      }, { onConflict: 'client_id,week_no' })
      .select()
      .single();

    if (error) throw error;

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'Champion',
      `Week ${week_no}`,
    ]);

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({ ok: true, programId: program.id });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Failed to generate program' });
  }
};
