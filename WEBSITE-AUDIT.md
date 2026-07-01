# Website Deep Audit — fitnessbymaddy.com & lunarluxury.in

**Audit date:** 2026-07-01
**Scope:** Full technical, SEO, conversion, UX, accessibility, performance & trust review.
**Method:** `fitnessbymaddy.com` audited from complete source code (this repo). `lunarluxury.in` attempted via live crawl + SEO tooling — see access note in Part 2.

---

## Executive Summary

| Site | Overall | Biggest issue |
|------|---------|---------------|
| **fitnessbymaddy.com** | 🟠 **Not launch-ready.** Beautiful design, but the site **cannot take money or capture a single lead** in its current state. | Payment links and the application form are dead placeholders. |
| **lunarluxury.in** | ⚪ **Could not be fully audited** — blocked by bot-protection (HTTP 403) and no interactive SEO access in this session. Near-zero organic footprint. | Not crawlable + invisible in search. |

> **The single most important sentence in this report:** fitnessbymaddy.com looks like a premium, finished product, but **every purchase button and the lead form go nowhere.** A visitor who wants to pay Maddy literally cannot. Fix this before anything else.

---

# PART 1 — fitnessbymaddy.com (Full Deep Audit)

The site is a 4-page static site (Netlify): `index.html`, `shred.html`, `custom.html`, `vip.html`, one stylesheet, one small `nav.js`. Design language is genuinely strong — luxury editorial (Cormorant Garamond + DM Sans, warm cream/gold palette, good spacing). The problems are **functional, not aesthetic.**

## 🔴 CRITICAL — Blocks revenue (fix today)

### C1. All payment buttons are dead links
In `shred.html` and `custom.html` every purchase CTA points to `href="#"`:
```html
<!-- REPLACE href below with your Stripe payment link -->
<a href="#" class="btn-primary">Get Started — $97</a>   <!-- shred.html -->
<a href="#" class="btn-primary">Buy Now →</a>            <!-- shred + custom -->
<a href="#" class="btn-primary">Start Your Journey — $297</a> <!-- custom.html -->
```
Clicking "Buy Now" just jumps to the top of the page. **There is no way to purchase the $97 or $297 program.** This is 100% of the direct revenue path, broken.
**Fix:** Create Stripe Payment Links (or Razorpay/Instamojo for India) and replace every `href="#"`. ~30 minutes of work.

