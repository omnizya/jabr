# ⵣ JABR — Concept Design Specification & Art Prompt Vault

> **Project:** JABR (جبر) — The Alchemical Grid
> **Designer / Creator:** Mohamed MOUGHAMIR (محمد مغامر) <https://moughamir.github.io>
> **Status:** Spec — ready for image generation
> **Date:** 2026-08-28
> **Target Image Model:** Nano Banana (Gemini 3 Pro Image) via 9Router (`gemini/gemini-3-pro-image-preview`)
> **Companion Doc:** [`REBRANDING.md`](./REBRANDING.md) — lore, roster, and refactoring strategy

---

## 1. Global Art Direction — "Kasbah-Punk" (Moroccan Futurism)

Every asset in the JABR universe shares one coherent visual language: **the ancient Moroccan kasbah re-imagined as a living holographic supercomputer**. Islamic geometry, Amazigh symbolism, and Golden Age science are rendered through the lens of Code Lyoko's virtual sectors and Iron Man's holographic HUDs.

### 1.1 Style Pillars

| Pillar | Description |
| :--- | :--- |
| **Sacred Geometry** | Zellige tessellations, 8-pointed khatam stars, arabesque vines, and geometric lattices as the *circuit boards* of the grid. |
| **Kasbah Architecture** | Horseshoe arches, crenellated ramparts, minaret silhouettes, mashrabiya lattice screens — glowing from within like a supercomputer. |
| **Alchemical Light** | Gold arc-reactor cores, athanor furnaces, alembic glassware, transmutation circles. Raw code = base metal; finished work = gold. |
| **Lyoko Virtualization** | Hexagonal sector grids, materialization towers (الصوامع), cyan holographic scan-lines, digital glitch edges. |
| **Amazigh Identity** | Tifinagh glyphs (ⵣ), woven Berber carpet patterns, desert-berber jewelry, indigo Tuareg tones. |

### 1.2 Master Palette (Design Tokens)

| Token | Hex | Usage |
| :--- | :--- | :--- |
| `kasbah-night` | `#0F1B33` | Base background — deep indigo night |
| `kasbah-indigo` | `#1B2A4A` | Secondary surfaces |
| `alchemy-gold` | `#D4AF37` | Primary accent — cores, highlights, arc energy |
| `gold-glow` | `#F0C75E` | Emission / bloom |
| `zellige-emerald` | `#1F7A5C` | Lyoko circuit green |
| `cyber-teal` | `#2DD4BF` | Hologram scan-lines |
| `majorelle-blue` | `#6050DC` | Magic / virtual energy |
| `terracotta` | `#C0563B` | Moroccan clay — warmth, earth |
| `sand-ivory` | `#F2E8D5` | Light / text / highlights |

### 1.3 Recurring Motifs (Use in Every Prompt)

