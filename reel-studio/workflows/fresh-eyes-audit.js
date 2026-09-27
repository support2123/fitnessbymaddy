export const meta = {
  name: 'fresh-eyes-audit',
  description: 'Independent creative-director + compliance audit of a finished FBM reel from contact sheets + transcript',
  whenToUse: 'After QC. args = {video, sheets_dir, transcript, extra?}. A release requires a score of at least 8.5 out of 10 and no unresolved critical finding.',
  phases: [{ title: 'Audit' }],
}

const V = args?.video, SD = args?.sheets_dir, TR = args?.transcript || ''
if (!V || !SD) throw new Error('args.video and args.sheets_dir required')

phase('Audit')
const brief = (role) => `${role}

THE FILM: a doctrine-era DECODE reel for FitnessByMaddy. The standard is Whoop / ESPN / Apple Keynote: source-backed, cinematic, and impossible to mistake for a template.
VIEW every timestamped contact sheet in ${SD}. Pull full-resolution frames for every uncertain point:
  ffmpeg -y -ss <t> -i "${V}" -frames:v 1 /tmp/f.png

NARRATION WITH TIMINGS:
${TR}

NON-NEGOTIABLES:
- frame zero is a full-bleed psychological hero and the social cover; no black or contents-card open
- hook lands within two seconds, category is clear by second three, and the first frame works silent
- every stat has an author/year citation on that frame; thin evidence is bounded in the same spoken beat
- one cited Living Clock is prominent top-right above the icon rail, synchronizes environment / telemetry / trace, has score-synced ticks, and lands its final value on the exact CTA frame
- every story beat owns a distinct LIVE moving shot: inspect sequential frames, reject a frozen or near-frozen background over 2.0 seconds, repeated B-roll, last-frame holds, or an action label where the body never performs the action
- motion is quiet enough for reading: one dominant subject, slow monotonic camera, no visual fight with text, and one coherent graphite/gold/cyan Editorial Athletic grade with no grain drift
- all load-bearing content stays inside x90–990 / y250–1590; citations sit above the bottom platform UI zone and the clock clears the icon rail
- words reveal per-word with a brief overshoot/y-rise, fixed numbers pop-land rather than count, and no static rounded template panel carries the message
- one owned-number CTA plus a concrete next-reel loop visibly occupies the final two seconds

${args?.extra || ''}
Be adversarial and timestamp every finding. Do not flatter. End exactly with:
SCORE /10 (release threshold = 8.5; 9 = best-in-class)
VIRAL 6/6: shareable / saveable / commentable / rewatch / screenshot / wait-for-next
WORLD-CLASS BAR: pass / fail with reasons
TOP 3 FIXES
VERDICT: SHIP AS IS / SHIP WITH TWEAKS / REBUILD`

const out = await parallel([
  () => agent(brief(`You are a world-class short-form creative director. Audit the cover-frame lock, first-second living reveal, hook latency, shot grammar, type hierarchy, premium color, Living Clock synchronization, retention resets, emotional turn, and CTA/series pull. Reject any slide-like, template-like, dead, or visually unsafe frame.`),
    { label: 'creative-director', phase: 'Audit', effort: 'high' }),
  () => agent(brief(`You are the independent evidence + brand auditor. Check all visible and spoken claims: citations, number/source consistency, confidence-tier language, correlation versus causation, medical scope, forbidden vocabulary, English-only output, coach pronouns, safe zones, client-safe pricing, sterile delivery, and caption/CTA consistency.`),
    { label: 'compliance', phase: 'Audit', effort: 'high' }),
])
return out.filter(Boolean)
