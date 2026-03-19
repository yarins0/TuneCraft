# TuneCraft — Design System

This document is the single source of truth for TuneCraft's visual language and interaction patterns.
Update it whenever a new pattern is introduced. Stale docs are worse than no docs.

---

## Design Principles

1. **Dark, focused, musical** — every screen should feel like a professional audio tool, not a generic SaaS dashboard.
2. **Purple accent is intentional** — it's TuneCraft's identity colour, reserved for primary actions and highlighted states only. Don't dilute it.
3. **Empty states are features** — every empty list needs warmth, a primary action, and context. "No items found." is not a design.
4. **Platform trust signals** — when connecting to a streaming platform, use that platform's brand colour. Users are granting OAuth access; a trust signal matters.
5. **Micro-interactions everywhere** — `hover:scale-105 active:scale-95` on every interactive card/button. They make the app feel alive without being distracting.
6. **Subtraction default** — if a UI element doesn't earn its pixels, cut it.

---

## Colour Tokens

Defined in `client/src/index.css` as CSS variables, mapped to Tailwind utilities in `tailwind.config.js`.

| Token           | CSS Variable              | Value                       | Usage                                   |
|-----------------|---------------------------|-----------------------------|-----------------------------------------|
| `bg-primary`    | `--color-bg-primary`      | `#0a0a0a`                   | Page backgrounds                        |
| `bg-secondary`  | `--color-bg-secondary`    | `#111111`                   | Hover states, sticky headers            |
| `bg-card`       | `--color-bg-card`         | `#161616`                   | Cards, modals, popover backgrounds      |
| `accent`        | `--color-accent`          | `#a855f7` (purple)          | Primary buttons, active states, links   |
| `accent-hover`  | `--color-accent-hover`    | `#9333ea`                   | Hover on accent elements                |
| `text-primary`  | `--color-text-primary`    | `#ffffff`                   | Body text, headings                     |
| `text-muted`    | `--color-text-muted`      | `rgba(255,255,255,0.4)`     | Subtitles, labels, secondary info       |
| `border-color`  | `--color-border`          | `rgba(255,255,255,0.1)`     | Card/container borders                  |

### Platform Brand Colours

Used only on OAuth login buttons — these are trust signals, not decoration.

| Platform    | Brand Colour | Hex       |
|-------------|--------------|-----------|
| Spotify     | Green        | `#1DB954` |
| SoundCloud  | Orange       | `#FF5500` |
| Apple Music | Pink/Red     | `#fc3c44` |

---

## Typography

All type is white (`text-text-primary`) or muted (`text-text-muted`) on dark backgrounds.

| Role              | Classes                                          | Example Usage                        |
|-------------------|--------------------------------------------------|--------------------------------------|
| Hero heading      | `text-6xl font-black tracking-tighter`           | Login page brand name                |
| Page heading      | `text-3xl font-bold tracking-tight`              | Dashboard header                     |
| Playlist name     | `text-lg font-semibold`                          | PlaylistDetail header                |
| Section label     | `text-sm font-semibold uppercase tracking-widest text-text-muted` | "Your Library", "Split by" |
| Body              | `text-sm`                                        | Track names, playlist metadata       |
| Caption / muted   | `text-xs text-text-muted`                        | Track counts, timestamps             |

---

## Button Variants

### Primary (accent)
Used for the single most important action on a surface. Maximum one per view cluster.
```
bg-accent hover:bg-accent-hover text-white font-semibold px-5 py-2 rounded-full
transition-all duration-200 hover:scale-105 active:scale-95
```

### Secondary (ghost)
Used for supporting actions alongside a primary button.
```
bg-bg-card hover:bg-bg-secondary text-text-primary font-semibold px-5 py-2 rounded-full
border border-border-color transition-all duration-200 hover:border-accent/50
```

### Destructive
Used for remove/delete actions.
```
text-red-400 hover:text-red-300 hover:bg-red-500/10 px-3 py-2 rounded-lg transition-colors
```

### Disabled
```
disabled:opacity-50 disabled:cursor-not-allowed
```
Apply to any variant. Never remove the button from the DOM when loading — disable it instead
so layout doesn't shift.

### Brand-coloured (OAuth login only)
```tsx
style={{ backgroundColor: platformColor }}
className="text-white font-bold px-10 py-4 rounded-full text-lg
           transition-all duration-300 hover:scale-105 active:scale-95 hover:brightness-110"
```

