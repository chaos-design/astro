import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const platformIcon = readFileSync(
  new URL("../src/components/platform-icon.tsx", import.meta.url),
  "utf8",
);
const agentIcons = readFileSync(
  new URL("../src/components/agent-icons.tsx", import.meta.url),
  "utf8",
);

/**
 * Every agent mark must be paintable in the frame the dropdown opens.
 *
 * DeepSeek and WorkBuddy used to be `public/icons` rasters (`<img loading=lazy>`
 * and an SVG `<image>`). Both are async resources, so the picker painted an
 * empty, dark icon slot first and the mark popped in a frame later — every
 * time it opened. DeepSeek is an inline path now and WorkBuddy is an inlined
 * data URI, so neither waits on the network or the decoder.
 */
test("agent marks are inline, not lazily fetched", () => {
  assert.match(agentIcons, /DeepSeekIcon/);
  assert.match(platformIcon, /deepseek: DeepSeekIcon/);
  assert.match(platformIcon, /workbuddy-icon\.png\?inline/);
  // The WorkBuddy branch is a raster <img>, not an SVG <image> child: only the
  // former can be forced to decode before paint.
  assert.match(platformIcon, /platform === "workbuddy"[\s\S]{0,700}<img/);
  assert.match(platformIcon, /decoding="sync"/);
  assert.doesNotMatch(platformIcon, /loading="lazy"/);
  assert.doesNotMatch(platformIcon, /icons\/workbuddy-logo\.png/);
});

/**
 * lucide-react 1.42's `createLucideIcon` maps its path nodes into `<path>`
 * elements without keys, so every multi-path brand mark warned on every render
 * ("Each child in a list should have a unique key prop"). The marks are built
 * by a local factory that keys each node instead.
 */
test("brand glyphs are built locally with keyed path nodes", () => {
  assert.doesNotMatch(agentIcons, /from "lucide-react"/);
  assert.doesNotMatch(agentIcons, /=\s*createLucideIcon\(/);
  assert.match(agentIcons, /function createBrandIcon\(/);
  const factory = agentIcons.match(
    /function createBrandIcon\([\s\S]*?\n\}/,
  );
  assert.ok(factory, "the local SVG factory must exist");
  assert.match(factory[0], /forwardRef<SVGSVGElement, SVGProps<SVGSVGElement>>/);
  assert.match(factory[0], /nodes\.map\(\(\[tag, attrs\], index\)/);
  assert.match(factory[0], /createElement\(tag, \{ key: index, \.\.\.attrs \}\)/);
  assert.match(factory[0], /viewBox: "0 0 24 24"/);
  assert.match(agentIcons, /PiAgentIcon = createBrandIcon\(/);
  assert.match(agentIcons, /OthersAgentIcon = createBrandIcon\(/);
});