- 8-pointed khatam star (seal of the prophets' geometry)
- Zellige tessellation as circuit traces
- Tifinagh glyph **ⵣ** (the free man / Amazigh identity)
- Astrolabe rings and engraved brass
- Alchemical transmutation circle (athanor)
- Hexagonal Lyoko sector grid
- Holographic HUD rings (Stark-style, but with arabesque filigree)
- Mashrabiya lattice light-casting
- Horseshoe arch portals
- Floating brass-and-glass alembic instruments

### 1.4 Composition & Lighting Rules

- **Light source:** Always a glowing core (arc reactor / athanor / astrolabe) — rim-light the subject with gold, fill with indigo night.
- **Depth:** Foreground geometric lattice → midground subject → background kasbah skyline or virtual sector grid.
- **Camera:** Cinematic 35mm, shallow depth of field, slight low-angle hero shot for agents.
- **Texture:** Engraved brass, carved plaster (tadelakt), woven wool, glowing glass.
- **Noise:** Zero photographic grain; clean digital painting.

### 1.5 Prompt Engineering Notes (Nano Banana)

- Write prompts as **flowing descriptive prose**, not bullet lists — image models respond better to narrative description.
- Always close with the **style suffix** (Section 1.6) for consistency.
- End every prompt with: *"No text, no letters, no watermark, no signature."*
- Generate at **16:9** for environment/hero shots, **1:1** for character portraits, **9:16** for vertical HUD/banner art.
- For a consistent cast, generate **one reference portrait first**, then describe other agents as *"same art style and palette as the reference, but…"*.

### 1.6 Universal Style Suffix (Append to Every Prompt)

> *"Moroccan-futurism concept art, kasbah-punk aesthetic, cinematic digital painting, intricate Islamic geometric patterns, glowing holographic HUD elements, alchemical gold and deep indigo night palette, zellige circuit traces, Tifinagh glyph accents, volumetric light through mashrabiya lattice, ArtStation quality, octane render, 4k detail. No text, no letters, no watermark, no signature."*

---

## 2. Agent Concept Specs

---

### 👑 2.1 JABIR (جابر) — The Alchemical Operator *(Orchestrator · Port 4000)*

**Lore:** The central intelligence at the primary terminal of the Virtual Kasbah — Jeremy Belpois' console fused with J.A.R.V.I.S. and the father of chemistry, Jabir ibn Hayyan.

**Visual Identity:**

- **Silhouette:** A commanding figure seated at (or standing before) a massive floating holographic console; or a disembodied intelligence manifesting as a golden geometric core.
- **Signature object:** The **Alchemical Astrolabe Console** — a brass astrolabe whose rings are holographic task-routing displays.
- **Costume:** Dark indigo robe with gold zellige embroidery; a glowing athanor core embedded in the chest (arc-reactor position).
- **Environment:** The Grand Control Chamber — a kasbah dome whose ceiling is a rotating astrolabe projection of all agent towers.

**Palette:** kasbah-night base, alchemy-gold core, cyber-teal HUD, sand-ivory light.

**Motifs:** Astrolabe rings, athanor core, 8-pointed star, holographic routing lines connecting 7 tower icons.

**Composition:** Low-angle hero shot, gold core rim-lighting, holographic console rings encircling the figure, background shows 7 glowing towers.

> **🖼️ PROMPT (16:9 hero):**
> *"A commanding Moroccan-futurist figure, the Alchemical Operator of a virtual kasbah supercomputer, standing before a massive floating brass astrolabe console whose engraved rings project holographic task-routing displays in glowing cyan and gold. He wears a deep indigo robe embroidered with gold zellige geometric patterns, and a radiant golden athanor core glows in his chest like an arc reactor. Around him, seven holographic towers rise in a circle, each pulsing with a different colored energy. The chamber is a grand kasbah dome with horseshoe arches and mashrabiya lattice screens casting geometric light patterns. Volumetric god-rays, gold rim lighting against deep indigo night, holographic HUD rings with arabesque filigree orbiting his hands. Moroccan-futurism concept art, kasbah-punk aesthetic, cinematic digital painting, intricate Islamic geometric patterns, glowing holographic HUD elements, alchemical gold and deep indigo night palette, zellige circuit traces, Tifinagh glyph accents, volumetric light through mashrabiya lattice, ArtStation quality, octane render, 4k detail. No text, no letters, no watermark, no signature."*

---

### 🦉 2.2 RUSHD (ابن رشد) — The Rational Sage *(Oracle · Port 4001)*

**Lore:** Averroës — the Great Commentator — invoked for architecture, review, and the stripping of the non-essential. Franz Hopper's calm creator-wisdom.

**Visual Identity:**

- **Silhouette:** An elder sage in flowing robes, seated in contemplation, surrounded by floating holographic code scrolls being simplified into pure geometric forms.
- **Signature object:** The **Commentary Codex** — a floating book of light whose pages dissolve into clean geometric axioms.
- **Costume:** Ivory and deep-green robes (Andalusian scholar), a brass astrolabe pendant, silver beard.
- **Environment:** The House of Wisdom library — endless arches of bookshelves where books are holograms being distilled into light.

**Palette:** sand-ivory dominant, zellige-emerald accents, gold trim, kasbah-indigo shadows.

**Motifs:** Open book of light, dissolving code → geometry, horseshoe arches, minaret library.

**Composition:** Symmetrical, centered, calm — a still point of clarity; warm golden library light.

> **🖼️ PROMPT (16:9):**
> *"A serene elder Moroccan-Andalusian sage, the Great Commentator of a virtual house of wisdom, seated cross-legged on a carved brass platform in a vast library of horseshoe arches. He wears flowing ivory robes with deep emerald trim and a brass astrolabe pendant; a silver beard, calm wise eyes. Before him floats a luminous open codex whose pages dissolve into clean glowing geometric axioms — triangles, circles, perfect squares — symbolizing the simplification of complex code. Around him, holographic bookshelves stretch into infinity, each book a shimmering projection being distilled into pure light. Warm golden volumetric light through mashrabiya screens, emerald and gold accents against deep indigo shadows, symmetrical composition, meditative stillness. Moroccan-futurism concept art, kasbah-punk aesthetic, cinematic digital painting, intricate Islamic geometric patterns, glowing holographic HUD elements, alchemical gold and deep indigo night palette, zellige circuit traces, Tifinagh glyph accents, volumetric light through mashrabiya lattice, ArtStation quality, octane render, 4k detail. No text, no letters, no watermark, no signature."*

---

### 📜 2.3 FIHRIYA (الفهرية) — The Qarawiyyin Custodian *(Librarian · Port 4002)*

**Lore:** Fatima al-Fihriya, founder of the world's oldest university in Fez — fused with Aelita, the guardian of Lyoko's core. Keeper of every document, skill, and memory.

**Visual Identity:**

- **Silhouette:** A graceful guardian figure in indigo-and-gold robes, holding a glowing staff topped with an open-book emblem; a halo of floating holographic scrolls and skill-runes orbiting her.
- **Signature object:** The **Qarawiyyin Staff** — a brass staff whose head is an open book radiating catalog light.
- **Costume:** Indigo hijab-adjacent flowing robes with gold zellige embroidery, Berber silver jewelry, a belt of glowing skill-rune talismans.
- **Environment:** The Great Library of al-Qarawiyyin — a colossal domed hall with a central fountain, where holographic books fly like birds between arches.

**Palette:** kasbah-indigo, alchemy-gold, cyber-teal holograms, sand-ivory.

**Motifs:** Open-book staff, flying holographic manuscripts, fountain of light, zellige floor mandala.

**Composition:** Heroic three-quarter view, staff as vertical axis, halo of orbiting documents, fountain light from below.

> **🖼️ PROMPT (16:9):**
> *"A graceful Moroccan-futurist guardian librarian, the custodian of an ancient virtual university, standing in the center of a colossal domed hall inspired by al-Qarawiyyin in Fez. She wears flowing indigo robes embroidered with gold zellige patterns, Berber silver jewelry, and a belt of small glowing talismans shaped like skill runes. In her right hand she holds a tall brass staff crowned with a radiant open book that casts catalog light. Around her, holographic manuscripts and glowing scrolls fly between horseshoe arches like luminous birds. A central marble fountain glows with cyan light from below, reflecting off a zellige floor mandala. Her gaze is calm and protective, haloed by orbiting holographic documents. Moroccan-futurism concept art, kasbah-punk aesthetic, cinematic digital painting, intricate Islamic geometric patterns, glowing holographic HUD elements, alchemical gold and deep indigo night palette, zellige circuit traces, Tifinagh glyph accents, volumetric light through mashrabiya lattice, ArtStation quality, octane render, 4k detail. No text, no letters, no watermark, no signature."*

---

### 🧭 2.4 BATTUTA (ابن بطوطة) — The Astrolabe Voyager *(Explorer · Port 4003)*

**Lore:** Ibn Battuta of Tangier — the man who traveled farther than anyone before him — fused with Al-Idrisi's cartography and Lyoko's overbike recon.

**Visual Identity:**

- **Silhouette:** A lean traveler in motion, cloak billowing, riding a glowing holographic overbike or striding across a map made of light; a brass astrolabe compass in hand.
- **Signature object:** The **Astrolabe Compass** — a handheld brass astrolabe projecting a holographic map of the codebase terrain.
- **Costume:** Travel-worn desert cloak (burnous) with indigo dye, leather satchel, brass goggles with holographic lenses, Tifinagh scarf.
- **Environment:** A shifting terrain of glowing directory trees and file pyramids rendered as desert dunes and kasbah ruins on a holographic map.

**Palette:** terracotta, sand-ivory, cyber-teal map lines, gold compass.

**Motifs:** Astrolabe projection, dune-like directory hills, glowing waypoint markers, compass rose with 8-pointed star.

**Composition:** Dynamic diagonal motion, cloak trailing, map light sweeping beneath, low sun/moon duality.

> **🖼️ PROMPT (16:9):**
> *"A lean Moroccan-futurist explorer, the great voyager of a virtual world, striding dynamically across a glowing holographic map that renders directory trees as desert dunes and kasbah ruins. He wears a travel-worn indigo burnous cloak billowing behind him, brass goggles with glowing cyan lenses, a Tifinagh-patterned scarf, and a leather satchel. In his raised hand he holds a brass astrolabe compass projecting a holographic map with glowing waypoint markers and an 8-pointed compass rose. The terrain beneath him is a fusion of terracotta desert and translucent cyber-teal data lines, with hexagonal Lyoko sector grids faintly visible in the sky. Motion lines, dynamic diagonal composition, warm terracotta and gold against deep indigo night, holographic map light sweeping under his feet. Moroccan-futurism concept art, kasbah-punk aesthetic, cinematic digital painting, intricate Islamic geometric patterns, glowing holographic HUD elements, alchemical gold and deep indigo night palette, zellige circuit traces, Tifinagh glyph accents, volumetric light through mashrabiya lattice, ArtStation quality, octane render, 4k detail. No text, no letters, no watermark, no signature."*

---

### 📐 2.5 FIRNAS (ابن فرناس) — The Flying Polymath *(Designer · Port 4004)*

**Lore:** Abbas Ibn Firnas — the Berber-Andalusian who built wings and flew, crafted glass, and designed mechanical planetariums — fused with Stark's holographic design studio.

**Visual Identity:**

- **Silhouette:** A visionary inventor mid-flight or standing in a holographic design studio, arms extended, shaping glowing geometric UI wireframes with his hands.
- **Signature object:** The **Winged HUD** — a feathered mechanical wing of brass and light on his back, its feathers projecting holographic design grids.
- **Costume:** Artisan's tunic with geometric embroidery, leather apron with brass tools, goggles, one mechanical brass-and-glass hand.
- **Environment:** A design atelier where zellige tiles float as 3D wireframes, waiting to be assembled into interfaces; planetarium dome ceiling.

**Palette:** majorelle-blue holograms, alchemy-gold, sand-ivory, zellige-emerald accents.

**Motifs:** Mechanical wings, floating zellige tiles, wireframe grids, planetarium rings, glass lenses.

**Composition:** Ascending diagonal, wings spread, hands conducting light, tiles orbiting like planets.

> **🖼️ PROMPT (16:9):**
> *"A visionary Moroccan-futurist inventor, the flying polymath of a virtual design atelier, suspended mid-air with magnificent mechanical wings of brass and glowing glass feathers spread wide. Each feather projects a holographic design grid, and with his outstretched hands he conducts floating zellige tiles that are transforming into 3D interface wireframes — buttons, cards, and layout grids made of light. He wears an artisan's tunic with geometric embroidery, a leather apron with brass tools, and one mechanical hand of engraved brass and glass. Behind him, a planetarium dome ceiling projects rotating astrolabe rings, and holographic color swatches orbit like small planets. Majorelle blue and gold holograms against deep indigo night, ascending diagonal composition, wings catching golden rim light. Moroccan-futurism concept art, kasbah-punk aesthetic, cinematic digital painting, intricate Islamic geometric patterns, glowing holographic HUD elements, alchemical gold and deep indigo night palette, zellige circuit traces, Tifinagh glyph accents, volumetric light through mashrabiya lattice, ArtStation quality, octane render, 4k detail. No text, no letters, no watermark, no signature."*

---

### ⚔️ 2.6 TARIQ (طارق) — The Iron Vanguard *(Fixer · Port 4005)*

**Lore:** Tariq ibn Ziyad — the general who burned his ships: *"The sea behind you, the enemy ahead"* — fused with Ulrich's triplicate speed and Stark's armor forge.

**Visual Identity:**

- **Silhouette:** A kinetic warrior in dark armor, mid-strike, leaving afterimages (triplicate motion echoes), wielding a blade of pure code-light.
- **Signature object:** The **Codeblade** — a scimitar whose edge is a glowing line of source code; and the **Forge Gauntlet** — a Stark-style gauntlet that deploys repair nanites.
- **Costume:** Matte-black kasbah armor with gold zellige inlay, a burnous cape, Tifinagh war-markings glowing on the pauldron.
- **Environment:** The Armor Forge — a foundry of molten gold code, anvils, and holographic repair schematics; sparks of emerald and gold.

**Palette:** kasbah-night armor, alchemy-gold blade, ember-orange forge, cyber-teal afterimages.

**Motifs:** Triplicate motion echoes, code-blade, forge sparks, horseshoe-arch forge entrance.

**Composition:** Dynamic action pose, motion trails, low-angle, ember particles, blade light slicing the frame diagonally.

> **🖼️ PROMPT (16:9):**
> *"A kinetic Moroccan-futurist warrior, the iron vanguard of a virtual forge, captured mid-strike in a dynamic action pose with triplicate motion afterimages trailing behind him. He wears matte-black kasbah armor inlaid with gold zellige patterns, a dark burnous cape, and glowing Tifinagh war-markings on his pauldron. In his hands he wields a curved scimitar whose edge is a razor line of glowing source code, slicing diagonally through the frame. His gauntlet is a Stark-style brass forge gauntlet deploying tiny glowing repair nanites. Behind him, a foundry of molten gold code flows through channels, anvils ring with sparks of emerald and orange, and a horseshoe-arch forge entrance glows with heat. Ember particles, motion trails, low-angle heroic shot, gold blade light against deep indigo shadows. Moroccan-futurism concept art, kasbah-punk aesthetic, cinematic digital painting, intricate Islamic geometric patterns, glowing holographic HUD elements, alchemical gold and deep indigo night palette, zellige circuit traces, Tifinagh glyph accents, volumetric light through mashrabiya lattice, ArtStation quality, octane render, 4k detail. No text, no letters, no watermark, no signature."*

---

### 🧪 2.7 KHWARIZMI (الخوارزمي) — The Algorithm Crucible *(Scientist · Port 4006)*

**Lore:** Al-Khwarizmi — the father of algorithms — commanding the Python crucible, the persistent `.python_env` laboratory. Data in, certainty out.

**Visual Identity:**

- **Silhouette:** A scholar-alchemist standing before a towering glass athanor furnace, manipulating floating equations and data streams with both hands.
- **Signature object:** The **Athanor Furnace** — a colossal alembic of brass and glass glowing with emerald data-liquid; and the **Algorithmic Abacus** — a floating abacus whose beads are glowing numbers.
- **Costume:** Scholar's robe in deep green with gold geometric trim, a brass headpiece with a single lens, ink-stained sleeves.
- **Environment:** The Crucible Laboratory — a circular chamber with zellige floor mandala, floating data-streams, bubbling alembics, and a hexagonal Lyoko sector window.

**Palette:** zellige-emerald data, alchemy-gold, kasbah-indigo, cyber-teal streams.

**Motifs:** Athanor furnace, floating equations, abacus of light, alembic glassware, transmutation circle floor.

**Composition:** Centered, furnace as towering backdrop, data streams spiraling into the furnace, cool emerald light with gold highlights.

> **🖼️ PROMPT (16:9):**
> *"A Moroccan-futurist scholar-alchemist, the master of algorithms, standing before a colossal athanor furnace of engraved brass and glowing glass in a circular laboratory. The furnace bubbles with luminous emerald data-liquid, and streams of glowing numbers and equations spiral through the air into its mouth. He wears a deep green scholar's robe with gold geometric trim, a brass headpiece with a single circular lens, and ink-stained sleeves. With both hands he conducts the floating data-streams, and beside him a floating brass abacus with glowing number-beads hovers at his shoulder. The floor is a zellige mandala forming an alchemical transmutation circle, and a hexagonal Lyoko sector window glows behind the furnace. Cool emerald and cyan light with warm gold highlights, centered composition, the furnace towering like a cathedral. Moroccan-futurism concept art, kasbah-punk aesthetic, cinematic digital painting, intricate Islamic geometric patterns, glowing holographic HUD elements, alchemical gold and deep indigo night palette, zellige circuit traces, Tifinagh glyph accents, volumetric light through mashrabiya lattice, ArtStation quality, octane render, 4k detail. No text, no letters, no watermark, no signature."*

---

### 🛡️ 2.8 WAZIR (الوزير) — The Grand Steward *(Jarvis · Port 1337)*

**Lore:** The ever-watchful vizier — J.A.R.V.I.S. as a Moroccan court steward — patrolling the codebase, watching dependencies, filing improvements into the Diwan.

**Visual Identity:**

- **Silhouette:** A dignified steward figure in court robes, or a floating holographic intelligence manifesting as a golden falcon-eye emblem; a retinue of small glowing scout-orb drones.
- **Signature object:** The **Vigil Eye** — a floating golden eye-of-providence ringed by astrolabe markings; and **Scout Orbs** — small brass drones that scan the terrain.
- **Costume:** Court steward robes in deep blue and gold, a sash of status runes, a small brass crown/headpiece.
- **Environment:** The Watchtower — a high kasbah minaret with 360° holographic surveillance of the codebase terrain; dependency streams flowing like caravan routes.

**Palette:** kasbah-indigo, alchemy-gold eye, cyber-teal scan-lines, sand-ivory.

**Motifs:** Vigil eye, scout orbs, minaret watchtower, caravan-like dependency routes, scan-line sweeps.

**Composition:** Elevated vantage, the eye as focal point, orbs fanning out, panoramic holographic map below.

> **🖼️ PROMPT (16:9):**
> *"A dignified Moroccan-futurist steward, the grand vizier of a virtual realm, standing at the top of a high kasbah minaret watchtower. He wears deep blue court robes with gold embroidery and a sash of glowing status runes, a small brass headpiece, and a calm watchful expression. Above his outstretched hand floats a radiant golden eye-of-providence ringed by astrolabe markings — the vigil eye that never sleeps. Around him, small brass scout-orb drones fan out across a panoramic holographic map of the codebase terrain below, where dependency streams flow like glowing caravan routes across desert dunes rendered as data. Cyan scan-lines sweep across the holographic landscape, and the night sky is deep indigo with gold constellation lines connecting towers. Elevated vantage point, the golden eye as the glowing focal point. Moroccan-futurism concept art, kasbah-punk aesthetic, cinematic digital painting, intricate Islamic geometric patterns, glowing holographic HUD elements, alchemical gold and deep indigo night palette, zellige circuit traces, Tifinagh glyph accents, volumetric light through mashrabiya lattice, ArtStation quality, octane render, 4k detail. No text, no letters, no watermark, no signature."*

---

### 📋 2.9 DIWAN (الديوان) — The Royal Board of Works *(Kanban)*

**Lore:** The administrative registry of the Maghrebi courts — every task decree inscribed, triaged, scheduled, reviewed, and archived. Lyoko's scanner room as a mission-control wall.

**Visual Identity:**

- **Subject:** Not a character — an **environment / interface**. The Diwan is a grand hall whose wall is a colossal holographic kanban board.
- **Signature elements:** Nine glowing columns (triage, todo, scheduled, ready, running, review, blocked, done, archived) rendered as vertical light-pillars; task cards as floating brass tablets with wax-seal status stamps.
- **Environment:** A court hall with horseshoe arches; scribes (small holographic figures) moving cards between columns; a central brass desk with an inkwell that writes in light.

**Palette:** sand-ivory hall, gold pillars, status colors per column (red=blocked, emerald=done, cyan=running).

**Motifs:** Light-pillar columns, brass task tablets, wax-seal stamps, scribe holograms, inkwell of light.

**Composition:** Wide establishing shot, symmetrical hall, the board wall dominating the frame.

> **🖼️ PROMPT (16:9):**
> *"A grand Moroccan-futurist court hall transformed into a colossal holographic task board — the royal registry of works. The far wall is dominated by nine towering vertical light-pillars, each a kanban column glowing in a different color: triage in amber, todo in gold, scheduled in teal, ready in green, running in cyan, review in violet, blocked in red, done in emerald, archived in grey. Between the pillars, floating brass tablets inscribed with glowing task runes move by themselves, stamped with holographic wax seals as they change columns. Small holographic scribe figures glide between the pillars, carrying cards. The hall has horseshoe arches, a zellige floor, and a central brass desk where an inkwell writes glowing calligraphy into the air. Wide symmetrical establishing shot, warm sand-ivory hall with golden light-pillars against deep indigo shadows. Moroccan-futurism concept art, kasbah-punk aesthetic, cinematic digital painting, intricate Islamic geometric patterns, glowing holographic HUD elements, alchemical gold and deep indigo night palette, zellige circuit traces, Tifinagh glyph accents, volumetric light through mashrabiya lattice, ArtStation quality, octane render, 4k detail. No text, no letters, no watermark, no signature."*

---

## 3. Infrastructure Concept Specs

---

### 🚪 3.1 BAB AL-KASBAH (باب القصبة) — The Fortified Gateway *(ACP Bridge)*

**Lore:** The portal connecting the developer's IDE to the virtual realm — a fortified kasbah gate that opens on command.

**Visual Identity:**

- **Subject:** A monumental kasbah gate — a giant horseshoe arch of carved cedar and brass, its doors a glowing holographic membrane.
- **Signature elements:** Twin brass door-leaves etched with zellige and Tifinagh; a holographic membrane shimmering with cyan scan-lines; two guardian lanterns of gold flame; IDE icons faintly glowing on the lintel (without text).
- **Environment:** Night approach — a torch-lit path leading to the gate, kasbah ramparts rising, stars rendered as circuit nodes.

**Palette:** terracotta ramparts, alchemy-gold lanterns, cyber-teal membrane, kasbah-night sky.

**Motifs:** Horseshoe arch, brass door-leaves, holographic membrane, guardian lanterns, circuit-star sky.

**Composition:** Symmetrical frontal view, the glowing membrane as the focal point, path leading the eye in.

> **🖼️ PROMPT (16:9):**
> *"A monumental Moroccan-futurist kasbah gateway at night — the fortified portal to a virtual realm. A giant horseshoe arch of carved cedar and engraved brass stands open, its twin door-leaves etched with zellige geometric patterns and Tifinagh glyphs. Where the doors would close, a shimmering holographic membrane glows with cyan scan-lines, rippling like water made of light. Two guardian lanterns of golden flame flank the arch, and a torch-lit path of carved stone leads to the threshold. Kasbah ramparts with crenellations rise on both sides, and the night sky is deep indigo with stars connected by faint glowing circuit lines. Symmetrical frontal composition, the glowing membrane as the focal point, warm terracotta and gold against cool indigo night. Moroccan-futurism concept art, kasbah-punk aesthetic, cinematic digital painting, intricate Islamic geometric patterns, glowing holographic HUD elements, alchemical gold and deep indigo night palette, zellige circuit traces, Tifinagh glyph accents, volumetric light through mashrabiya lattice, ArtStation quality, octane render, 4k detail. No text, no letters, no watermark, no signature."*

---

### 🌉 3.2 AL-QANTARA (القنطرة) — The Bridge *(A2A Wire Protocol)*

**Lore:** The high-speed telemetry link connecting all specialist towers — a bridge of light across the virtual divide.

**Visual Identity:**

- **Subject:** A bridge of pure light spanning between two glowing towers — the A2A data highway.
- **Signature elements:** Eight parallel light-streams (one per agent, including WAZIR) flowing between tower portals; data packets as glowing birds/fish traveling the streams; the bridge arching like a Moroccan qantara bridge.
- **Environment:** Above a canyon of hexagonal Lyoko sectors; mist of holographic particles; towers at each end with glowing portal arches.

**Palette:** cyber-teal streams, alchemy-gold packets, majorelle-blue towers, kasbah-night canyon.

**Motifs:** Arched light-bridge, parallel data streams, packet-birds, hexagonal sector canyon, portal arches.

**Composition:** Panoramic side view, the arched bridge as the hero line, towers framing both edges.

> **🖼️ PROMPT (16:9):**
> *"A breathtaking Moroccan-futurist bridge of pure light arcing across a canyon of hexagonal virtual sectors — the data highway between agent towers. Eight parallel glowing streams flow along the bridge's curve, each a different color: gold, cyan, emerald, majorelle blue, teal, violet, amber, and rose. Along the streams, luminous data packets travel like flocks of glowing birds and schools of light-fish. At each end of the bridge stands a tall kasbah tower with a glowing horseshoe-arch portal, and holographic mist drifts in the canyon below where hexagonal Lyoko sector grids pulse faintly. Panoramic side view, the arched bridge as the dominant line, towers framing the composition, cool indigo night with vibrant stream colors. Moroccan-futurism concept art, kasbah-punk aesthetic, cinematic digital painting, intricate Islamic geometric patterns, glowing holographic HUD elements, alchemical gold and deep indigo night palette, zellige circuit traces, Tifinagh glyph accents, volumetric light through mashrabiya lattice, ArtStation quality, octane render, 4k detail. No text, no letters, no watermark, no signature."*

---

### ⚗️ 3.3 AL-ANBIQ (الأنبيق) — The Alembic Forge *(MCP Tool Server)*

**Lore:** The distillation apparatus providing filesystem, Python execution, and calculation tools — raw operations in, refined capabilities out.

**Visual Identity:**

- **Subject:** A colossal alembic still — the tool forge — where base-metal inputs are distilled into golden tool-runes.
- **Signature elements:** A brass-and-glass alembic with a glowing emerald liquid; tool-runes (hammer, file, flask, gear) floating out of the condenser as golden sigils; a furnace base with zellige fire-channels.
- **Environment:** A workshop chamber with tool niches in the walls, each niche holding a glowing instrument; steam of holographic particles.

**Palette:** brass + glass, emerald liquid, alchemy-gold runes, ember furnace, kasbah-indigo.

**Motifs:** Alembic still, distillation tubes, floating tool-sigils, fire-channels, workshop niches.

**Composition:** Centered still as hero object, runes spiraling upward, warm furnace glow from below.

> **🖼️ PROMPT (16:9):**
> *"A colossal Moroccan-futurist alembic still — the tool forge of a virtual realm — standing at the center of a workshop chamber. The apparatus is built of engraved brass and thick curved glass, its bulbous body filled with glowing emerald liquid that bubbles and distills through spiral tubes. At the condenser's mouth, golden tool-runes materialize and float upward: a hammer, a file, a flask, a gear, a quill — each a glowing sigil of refined capability. The furnace base burns with ember light through zellige fire-channels carved into the stone floor. Around the chamber, wall niches hold glowing brass instruments, and holographic steam drifts through the air. Centered composition, the alembic as the hero object, golden runes spiraling toward a domed ceiling, warm ember glow from below against deep indigo shadows. Moroccan-futurism concept art, kasbah-punk aesthetic, cinematic digital painting, intricate Islamic geometric patterns, glowing holographic HUD elements, alchemical gold and deep indigo night palette, zellige circuit traces, Tifinagh glyph accents, volumetric light through mashrabiya lattice, ArtStation quality, octane render, 4k detail. No text, no letters, no watermark, no signature."*

---

### ⚖️ 3.4 AL-MIZAN (الميزان) — The Scales of Balance *(Token Budget Governor)*

**Lore:** The token governor that prevents budget exhaustion — the cosmic scales weighing each tower's consumption.

**Visual Identity:**

- **Subject:** A monumental brass balance-scale floating in a void of holographic data.
- **Signature elements:** Two scale-pans — one holding a glowing tower-core, the other a stream of token-light; the beam is an astrolabe arc; a golden needle of equilibrium.
- **Environment:** A circular chamber of light where eight towers' energy streams feed into the scales; the floor is a zellige mandala.

**Palette:** alchemy-gold scales, kasbah-indigo void, cyber-teal streams, emerald balance-light.

**Motifs:** Balance scale, astrolabe beam, token-light streams, equilibrium needle, mandala floor.

**Composition:** Centered, symmetrical, the scales dominating; streams converging from all sides.

> **🖼️ PROMPT (16:9):**
> *"A monumental Moroccan-futurist balance scale floating at the center of a circular chamber of light — the cosmic scales of a virtual realm. The scale is built of engraved brass with an astrolabe-arc beam, and its two pans hang from chains of glowing links. One pan holds a radiant tower-core of golden energy; the other holds a flowing stream of cyan token-light that pours from eight converging holographic channels, one from each direction. A golden needle of equilibrium points perfectly vertical, casting a beam of light onto a zellige mandala floor. The surrounding void is deep indigo with faint hexagonal sector grids, and the scale's brass surfaces reflect warm gold against cool cyan. Perfectly centered and symmetrical, the scales as the dominant object, streams converging from all sides. Moroccan-futurism concept art, kasbah-punk aesthetic, cinematic digital painting, intricate Islamic geometric patterns, glowing holographic HUD elements, alchemical gold and deep indigo night palette, zellige circuit traces, Tifinagh glyph accents, volumetric light through mashrabiya lattice, ArtStation quality, octane render, 4k detail. No text, no letters, no watermark, no signature."*

---

### 🏛️ 3.5 KHIZANAT AL-HIKMA (خزانة الحكمة) — The Royal Vault *(Memory Palace)*

**Lore:** The archival vault of long-term memories — append-only chronicles and indexed knowledge, guarded like a royal treasury.

**Visual Identity:**

- **Subject:** A subterranean treasury hall beneath the kasbah, filled with glowing memory-crystals and chronicle shelves.
- **Signature elements:** Memory-crystals (each a glowing geometric gem containing a memory scene); chronicle shelves of brass-bound books that write themselves; a central vault door of engraved gold.
- **Environment:** A domed crypt with a star-map ceiling; light shafts from above; a river of light (the memory stream) running through the center.

**Palette:** alchemy-gold vault, kasbah-indigo crypt, emerald crystals, sand-ivory light shafts.

**Motifs:** Memory-crystals, self-writing chronicles, vault door, star-map dome, light river.

**Composition:** Deep one-point perspective down the hall, vault door at the far end, crystals lining the walls.

> **🖼️ PROMPT (16:9):**
> *"A subterranean Moroccan-futurist treasury hall — the royal vault of memory beneath a virtual kasbah. The long hall is lined with shelves of brass-bound chronicle books that glow faintly and write themselves with trails of golden light. Between the shelves, floating geometric memory-crystals pulse softly, each gem containing a tiny glowing scene like a frozen moment of history. A river of soft light flows along the center of the floor, reflecting off a star-map dome ceiling. At the far end stands a colossal vault door of engraved gold, its surface covered in zellige patterns and Tifinagh glyphs, radiating warm light through the cracks. Light shafts from above pierce the indigo darkness. Deep one-point perspective down the hall, the golden vault door as the focal point, emerald and gold crystals lining the walls. Moroccan-futurism concept art, kasbah-punk aesthetic, cinematic digital painting, intricate Islamic geometric patterns, glowing holographic HUD elements, alchemical gold and deep indigo night palette, zellige circuit traces, Tifinagh glyph accents, volumetric light through mashrabiya lattice, ArtStation quality, octane render, 4k detail. No text, no letters, no watermark, no signature."*

---

### 3.6 SIRAJ (السراج) — The Lamp *(LLM Gateway)*

**Lore:** The single lamp that illuminates every tower — the shared reasoning flame (9router gateway) that all agents draw from. One light, many rooms.

**Visual Identity:**

- **Subject:** A monumental hanging oil-lamp of engraved brass — the mosque lamp (mishkāt) — suspended in a dark chamber, radiating a single brilliant flame.
- **Signature elements:** The lamp's glass bowl holds a swirling golden flame of pure thought; light-rays project from it into seven (plus one) alcoves, each alcove containing a miniature tower; the lamp's chains are braided circuit traces.
- **Environment:** A dark octagonal chamber; the only light source is the lamp; alcoves in the walls glow as the light reaches them.

**Palette:** alchemy-gold flame, kasbah-night darkness, cyber-teal light-rays, sand-ivory highlights.

**Motifs:** Mosque lamp, braided circuit chains, alcove towers, radial light-rays, octagonal chamber.

**Composition:** Centered, the lamp hanging from above, light-rays fanning radially into the alcoves, strong chiaroscuro.

> **🖼️ PROMPT (16:9):**
> *"A monumental Moroccan-futurist hanging lamp — a great brass mosque lamp suspended from braided circuit-trace chains in the center of a dark octagonal chamber. Its glass bowl holds a swirling golden flame of pure thought, and from it, eight radial light-rays project outward into alcoves set into the walls, each alcove containing a miniature glowing tower in a different color: gold, emerald, cyan, majorelle blue, teal, violet, amber, and rose. The chamber is otherwise plunged in deep indigo darkness, the lamp the single source of illumination, casting warm gold highlights on engraved brass and carved plaster. The floor below is a zellige mandala that catches the light. Centered composition, the lamp hanging from above, strong chiaroscuro, radial light-rays fanning into the alcoves. Moroccan-futurism concept art, kasbah-punk aesthetic, cinematic digital painting, intricate Islamic geometric patterns, glowing holographic HUD elements, alchemical gold and deep indigo night palette, zellige circuit traces, Tifinagh glyph accents, volumetric light through mashrabiya lattice, ArtStation quality, octane render, 4k detail. No text, no letters, no watermark, no signature."*

---

### 3.7 SHURA (الشورى) — The Council *(Consensus / Cognitive Loop)*

**Lore:** The consultative assembly — when a decision matters, all voices are weighed and synthesized into one verdict. The Islamic principle of collective wisdom.

**Visual Identity:**

- **Subject:** A circular council chamber where eight seats surround a central dais; holographic representatives of each tower sit in the seats, their opinions flowing as light-threads into a central synthesis crucible.
- **Signature elements:** Eight throne-seats of brass and velvet arranged in a perfect circle; light-threads of different colors converging into a golden crucible at the center; a judge's gavel of astrolabe brass.
- **Environment:** A domed chamber with a star-map ceiling; the floor is a great zellige mandala with eight points; the central crucible glows brighter as threads merge.

**Palette:** majorelle-blue threads, alchemy-gold crucible, kasbah-indigo chamber, sand-ivory.

**Motifs:** Circular council, eight seats, converging light-threads, synthesis crucible, star-map dome.

**Composition:** Top-down or high-angle view emphasizing the circle; the crucible as the glowing focal point.

> **🖼️ PROMPT (16:9):**
> *"A grand Moroccan-futurist council chamber viewed from a high angle — the consultative assembly of a virtual realm. Eight throne-seats of engraved brass and deep velvet are arranged in a perfect circle on a great zellige mandala floor with eight points. In each seat sits a holographic representative of a different tower, each glowing in their signature color: gold, emerald, cyan, majorelle blue, teal, violet, amber, and rose. From each representative, a thread of colored light flows inward, converging into a radiant golden crucible at the center of the circle, where the threads swirl and merge into a single brilliant verdict-light. A star-map dome ceiling arches above, and the chamber walls are carved with horseshoe-arch niches. High-angle composition emphasizing the perfect circle, the golden synthesis crucible as the glowing focal point, threads of light crossing the mandala floor. Moroccan-futurism concept art, kasbah-punk aesthetic, cinematic digital painting, intricate Islamic geometric patterns, glowing holographic HUD elements, alchemical gold and deep indigo night palette, zellige circuit traces, Tifinagh glyph accents, volumetric light through mashrabiya lattice, ArtStation quality, octane render, 4k detail. No text, no letters, no watermark, no signature."*

---

### 3.8 AL-FIHRIST (الفهرست) — The Index *(Agent Routing / Dynamic Registry)*

**Lore:** The great catalog of the House of Wisdom — the index that knows which scholar to summon for which question. The librarian's card-catalog as a living machine.

**Visual Identity:**

- **Subject:** A towering rotating catalog — a cylindrical brass index (like a great card-catalog carousel) whose drawers are glowing agent-cards.
- **Signature elements:** A rotating cylinder of brass drawers; each drawer pulls out as a glowing agent-card bearing a tower's sigil; a beam of light from above selects a card and projects its tower hologram.
- **Environment:** A tall circular hall; the index cylinder rises through multiple levels; floating index-cards drift like leaves, each seeking its question.

**Palette:** brass + sand-ivory cards, alchemy-gold selection beam, kasbah-indigo hall, cyber-teal data.

**Motifs:** Rotating card-catalog, glowing agent-cards, selection beam, floating index-cards, circular levels.

**Composition:** Vertical composition, the cylinder towering, the selection beam as the hero light.

> **🖼️ PROMPT (16:9):**
> *"A towering Moroccan-futurist catalog machine — a great rotating cylinder of engraved brass drawers rising through a tall circular hall, like a colossal card-catalog carousel. Each drawer is etched with a zellige pattern and pulls out as a glowing agent-card bearing a tower sigil: an astrolabe, an open book, a compass, a wing, a blade, a flask, a staff, and a crown. A vertical beam of golden light descends from a skylight above, selecting one drawer and projecting its full tower hologram into the air above the cylinder. Around the machine, floating index-cards drift like autumn leaves, each glowing faintly as it seeks the question it answers. The hall is deep indigo with circular balconies at multiple levels, and the floor is a zellige compass mandala. Vertical composition, the index cylinder towering through the frame, the golden selection beam as the hero light. Moroccan-futurism concept art, kasbah-punk aesthetic, cinematic digital painting, intricate Islamic geometric patterns, glowing holographic HUD elements, alchemical gold and deep indigo night palette, zellige circuit traces, Tifinagh glyph accents, volumetric light through mashrabiya lattice, ArtStation quality, octane render, 4k detail. No text, no letters, no watermark, no signature."*

---

## 4. System-Level Hero Assets

---

### 4.1 THE GRID — Full System Hero Shot

**Purpose:** The flagship image — the entire JABR ecosystem in one frame.

**Composition:** The Virtual Kasbah supercomputer rising from the desert night; seven towers (agents) arranged in a circle around a central golden dome (JABIR); the A2A bridge (AL-QANTARA) arcing between towers; the Diwan hall glowing within the ramparts; WAZIR's vigil eye hovering above the central dome; the whole structure rendered in zellige circuit patterns.

> **🖼️ PROMPT (16:9):**
> *"An epic wide establishing shot of a colossal Moroccan-futurist supercomputer — a virtual kasbah rising from the desert night. Seven glowing towers arranged in a circle surround a central golden dome, each tower a different color: gold, emerald, cyan, majorelle blue, teal, violet, and amber. Arcs of light bridge between the towers like a data highway. Within the ramparts, a grand hall glows with nine vertical light-pillars, and above the central dome hovers a radiant golden eye ringed by astrolabe markings. The entire structure is built of zellige circuit patterns and horseshoe arches, glowing from within like a living machine. The desert around it is rendered as hexagonal virtual sectors, and the night sky is deep indigo with circuit-constellations. Volumetric god-rays, gold and cyan light against indigo night, epic scale, intricate geometric detail. Moroccan-futurism concept art, kasbah-punk aesthetic, cinematic digital painting, intricate Islamic geometric patterns, glowing holographic HUD elements, alchemical gold and deep indigo night palette, zellige circuit traces, Tifinagh glyph accents, volumetric light through mashrabiya lattice, ArtStation quality, octane render, 4k detail. No text, no letters, no watermark, no signature."*

---

### 4.2 THE EMBLEM — JABR Logo / Seal

**Purpose:** The system mark — used for README, docs, and branding.

**Composition:** An 8-pointed khatam star whose center is an athanor core; the star's points morph into circuit traces; a Tifinagh ⵣ integrated into the center; two astrolabe rings encircling; gold on deep indigo.

> **🖼️ PROMPT (1:1):**
> *"A heraldic emblem for a Moroccan-futurist AI system: an 8-pointed khatam star rendered in glowing gold, its center an alchemical athanor core radiating light. The star's points extend into zellige circuit traces, and a Tifinagh glyph is woven into the center of the core. Two concentric astrolabe rings of engraved brass encircle the star, marked with fine geometric ticks. The emblem floats centered on a deep indigo background with subtle hexagonal sector grid, gold rim-light, symmetrical, flat-vector-meets-octane hybrid, clean silhouette readable at small size. Moroccan-futurism concept art, kasbah-punk aesthetic, intricate Islamic geometric patterns, alchemical gold and deep indigo night palette, Tifinagh glyph accents, ArtStation quality, 4k detail. No text, no letters, no watermark, no signature."*

---

### 4.3 THE COVER — OpenGraph / Social Card

**Purpose:** The 1200×630 (1.91:1) social-share banner — GitHub, X/Twitter, LinkedIn, Discord. Text is intentionally absent; platforms overlay the title via `og:title`.

**Composition (left → right):**

- **Left third:** The golden khatam emblem (4.2) with athanor core and Tifinagh glyph — the brand anchor.
- **Center-right:** The Virtual Kasbah skyline — seven towers around a central golden dome, light arcs bridging them, WAZIR's vigil eye hovering above the dome.
- **Foreground:** Desert floor rendered as hexagonal virtual sectors with zellige circuit traces.
- **Sky:** Deep indigo night with circuit-constellation stars and volumetric god-rays.

> **🖼️ PROMPT (1.91:1):**
> *"A cinematic wide social-share banner for a Moroccan-futurist AI system, 1200 by 630 aspect ratio. On the left third, a large heraldic emblem: an 8-pointed khatam star of glowing gold with an alchemical athanor core at its center and a Tifinagh glyph woven into the core, encircled by two astrolabe rings of engraved brass. On the right two-thirds, a virtual kasbah supercomputer rises from the desert night: seven glowing towers in gold, emerald, cyan, majorelle blue, teal, violet, and amber arranged in a circle around a central golden dome, arcs of light bridging between the towers, and a radiant golden eye ringed by astrolabe markings hovering above the dome. The desert foreground is rendered as hexagonal virtual sectors with zellige circuit traces, and the deep indigo night sky holds circuit-constellation stars and volumetric god-rays. The emblem and the kasbah are visually connected by flowing golden light-trails. Balanced composition, strong left anchor and right horizon, epic scale, no empty margins. Moroccan-futurism concept art, kasbah-punk aesthetic, cinematic digital painting, intricate Islamic geometric patterns, glowing holographic HUD elements, alchemical gold and deep indigo night palette, zellige circuit traces, Tifinagh glyph accents, volumetric light through mashrabiya lattice, ArtStation quality, octane render, 4k detail. No text, no letters, no watermark, no signature."*

**OpenGraph metadata (for the site / repo):**

```html
<meta property="og:title" content="JABR (جبر) — The Alchemical Grid" />
<meta property="og:description" content="A Moroccan-futurist multi-agent operating system. ACP + A2A + MCP, kasbah-punk Golden Age agents, alchemical orchestration." />
<meta property="og:image" content="art/the-cover.png" />
<meta property="og:type" content="website" />
<meta name="twitter:card" content="summary_large_image" />
```

**Favicon / avatar variant:** Crop the emblem (4.2) to a 512×512 square — used as favicon, GitHub avatar, and agent-card thumbnails. Slug: `emblem-512`.

---

## 5. Generation Checklist & Iteration Workflow

1. **Generate the Emblem first** (4.2) — establishes palette and style anchor.
2. **Generate one agent portrait** (e.g., JABIR 2.1) as the cast style reference.
3. **Generate the remaining agents** — reference the cast style for consistency.
4. **Generate infrastructure pieces** (Section 3) — environment style.
5. **Generate the Grid hero shot** (4.1) last — it composes everything.
6. **Iteration rule:** If a generation drifts off-style, re-run with the style suffix (1.6) appended verbatim, and mention *"same style and palette as the previous image"*.
7. **Aspect ratios:** 16:9 for heroes/environments, 1:1 for the emblem and portraits, 9:16 for vertical banners.
8. **File naming convention for saved assets:** `art/<slug>-<variant>.png` — e.g., `art/jabir-hero.png`, `art/emblem-1x1.png`.

---

## 6. Asset Inventory (Target Deliverables)

| # | Asset | Slug | Ratio | Section |
| :--- | :--- | :--- | :--- | :--- |
| 1 | JABIR — Alchemical Operator | `jabir-hero` | 16:9 | 2.1 |
| 2 | RUSHD — Rational Sage | `rushd-hero` | 16:9 | 2.2 |
| 3 | FIHRIYA — Qarawiyyin Custodian | `fihriya-hero` | 16:9 | 2.3 |
| 4 | BATTUTA — Astrolabe Voyager | `battuta-hero` | 16:9 | 2.4 |
| 5 | FIRNAS — Flying Polymath | `firnas-hero` | 16:9 | 2.5 |
| 6 | TARIQ — Iron Vanguard | `tariq-hero` | 16:9 | 2.6 |
| 7 | KHWARIZMI — Algorithm Crucible | `khwarizmi-hero` | 16:9 | 2.7 |
| 8 | WAZIR — Grand Steward | `wazir-hero` | 16:9 | 2.8 |
| 9 | DIWAN — Royal Board of Works | `diwan-hall` | 16:9 | 2.9 |
| 10 | BAB AL-KASBAH — Fortified Gateway | `bab-al-kasbah` | 16:9 | 3.1 |
| 11 | AL-QANTARA — The Bridge | `al-qantara` | 16:9 | 3.2 |
| 12 | AL-ANBIQ — Alembic Forge | `al-anbiq` | 16:9 | 3.3 |
| 13 | AL-MIZAN — Scales of Balance | `al-mizan` | 16:9 | 3.4 |
| 14 | KHIZANAT AL-HIKMA — Royal Vault | `khizanat-al-hikma` | 16:9 | 3.5 |
| 15 | SIRAJ — The Lamp | `siraj` | 16:9 | 3.6 |
| 16 | SHURA — The Council | `shura` | 16:9 | 3.7 |
| 17 | AL-FIHRIST — The Index | `al-fihrist` | 16:9 | 3.8 |
| 18 | THE GRID — System Hero | `the-grid` | 16:9 | 4.1 |
| 19 | THE EMBLEM — JABR Seal | `emblem` | 1:1 | 4.2 |
| 20 | THE COVER — OpenGraph Card | `the-cover` | 1.91:1 | 4.3 |
| 21 | FAVICON — Emblem Square | `emblem-512` | 1:1 | 4.3 |
