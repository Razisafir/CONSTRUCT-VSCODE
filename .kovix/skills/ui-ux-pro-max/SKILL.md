# UI-UX Pro Max Skill

AI-powered design intelligence engine for generating comprehensive design systems. Provides 67 UI styles, 161 color palettes, 57 font pairings, 25 chart types, and 99 UX guidelines with BM25-powered search across 16+ tech stacks.

## What This Skill Provides

- **67 UI Styles** -- From Minimalism to Glassmorphism, Brutalism, Aurora, Neumorphism, and more
- **161 Color Palettes** -- Pre-tuned palettes for every product category (SaaS, e-commerce, fintech, healthcare, gaming, etc.)
- **57 Font Pairings** -- Curated heading/body font combinations with Google Fonts URLs and CSS imports
- **99 UX Guidelines** -- Accessibility, touch targets, scroll behavior, navigation, keyboard support
- **25 Chart Types** -- Data visualization guidance with accessibility grades
- **16 Tech Stacks** -- Framework-specific guidelines for React, Vue, Svelte, Next.js, Astro, SwiftUI, Flutter, and more

## Search Domains

| Domain | Data | Use When |
|--------|------|----------|
| `style` | 67 UI styles | User asks about design style, visual direction |
| `color` | 161 color palettes | User needs color scheme, palette, tokens |
| `typography` | 57 font pairings | User needs fonts, type system |
| `product` | 99 product types | User describes their product/app type |
| `landing` | Landing page patterns | User is building a landing/marketing page |
| `chart` | 25 chart types | User needs data visualization |
| `ux` | 99 UX guidelines | User asks about accessibility, usability |
| `icons` | Icon library references | User needs icon recommendations |
| `google-fonts` | Google Fonts database | User wants specific font families |

## Supported Tech Stacks

| Stack | Domain ID | File |
|-------|-----------|------|
| React | `react` | stacks/react.csv |
| Next.js | `nextjs` | stacks/nextjs.csv |
| Vue | `vue` | stacks/vue.csv |
| Svelte | `svelte` | stacks/svelte.csv |
| Astro | `astro` | stacks/astro.csv |
| SwiftUI | `swiftui` | stacks/swiftui.csv |
| React Native | `react-native` | stacks/react-native.csv |
| Flutter | `flutter` | stacks/flutter.csv |
| NuxtJS | `nuxtjs` | stacks/nuxtjs.csv |
| Nuxt UI | `nuxt-ui` | stacks/nuxt-ui.csv |
| HTML + Tailwind | `html-tailwind` | stacks/html-tailwind.csv |
| shadcn/ui | `shadcn` | stacks/shadcn.csv |
| Jetpack Compose | `jetpack-compose` | stacks/jetpack-compose.csv |
| Three.js | `threejs` | stacks/threejs.csv |
| Angular | `angular` | stacks/angular.csv |
| Laravel | `laravel` | stacks/laravel.csv |

## Usage Commands

```bash
# Search UI styles
python3 scripts/search.py "glassmorphism dashboard" --domain style

# Search color palettes
python3 scripts/search.py "SaaS blue" --domain color

# Search font pairings
python3 scripts/search.py "modern serif heading" --domain typography

# Search UX guidelines
python3 scripts/search.py "touch target" --domain ux

# Stack-specific guidelines
python3 scripts/search.py "component structure" --stack react
python3 scripts/search.py "routing" --stack nextjs
python3 scripts/search.py "animations" --stack flutter

# Generate complete design system
python3 scripts/search.py "SaaS dashboard" --design-system -p "My Project"

# Generate and persist to design-system/MASTER.md
python3 scripts/search.py "e-commerce luxury" --design-system --persist -p "Luxury Store"

# With page-specific override
python3 scripts/search.py "e-commerce luxury" --design-system --persist -p "Luxury Store" --page "product-detail"

# Output as markdown
python3 scripts/search.py "fintech app" --design-system -p "FinApp" --format markdown

# JSON output
python3 scripts/search.py "minimalism" --domain style --json
```

## Design System Generation (--design-system flag)

When `--design-system` is used, the engine:
1. Searches the `product` domain to detect the product category
2. Applies reasoning rules from `ui-reasoning.csv` for that category
3. Multi-domain search across style, color, typography, and landing
4. Selects best matches using priority scoring
5. Outputs a complete design system with:
   - **Pattern**: Landing page structure, CTA placement, section order
   - **Style**: UI style name, effects, performance, accessibility
   - **Colors**: Full palette (primary, secondary, accent, background, foreground, muted, border, destructive, ring)
   - **Typography**: Heading/body fonts, mood, Google Fonts URLs
   - **Key Effects**: Animation and interaction recommendations
   - **Anti-Patterns**: Design patterns to avoid
   - **Pre-Delivery Checklist**: Accessibility and UX checks

## Persistence (--persist flag)

When `--persist` is used with `--design-system`:
- Creates `design-system/<project-slug>/MASTER.md` -- the global source of truth
- Optionally creates `design-system/<project-slug>/pages/<page>.md` for page-specific overrides
- Uses the Master + Overrides pattern: page files override MASTER.md for their specific page

## BM25 Search Engine

The search engine uses the BM25 ranking algorithm (same as Elasticsearch):
- Tokenizes queries and documents
- Computes IDF scores for rarity weighting
- Ranks results by term frequency and document length normalization
- Auto-detects the best domain from query keywords

## Files

| File | Purpose |
|------|---------|
| `scripts/search.py` | Main CLI entry point |
| `scripts/core.py` | BM25 search engine + domain detection |
| `scripts/design_system.py` | Design system generator + formatter |
| `data/styles.csv` | 67 UI style definitions |
| `data/colors.csv` | 161 color palettes |
| `data/typography.csv` | 57 font pairings |
| `data/products.csv` | 99 product type mappings |
| `data/landing.csv` | Landing page patterns |
| `data/charts.csv` | 25 chart type recommendations |
| `data/ux-guidelines.csv` | 99 UX/accessibility guidelines |
| `data/icons.csv` | Icon library references |
| `data/google-fonts.csv` | Google Fonts database |
| `data/ui-reasoning.csv` | Category-based reasoning rules |
| `data/stacks/*.csv` | Framework-specific guidelines (16 stacks) |