### Loading state
Use `useAnimatedLabel` hook — cycles "Saving…", "Saving……", "Saving………" every 400ms.
Always reserve the button's minimum width so it doesn't resize during animation:
```
<span className="inline-block min-w-[90px] text-center">{label}</span>
```

---

## Cards (Playlist Cards)

```
bg-bg-card rounded-2xl overflow-hidden border border-border-color
transition-all duration-200 cursor-pointer block
hover:border-accent/50 hover:bg-bg-secondary
```

**Selected state:**
```
border-accent ring-2 ring-accent/40 bg-accent/5
```

**Hover-reveal checkbox:** `absolute top-2 right-2 w-6 h-6 rounded-full`
- Hidden by default: `opacity-0 group-hover:opacity-100`
- Always visible in select mode: `opacity-100`

**Artwork fallback:** `🎵` emoji centred in `bg-bg-secondary` square, `text-4xl`.

---

## Modals

All modals share:
- Backdrop: `fixed inset-0 bg-black/60 z-50 flex items-center justify-center`
- Container: `bg-bg-card rounded-2xl border border-border-color shadow-xl`
- Close button: top-right `✕`, `text-text-muted hover:text-text-primary transition-colors`
- Close-on-backdrop: track `mousedown` on backdrop to avoid closing when user drags text out

---

## Section Headers

Collapsible sections (Playlist Insights, Duplicate Warning, Auto-Reshuffle):
```
w-full px-6 py-4 flex items-center justify-between
hover:bg-bg-secondary transition-colors duration-200
```
Label: `text-sm font-semibold uppercase tracking-widest text-text-muted`
Chevron: `▼` rotated 180° when open — `transition-transform duration-300`

---

## Interactive States

| State      | Pattern                                                               |
|------------|-----------------------------------------------------------------------|
| Hover      | `hover:scale-105` on buttons/cards, `hover:border-accent/50` on cards |
| Active     | `active:scale-95` on buttons                                          |
| Disabled   | `opacity-50 cursor-not-allowed` — never remove from DOM               |
| Loading    | Animate label text + disable the button                               |
| Selected   | `border-accent ring-2 ring-accent/40 bg-accent/5`                    |
| Error      | `text-red-400`, `bg-red-500/10`, `border-red-500/20`                 |
| Warning    | `text-orange-400`, `bg-orange-500/15`, `border-orange-500/20`        |

---

## Platform Badge

Used in PlaylistDetail header when a track's platform is not Spotify (Spotify is the default; no badge needed).

```tsx
<span className="text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full
                 bg-orange-500/15 text-orange-400 border border-orange-500/20">
  SoundCloud
</span>
```

---

## Scrollbar

Custom styled scrollbar via `.custom-scrollbar` class. Apply to any scrollable container.
Thumb colour: `accent`. Track: `bg-primary`. Defined in `client/src/index.css`.

---

## Empty States

Every empty list/section must have:
1. A relevant emoji or icon (large, centred)
2. A one-line description ("This playlist is empty.")
3. A contextual action or explanation ("Add tracks on your streaming platform to get started.")

Pattern:
```tsx
<div className="flex flex-col items-center justify-center py-20 text-center gap-3">
  <span className="text-5xl">🎵</span>
  <p className="text-text-primary font-semibold">[headline]</p>
  <p className="text-text-muted text-sm">[context or action]</p>
</div>
```

---

## Audio Features Unavailable State

When fewer than 20% of playlist tracks have audio feature data (common for SoundCloud indie uploads):

```tsx
<div className="flex items-center gap-3 text-text-muted text-sm mb-8 px-1 py-3
                bg-bg-secondary rounded-xl border border-border-color">
  <span className="text-2xl shrink-0 pl-1">🎙️</span>
  <span>[explanation of why features are missing]</span>
</div>
```

---

## Platform Switcher (Planned)

A sidebar triggered from the dashboard header to switch between platform-specific library views
(e.g. Spotify library ↔ SoundCloud library). Not yet implemented. Design to be defined when
multi-platform simultaneous login is live.

---

## Accessibility Notes

- Touch targets: minimum 44×44px for interactive elements
- `aria-label` on icon-only buttons and hover-reveal checkboxes
- `title` attributes on "Open in…" links (platform name)
- Drag handles and custom interactive patterns need keyboard equivalents
- Colour contrast: white text on `#161616` card background passes WCAG AA
- "Coming soon" platform buttons: use inline text badge, not `title` only (invisible on mobile)
