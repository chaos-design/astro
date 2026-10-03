import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync(
  new URL("../src/styles.css", import.meta.url),
  "utf8",
);

function cssRule(selector: string): string {
  const marker = selector.endsWith(",") ? selector : `${selector} {`;
  const selectorStart = styles.indexOf(marker);
  assert.notEqual(selectorStart, -1, `Missing CSS selector: ${selector}`);
  const bodyStart = styles.indexOf("{", selectorStart);
  const bodyEnd = styles.indexOf("}", bodyStart);
  assert.notEqual(bodyStart, -1, `Missing CSS body: ${selector}`);
  assert.notEqual(bodyEnd, -1, `Unclosed CSS body: ${selector}`);
  return styles.slice(bodyStart + 1, bodyEnd);
}

test("uses route type colors for every default edge style", () => {
  assert.match(cssRule(".flow-edge-line"), /stroke:\s*var\(--route-execution\)/);
  assert.match(
    cssRule(".flow-edge--data .flow-edge-line"),
    /stroke:\s*var\(--route-data\)/,
  );
  assert.match(
    cssRule(".flow-edge--feedback .flow-edge-line"),
    /stroke:\s*var\(--route-feedback\)/,
  );
  assert.match(
    cssRule(".flow-edge--persistence .flow-edge-line"),
    /stroke:\s*var\(--route-persistence\)/,
  );
});

test("keeps lifecycle states from overriding route colors and line types", () => {
  const activeLine = cssRule(".flow-edge-route.is-active .flow-edge-line");
  const completeLine = cssRule(".flow-edge-route.is-complete .flow-edge-line");
  const activePort = cssRule(".flow-edge-route.is-active .flow-edge-port");

  assert.doesNotMatch(activeLine, /\bstroke\s*:/);
  assert.doesNotMatch(activeLine, /stroke-dasharray/);
  assert.doesNotMatch(completeLine, /\bstroke\s*:/);
  assert.doesNotMatch(activePort, /\bfill\s*:/);
});

test("uses a separate hover color for lines, ports, and arrowheads", () => {
  assert.match(
    cssRule(".flow-edge-route:hover .flow-edge-line"),
    /stroke:\s*var\(--edge-highlight\)/,
  );
  assert.match(
    cssRule(".flow-edge-route.is-focused .flow-edge-port,"),
    /fill:\s*var\(--edge-highlight\)/,
  );
  assert.match(
    cssRule(".flow-arrow-execution,"),
    /fill:\s*context-stroke/,
  );
});
