---
name: "Vinyl Noir"
description: "A music platform that sounds like late-night radio looks. Deep charcoal surfaces with a faint vertical warmth, Instrument Serif italic for album titles, Inter for everything else, a single burnt-amber accent reserved for the now-playing state. Built for music streaming, label sites, and audio products that want warmth in the dark without leaning on neon."
tags: [music, dark, editorial, premium, modern]
colors:
  primary: "#ece6dc"
  secondary: "#8a8278"
  tertiary: "#d97a2c"
  neutral: "#1c1815"
  surface: "#15110e"
typography:
  display: "Instrument Serif"
  body: Inter
  mono: "JetBrains Mono"
  scale:
    hero: "6rem / 0.96 / 400 / -0.025em"
    h1: "3.5rem / 1.04 / 400 / -0.02em"
    h2: "1.875rem / 1.18 / 400 / -0.012em"
    body: "1rem / 1.6 / 400 / -0.005em"
radius:
  sm: 3px
  md: 6px
  lg: 10px
  pill: 9999px
shadows:
  card: "rgba(0,0,0,0.4) 0 1px 0 inset, rgba(0,0,0,0.5) 0 8px 24px -12px"
  button: "rgba(0,0,0,0.3) 0 1px 2px"
borders:
  card: "1px solid rgba(236,230,220,0.08)"
  divider: rgba(236,230,220,0.10)
buttons:
  primary:
    background: #ece6dc
    color: #15110e
    border: none
    shape: pill
    padding: 11px 22px
    font: 600 / 0.8125rem
  secondary:
    background: #262220
    color: #ece6dc
    border: 1px solid rgba(236,230,220,0.10)
    shape: pill
    padding: 11px 22px
    font: 500 / 0.8125rem
  outline:
    background: transparent
    color: #ece6dc
    border: 1px solid rgba(236,230,220,0.18)
    shape: pill
    padding: 11px 22px
    font: 500 / 0.8125rem
  ghost:
    background: transparent
    color: #8a8278
    border: none
    shape: pill
    padding: 11px 16px
    font: 500 / 0.8125rem
charts:
  variant: "thin-bars"
  stroke_width: 1.5
  fill_opacity: 0.1
  gridlines: false
  bar_gap: 6px
  highlight: single
  dot_marker: true
fonts_url: "https://fonts.googleapis.com/css2?family=Instrument+Serif:ital,wght@0,400;1,400&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
dependencies: ["lucide-react"]
---

# Vinyl Noir

## AI Build Instructions

> **Read this section before writing any code.** The rules below
> are non-negotiable. Every value used in the UI must come from this
> file's frontmatter — never substitute, approximate, or invent new
> colors, fonts, radii, or shadows. If a value is missing, ask the
> user before adding one.

### 1 · Your role

You are building UI for a project that has adopted **Vinyl Noir** as its
design system. Treat `DESIGN.md` as the single source of truth.
Your job is to translate the user's product requirements into
components and pages that look like they were designed by the same
person who authored this file.

### 2 · Token compliance

- Pull every color, font family, radius, shadow, and spacing value
  from the frontmatter at the top of this file.
- Use semantic roles (e.g. `primary`, `accent`, `muted`) — never
  hard-code hex values that bypass the system.
- When a token can be expressed as a CSS variable, declare it once
  in your global stylesheet and reference it everywhere downstream.
- The Google Fonts `<link>` is provided in the Typography section.
  Add it to `<head>` before any component renders.

### 3 · Component recipes

Use these recipes verbatim when building the corresponding component.

#### Buttons

Four variants are defined. Pick one — never blend variants or invent a fifth.

