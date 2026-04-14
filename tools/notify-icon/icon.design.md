# Celestial Compass — auriga-cli brand icon

## Movement
**Celestial Compass.** A single luminous letterform held against a dusk-into-
night sky, with Capella — the brightest star of the Auriga constellation —
glinting above the shoulder of the glyph. Navigation as visual grammar.
Restraint as authority.

## Philosophy
The icon exists at thumbnail scale, where every pixel is a commitment. The
composition has room for exactly one gesture and one witness, and nothing
more: a monumental letterform rising out of deep indigo, watched over by a
single star fixed against the night. The gradient moves from a thin warm
gold horizon at the top into deep blue and then into near-black — the moment
dusk gives way to night, when Capella emerges and the sky begins to be read
instead of seen.

The letter is rendered in JetBrainsMono Bold: a developer's typeface, not a
display face, chosen deliberately. This is a brand for a tool that lives in
a terminal. The monospace geometry signals that lineage without compromising
the mark's monumentality at any size.

## Visual expression
Space is absolute. The letter occupies the canvas with confidence and
nothing argues with it — no trim, no frame, no ornament beyond the one small
star. The gradient flows edge to edge, unbroken. The letter sits in
optically-tuned center (not mathematical center — the visual weight of the
apex pulls the glyph upward by a hair). A blurred shadow below and right
gives the mark presence without cartoonish depth. The palette is limited to
five values: the thin gold horizon, deep indigo, night indigo, a warm cream
letter, and a pale gold star. Nothing else.

Capella sits in the upper right quadrant — the position where a navigator
would raise their gaze to take a bearing. It is small but unmistakable. Its
scale is intentional: it must never compete with the letter, only witness it.

## Craftsmanship
This is meticulously crafted: pixel-aligned, rendered at 2× and downsampled
with LANCZOS for edge crispness, letter proportions optically balanced
rather than mechanically placed, the shadow Gaussian-blurred and alpha-tuned
to the gradient's luminance curve so it reads as depth rather than noise.
The star is drawn as a ten-point polygon with a specific inner-to-outer ratio
so it reads as a star and not a burst. It is the product of painstaking
attention to a single gesture — the kind of mark where every refinement
removes something, never adds. Master-level execution in the form of
absolute restraint.

## The subtle reference
Auriga the constellation is the charioteer. Its brightest star, Capella —
Latin for "little she-goat" — has guided navigators for millennia, sitting
nearly at the zenith in northern winter skies. The "A" here is both a letter
and a fixed celestial point, and the star above its shoulder is exactly
where Capella sits in the real constellation relative to the charioteer's
form. Those who know will feel it. Everyone else simply sees a clean mark
in a sky at night.

## Regeneration
The icon and its font ship in `.claude/hooks/` alongside
`generate-auriga-icon.py`. Regenerate with:

    python3 .claude/hooks/generate-auriga-icon.py

JetBrainsMono Bold is vendored under the SIL Open Font License (see
`JetBrainsMono-OFL.txt`).