### C2. The 1-on-1 application form submits to nowhere
In `vip.html`:
```html
<!-- REPLACE action below with your Formspree / Typeform / Google Form URL -->
<form action="#" method="POST">
```
`action="#"` means submitting **reloads the page and discards every lead.** The VIP program ($597/mo — the highest-value offer) captures zero applications.
**Fix:** Point `action` at Formspree / Google Forms / Typeform / Netlify Forms (Netlify Forms is free and you're already on Netlify — just add `data-netlify="true"` to the `<form>` and a `name` attribute).

### C3. No payment = no business
Together, C1 + C2 mean the site is currently a **brochure that cannot convert.** Everything below is secondary until these two are live.

## 🔴 CRITICAL — Mobile is broken

### C4. No mobile navigation menu
`style.css` (line ~283):
```css
@media (max-width: 900px) { .nav-links { display: none; } }
```
On phones the entire nav is **hidden with no hamburger replacement.** A mobile visitor can only reach the homepage (via logo) — they **cannot navigate to Shred, 12-Week, or VIP pages** except through in-body links. Since most fitness/Instagram traffic is mobile, this cripples the majority of visitors.
**Fix:** Add a hamburger toggle (a few lines of JS + a slide-in menu). High priority.

## 🟠 HIGH — Trust & credibility gaps

### H1. Zero real imagery
There is **not a single real photo** on the entire site — every image is an emoji placeholder:
`👤 "Maddy's Photo Here"`, `🔥 "Program Cover Image"`, `💪`, `👑`. For a personal-brand, "elite" coaching business, **the coach's face and client before/after photos ARE the product.** Placeholders destroy the premium positioning and conversion trust.
**Fix:** Real hero photo of Maddy, before/after gallery, program cover images.

### H2. Unverifiable / thin social proof
- Claims "2M+ Instagram Followers", "3,000+ transformations", "10+ years" — bold numbers with no proof (no verified badge, no results gallery, no press).
- Only **2 testimonials**, both text-only, no photos or handles → reads as generic.
- Instagram link is `@fitnessbymaddy_` — verify this is the real, active account.
**Fix:** Add a real results/transformation gallery, more testimonials with faces/handles, embed the live Instagram feed.

### H3. Currency vs audience mismatch
Prices are in **USD** ($97/$297/$597) but testimonials cite **Mumbai & Dubai** clients. If the target market is India, consider INR pricing or a currency toggle; if global, that's fine — just be deliberate.

### H4. No legal / policy pages
No Privacy Policy, Terms, or Refund Policy anywhere. You collect email + personal data via the VIP form → under India's **DPDP Act 2023** (and GDPR for any EU visitor) a privacy policy is effectively mandatory. Also hurts trust and payment-processor onboarding.
**Fix:** Add Privacy Policy, Terms, Refund/Guarantee pages; link in footer.

## 🟠 HIGH — SEO & discoverability

The on-page basics are actually **good**: each page has a unique, well-written `<title>` and `meta description`, one `<h1>`, `lang="en"`, valid viewport. But the site is invisible to search beyond that:

| Missing | Impact |
|---------|--------|
| `robots.txt` & `sitemap.xml` | Crawlers get no guidance; slower/incomplete indexing |
| Open Graph / Twitter Card tags | Links shared on Instagram/WhatsApp show no image/title preview → far lower click-through |
| Structured data (JSON-LD) | No `Person`, `Product`+`Offer`, or `FAQPage` schema → no rich results |
| Favicon | No browser-tab / bookmark icon (looks unfinished) |
| Canonical tags | Duplicate-URL risk (see S1 below) |
| Any real content / blog | Nothing to rank for organically; 100% dependent on Instagram traffic |
| Analytics (GA4 / Meta Pixel) | **You cannot measure visitors, conversions, or run retargeting ads.** |

### S1. Netlify catch-all creates soft-404s
`netlify.toml`:
```toml
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
  force = false
```
`force = false` means real files (shred/custom/vip) still serve correctly — good. **But** any unknown URL (typos, old links) returns the homepage with a **200 status instead of a 404.** Search engines treat this as a "soft 404" and it can dilute indexing. A static 4-page site doesn't need SPA rewrites at all.
**Fix:** Remove this redirect block (or add a proper `404.html`). There's no SPA here.

## 🟡 MEDIUM — Accessibility (a11y)

### A1. Program cards aren't keyboard-accessible
`index.html` navigates via a div handler:
```html
<div class="program-card" onclick="window.location='shred.html'">
```
A `<div onclick>` is **not focusable and not operable by keyboard** — screen-reader and keyboard-only users can't use these cards. The inner `<button>` has no handler of its own, so tabbing to it + Enter does nothing useful.
**Fix:** Make the whole card a real `<a href="shred.html">` (or add `tabindex="0"`, `role="link"`, and a keydown handler).

### A2. Other a11y gaps
- No skip-to-content link, no visible `:focus-visible` styles for keyboard users.
- Emoji used as meaningful icons (🏆👑🔥) without `aria-label`/`aria-hidden`.
- Check contrast: gold `#B8965A` and mid-grey `#6B6B6B` on cream, plus footer text at `rgba(255,255,255,0.5–0.6)` — several are likely **below WCAG AA (4.5:1)**. Run through a contrast checker and darken where needed.
- Forms *do* have proper `<label>`s ✅ (good).

## 🟡 MEDIUM — Performance & code quality

- **Good:** tiny footprint (static HTML, ~16 KB CSS), no framework bloat, `scroll-behavior: smooth`.
- Google Fonts loaded via CSS `@import` → render-blocking. Switch to `<link rel="preconnect">` + `<link rel="stylesheet">` in `<head>` for faster first paint.
- Heavy **inline styles**, especially in `vip.html` (dozens of `style="..."`) → hard to maintain and can't be cached/reused. Move to `style.css`.
- Nav + footer are **duplicated across all 4 HTML files** → every change must be made 4×. Consider a tiny build step (11ty/Astro) or HTML includes if this grows.
- When you add real images: serve WebP/AVIF, set explicit `width`/`height` (prevents layout shift), and add `loading="lazy"`.

## ✅ What's already strong
- Clean, cohesive **premium visual design** and typography.
- Unique, well-crafted titles/meta descriptions and copy per page.
- Semantic-ish structure (`<nav>`, `<section>`, `<footer>`, one `<h1>` each).
- Responsive grid collapses sensibly on mobile (nav aside).
- Proper form labels; fast, lightweight delivery.

## Prioritized action plan (fitnessbymaddy.com)
1. **Wire up payments** (Stripe/Razorpay links) — C1. *Without this, nothing else matters.*
2. **Connect the VIP form** (Netlify Forms is free & instant) — C2.
3. **Add a mobile hamburger menu** — C4.
4. **Add real photos** of Maddy + before/after gallery — H1.
5. **Add analytics** (GA4 + Meta Pixel) so you can measure & retarget — SEO table.
6. **Add legal pages** (Privacy/Terms/Refund) — H4.
7. **SEO polish:** favicon, OG tags, `robots.txt`, `sitemap.xml`, JSON-LD, remove the Netlify catch-all — S1 + table.
8. **A11y:** make cards real links, fix contrast, add focus styles — A1/A2.

---

# PART 2 — lunarluxury.in

## ⚠️ Access note (important, honest)
I could **not** complete a first-hand audit of `lunarluxury.in` in this session:

- **Live crawl → HTTP 403 Forbidden.** The site (root, `/`, `www`, and `sitemap.xml`) blocks automated/datacenter requests via bot-protection (likely Cloudflare/WAF). This affects crawlers only — real browsers are unaffected.
- **SEO tooling (Ahrefs) → unavailable.** The connected Ahrefs data server requires an interactive permission approval that can't be granted in this automated session, so backlink/traffic/keyword data couldn't be pulled.
- **Web search → essentially no footprint.** Searches for the domain and brand returned **no results specific to lunarluxury.in** (only unrelated "Luna/Lunar" brands). A live e-commerce store with *zero* discoverable search or review presence is itself a red flag for organic visibility.

I won't invent findings for a site I couldn't inspect. Below is (a) the one real signal I do have, and (b) exactly how to unblock a full audit.

### The one concrete finding
**Discoverability ≈ zero.** No organic search results, no third-party reviews, no indexed brand mentions surfaced. For an online store this is the top-priority problem regardless of how the site itself looks — customers can't find what they can't search.

### How to unblock a complete lunarluxury.in audit
Pick any one:
1. **Share the source** (export the theme/HTML, or add me as a collaborator on its repo/Shopify/store admin) → I'll audit it as deeply as fitnessbymaddy above.
2. **Temporarily allowlist** the audit crawler / disable bot-protection for a window, or paste the rendered HTML of the homepage + a product page + cart.
3. **Authorize the Ahrefs connector** in an interactive Claude session → I can then pull DR, backlinks, organic keywords, traffic, and top pages with no site access needed.
4. Tell me the **platform** (Shopify / WooCommerce / Wix / custom) and I'll run a platform-specific audit checklist.

### E-commerce audit checklist I'll run once unblocked
- **Trust/legal:** SSL, visible contact + address, Return/Refund/Shipping/Privacy policies, secure-checkout badges, genuine reviews.
- **Product pages:** image quality/zoom, descriptions, price clarity, stock status, size/variant UX, cross-sell.
- **Checkout:** guest checkout, number of steps, payment options (UPI/cards/COD/wallets), cart abandonment triggers, mobile checkout.
- **SEO:** titles/meta/OG, product schema (`Product`/`Offer`/`AggregateRating`), sitemap, robots, canonical, Core Web Vitals, image alt/lazyload.
- **Performance:** LCP/CLS/INP, image optimization, third-party script load.
- **Marketing:** GA4/Meta Pixel, email capture, abandoned-cart flow, retargeting readiness.

---

## Appendix — audit dimensions covered for fitnessbymaddy.com
Conversion • Payments/lead-capture • Mobile UX • Navigation • Trust/social-proof • Imagery • Copy • On-page SEO • Technical SEO (robots/sitemap/schema/OG) • Analytics • Accessibility (WCAG) • Performance • Code maintainability • Legal/compliance.