- **Primary** — pill shape, bg `#ece6dc`, text `#15110e`, padding `11px 22px`, weight `600`.
- **Secondary** — pill shape, bg `#262220`, text `#ece6dc`, border `1px solid rgba(236,230,220,0.10)`, padding `11px 22px`, weight `500`.
- **Outline** — pill shape, text `#ece6dc`, border `1px solid rgba(236,230,220,0.18)`, padding `11px 22px`, weight `500`.
- **Ghost** — pill shape, text `#8a8278`, padding `11px 16px`, weight `500`.

Reach for **primary** as the single dominant CTA per screen.
**Secondary** for the supporting action. **Outline** for tertiary
actions in toolbars. **Ghost** for inline links and table actions.

#### Cards

- Background: `#15110e`
- Border: `1px solid rgba(236,230,220,0.08)`
- Shadow: `rgba(0,0,0,0.4) 0 1px 0 inset, rgba(0,0,0,0.5) 0 8px 24px -12px`
- Radius: `radius.lg` (`10px`)
- Internal padding: `20px` for compact cards, `24–28px` for content cards.

#### Tabs

Variant: `underline`. Flat row of labels. Active tab gets a 2px underline in the accent color — no fill.

#### Charts

- Bar/line variant: `thin-bars`
- No gridlines — let the bars/lines carry the data.
- Highlight strategy: `single` — emphasize a single bar/point per chart.

#### Typography pairings

- **Display (`Instrument Serif`)** — h1, h2, hero headlines, brand wordmarks.
- **Body (`Inter`)** — paragraphs, labels, button text, form inputs.
- **Mono (`JetBrains Mono`)** — code, eyebrows, metadata, numerals in tables.

### 4 · Hard constraints

Never do any of the following without explicit instruction from the user:

- Introduce a new color, font, radius, or shadow that isn't declared above.
- Mix this system with another (e.g. don't paste in Material or Bootstrap defaults).
- Use generic gradient defaults (purple→blue, peach→pink) — they break the system's voice.
- Reach for emoji icons. Use a consistent icon library and size icons in line with body type.
- Add motion that exceeds the system's restraint — keep transitions short (≤200ms) and subtle.

### 5 · Before you finish — verify

Run through this checklist for every screen you produce:

- [ ] Every color used appears in the Colors table above.
- [ ] Headlines use the display font; body copy uses the body font.
- [ ] Buttons match one of the declared variants exactly (shape, padding, weight).
- [ ] Border-radius values come from `radius.sm` / `radius.md` / `radius.lg` / `radius.pill`.
- [ ] Cards and dividers use the declared border + shadow tokens.
- [ ] No values were invented; if you needed something missing, you stopped and asked.

---

## 1. Atmosphere

Vinyl Noir is a music platform that sounds like late-night radio looks. The page surface is deep warm charcoal `#15110e` — never pure black, never grey, with a faint warmth pulled from sepia rather than blue. Album titles run in Instrument Serif italic at 96px, weight 400 — the high-contrast italic glyphs giving each title the gestural sweep of a handwritten label. Body sits in Inter at 16px, bone-warm `#ece6dc`. The single accent is burnt amber `#d97a2c` that appears only as the now-playing waveform, the active track row's left border, and the play button when a track is queued.

The discipline is in the warm dark: charcoal-sepia, not black; bone-warm light text, not pure white; burnt amber, not neon orange. Italic display, upright body — the typographic split mirrors the difference between a song title and a description.

**Signature moves**

- Instrument Serif italic 400 at 96px for album titles — high-contrast italic IS the brand
- Warm charcoal-sepia surface `#15110e` — never pure black, never cool grey
- Burnt amber `#d97a2c` only on now-playing waveform + active track row border + queued play button
- Bone-warm text `#ece6dc` — never pure white, never grey
- Pill-shape buttons (record-label badge voice) on the dark stage

## 2. Palette

### Surfaces

- **Stage** `#15110e` — page background (warm charcoal-sepia)
- **Stage Lift** `#1c1815` — section bands, primary card
- **Card** `#262220` — secondary surfaces, secondary button
- **Hairline** `rgba(236,230,220,0.08)` — every divider

### Ink (light on dark)

- **Bone Warm** `#ece6dc` — text, headings (warm ivory, never white)
- **Bone 50** `#8a8278` — secondary text, ghost buttons

### Accent

- **Amber** `#d97a2c` — now-playing waveform, active track row left border, queued play button
- **Amber Soft** `rgba(217,122,44,0.14)` — focus ring, hovered track row background

## 3. Typography

| Role               | Font                      | Size | Weight | Leading | Tracking         |
| ------------------ | ------------------------- | ---- | ------ | ------- | ---------------- |
| Album Title (Hero) | Instrument Serif (italic) | 96px | 400    | 0.96    | -0.025em         |
| H1                 | Instrument Serif          | 56px | 400    | 1.04    | -0.02em          |
| H2                 | Instrument Serif (italic) | 30px | 400    | 1.18    | -0.012em         |
| Body               | Inter                     | 16px | 400    | 1.6     | -0.005em         |
| UI / Button        | Inter                     | 13px | 600    | 1.4     | 0                |
| Track Time / Mono  | JetBrains Mono            | 12px | 500    | 1.0     | 0 tabular-nums   |
| Label              | JetBrains Mono            | 10px | 500    | 1.0     | 0.10em uppercase |

Instrument Serif appears at 400 only — the high-contrast strokes earn drama from scale. Italic for album titles and pull quotes; upright for everything else display.

## 4. Buttons

### Primary (Bone Warm Pill)

```css
background: #ece6dc;
color: #15110e;
padding: 11px 22px;
border-radius: 9999px;
font-weight: 600;
box-shadow: rgba(0, 0, 0, 0.3) 0 1px 2px;
```

The bone-warm fill on charcoal reads as a vinyl-label sticker. Inverted from the usual dark-mode dark-button move.

### Secondary (Card Pill)

- `#262220` background, 1px hairline at 10% bone, bone text — same pill shape

### Outline & Ghost

- Outline: transparent, 1px hairline at 18% bone
- Ghost: no border, bone-50, hover lifts to bone-warm

## 5. Cards

```css
background: #1c1815;
border: 1px solid rgba(236, 230, 220, 0.08);
border-radius: 10px;
box-shadow:
  rgba(0, 0, 0, 0.4) 0 1px 0 inset,
  rgba(0, 0, 0, 0.5) 0 8px 24px -12px;
```

The 1px black inset highlight at the top is the dark catch-light — without it the card reads as flat brown. The 24px ambient shadow gives the card a stage-lit float.

The currently-playing track row gets a 2px amber left border — the only place amber appears as a card edge.

## 6. Charts

Thin precise bars (3px wide, 6px gap) — used as the now-playing waveform. The active bar (current playhead) is amber, others in 22% bone-warm. Line charts at 1.5px bone-warm with a 10% amber fill, ending in an amber dot marker. NO gridlines. Y-axis labels in JetBrains Mono uppercase 10px.

## 7. Tabs

Underline 1.5px in amber for the active state. Inactive tabs are bone-50 in Inter 500. Hover = amber-soft background wash.

## 8. Spacing

- Base 4px
- Scale: `4, 8, 12, 16, 24, 32, 48, 64, 96, 128`
- Section padding: 96px desktop, 48px mobile

## 9. Do's & don'ts

✅ **Do**

- Use Instrument Serif italic 400 at 96px for album titles — italic IS the handwritten-label voice
- Hold the warm charcoal-sepia surface `#15110e` — pure black reads as terminal, cool grey kills the warmth
- Reserve amber for now-playing waveform + active track left border + queued play button
- Use bone-warm text `#ece6dc` — pure white kills the radio-warm atmosphere

❌ **Don't**

- Use neon orange — burnt amber `#d97a2c` is muted vinyl-label warmth, not safety cone
- Use Instrument Serif at any other weight — 400 only, italic for album titles
- Add a second accent — amber alone, on three specific surfaces
- Use sharp 0px corners — soft 6-10px is the record-sleeve voice

---

## Tokens

> Generated from the same source the live preview renders from.
> Treat the values below as the contract — never substitute approximations.

### Colors

| Role      | Value     |
| --------- | --------- |
| primary   | `#ece6dc` |
| secondary | `#8a8278` |
| tertiary  | `#d97a2c` |
| neutral   | `#1c1815` |
| surface   | `#15110e` |

### Typography

- **Display:** Instrument Serif
- **Body:** Inter
- **Mono:** JetBrains Mono

| Role | size / leading / weight / tracking |
| ---- | ---------------------------------- |
| Hero | 6rem / 0.96 / 400 / -0.025em       |
| H1   | 3.5rem / 1.04 / 400 / -0.02em      |
| H2   | 1.875rem / 1.18 / 400 / -0.012em   |
| Body | 1rem / 1.6 / 400 / -0.005em        |

### Radius

- sm: `3px`
- md: `6px`
- lg: `10px`
- pill: `9999px`

### Shadows

- **card:** `rgba(0,0,0,0.4) 0 1px 0 inset, rgba(0,0,0,0.5) 0 8px 24px -12px`
- **button:** `rgba(0,0,0,0.3) 0 1px 2px`

### Borders

- **card:** `1px solid rgba(236,230,220,0.08)`
- **divider:** `rgba(236,230,220,0.10)`

### Buttons

Four variants, each fully tokenized. The preview renders from these exact values.

#### Primary

| Property   | Value       |
| ---------- | ----------- |
| shape      | `pill`      |
| background | `#ece6dc`   |
| color      | `#15110e`   |
| border     | `none`      |
| padding    | `11px 22px` |
| fontWeight | `600`       |
| fontSize   | `0.8125rem` |

#### Secondary

| Property   | Value                              |
| ---------- | ---------------------------------- |
| shape      | `pill`                             |
| background | `#262220`                          |
| color      | `#ece6dc`                          |
| border     | `1px solid rgba(236,230,220,0.10)` |
| padding    | `11px 22px`                        |
| fontWeight | `500`                              |
| fontSize   | `0.8125rem`                        |

#### Outline

| Property   | Value                              |
| ---------- | ---------------------------------- |
| shape      | `pill`                             |
| background | `transparent`                      |
| color      | `#ece6dc`                          |
| border     | `1px solid rgba(236,230,220,0.18)` |
| padding    | `11px 22px`                        |
| fontWeight | `500`                              |
| fontSize   | `0.8125rem`                        |

#### Ghost

| Property   | Value         |
| ---------- | ------------- |
| shape      | `pill`        |
| background | `transparent` |
| color      | `#8a8278`     |
| border     | `none`        |
| padding    | `11px 16px`   |
| fontWeight | `500`         |
| fontSize   | `0.8125rem`   |

### Charts

| Property    | Value       |
| ----------- | ----------- |
| variant     | `thin-bars` |
| strokeWidth | `1.5`       |
| fillOpacity | `0.1`       |
| gridlines   | `false`     |
| barGap      | `6px`       |
| highlight   | `single`    |
| dotMarker   | `true`      |

---

## Pro tokens

> Production-fidelity tokens. States, density, motion, elevation,
> content rules and a measured WCAG contract — derived from the
> resting tokens unless explicitly authored.

### States

#### Button

- **hover** — bg: `rgba(217, 122, 44, 0.92)`, shadow: `0 4px 20px -8px rgba(217, 122, 44, 0.4)`
- **focus** — outline: `1.5px solid #d97a2c`, outline-offset: `4px`
- **active** — transform: `translateY(1px)`, filter: `brightness(0.95)`
- **disabled** — opacity: `0.45`
- **loading** — opacity: `0.7`
- **selected** — bg: `#ece6dc`, color: `#15110e`

#### Input

- **hover** — border: `1px solid #ece6dc`
- **focus** — border: `1px solid #d97a2c`, shadow: `0 1px 0 0 #d97a2c`
- **disabled** — opacity: `0.45`
- **error** — border: `1px solid #991B1B`, shadow: `0 1px 0 0 #991B1B`

#### Card

- **hover** — shadow: `0 8px 24px -12px rgba(15,23,42,0.14)`, transform: `translateY(-1px)`
- **selected** — border: `1px solid #ece6dc`

#### Tab

- **hover** — color: `#ece6dc`
- **focus** — outline: `1.5px solid #d97a2c`, outline-offset: `3px`
- **selected** — color: `#d97a2c`, border: `0 0 2px 0 solid #d97a2c`

### Density

| Mode        | padding × | row × | body      | radius × | Use for                                      |
| ----------- | --------- | ----- | --------- | -------- | -------------------------------------------- |
| compact     | 0.72      | 0.78  | 0.8125rem | 0.85     | Information-dense — tables, IDEs, dashboards |
| comfortable | 1         | 1     | 0.9375rem | —        | Default — most product UI                    |
| spacious    | 1.35      | 1.3   | 1rem      | 1.15     | Editorial — marketing, long-form, settings   |

### Motion

**Signature — Page turn.** Deliberate, measured motion — like turning a magazine page. Never jerky, never overdone.

```css
transition: all 320ms cubic-bezier(0.25, 0.46, 0.45, 0.94);
```

| Token             | Value                                  |
| ----------------- | -------------------------------------- |
| duration.instant  | `80ms`                                 |
| duration.fast     | `180ms`                                |
| duration.base     | `320ms`                                |
| duration.slow     | `500ms`                                |
| easing.standard   | `cubic-bezier(0.25, 0.46, 0.45, 0.94)` |
| easing.decelerate | `cubic-bezier(0.0, 0, 0.2, 1)`         |
| easing.accelerate | `cubic-bezier(0.4, 0, 1, 1)`           |
| easing.spring     | `cubic-bezier(0.5, 1.2, 0.6, 1)`       |

### Elevation

Five-level scale, system-specific recipe.

| Level  | Shadow                                  | Recipe                                           |
| ------ | --------------------------------------- | ------------------------------------------------ |
| level0 | `none`                                  | Hairline only — typical editorial resting state. |
| level1 | `0 1px 2px rgba(15,23,42,0.04)`         | Barely visible — list rows, dividers.            |
| level2 | `0 8px 24px -12px rgba(15,23,42,0.12)`  | Pull-quote, sidebar — soft lift.                 |
| level3 | `0 16px 40px -16px rgba(15,23,42,0.18)` | Cover story card — clear lift.                   |
| level4 | `0 32px 80px -24px rgba(15,23,42,0.28)` | Modal — overlays the layout, with scrim.         |

### Content

- **measure:** `60ch` (max line length for body prose)
- **paragraph spacing:** `1.5em`
- **list indent:** `1.75em`
- **list gap:** `0.55em`
- **link:** color `#d97a2c`, underline `always`
- **blockquote:** border `4px solid #d97a2c`, padding `0.4em 0 0.4em 1.5em`
- **code:** background `rgba(236, 230, 220, 0.06)`, color `#ece6dc`

### Accessibility (WCAG 2.1)

**Overall:** AA

| Pair                  | Ratio   | Required | Grade | Suggested fix |
| --------------------- | ------- | -------- | ----- | ------------- |
| Body text on surface  | 15.13:1 | AA       | AAA   | —             |
| Body text on canvas   | 14.21:1 | AA       | AAA   | —             |
| Muted text on surface | 4.96:1  | AA       | AA    | —             |
| Accent on surface     | 6.05:1  | AA-Large | AA    | —             |
| Accent on canvas      | 5.69:1  | AA-Large | AA    | —             |
