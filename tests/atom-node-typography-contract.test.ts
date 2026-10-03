import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync(
  new URL("../src/styles.css", import.meta.url),
  "utf8",
);

function cssRule(selector: string): string {
  const marker = `${selector} {`;
  const selectorStart = styles.indexOf(marker);
  assert.notEqual(selectorStart, -1, `Missing CSS selector: ${selector}`);
  const bodyStart = styles.indexOf("{", selectorStart);
  const bodyEnd = styles.indexOf("}", bodyStart);
  assert.notEqual(bodyStart, -1, `Missing CSS body: ${selector}`);
  assert.notEqual(bodyEnd, -1, `Unclosed CSS body: ${selector}`);
  return styles.slice(bodyStart + 1, bodyEnd);
}

test("keeps atoms fixed while enlarging their primary text", () => {
  const node = cssRule(".harness-node");

  assert.match(node, /width:\s*180px/);
  assert.match(node, /height:\s*60px/);
  assert.match(node, /grid-template-rows:\s*20px 14px/);
  assert.match(node, /padding:\s*8px 9px 14px/);
  assert.match(cssRule(".harness-node > strong"), /font-size:\s*12px/);
  assert.match(cssRule(".harness-node__meta small"), /font-size:\s*8\.5px/);
  assert.match(cssRule(".harness-node__meta i"), /font-size:\s*8px/);
});

test("anchors enlarged corner badges to the right and clips long content", () => {
  for (const selector of [".harness-node__count", ".harness-node__focus"]) {
    const rule = cssRule(selector);
    assert.match(rule, /position:\s*absolute/);
    assert.match(rule, /right:\s*0/);
    assert.match(rule, /max-width:\s*\d+px/);
    assert.match(rule, /overflow:\s*hidden/);
    assert.match(rule, /text-overflow:\s*ellipsis/);
    assert.match(rule, /white-space:\s*nowrap/);
  }
  assert.match(cssRule(".harness-node__count"), /font-size:\s*8px/);
  const focus = cssRule(".harness-node__focus");
  assert.match(focus, /bottom:\s*0/);
  assert.match(focus, /font-size:\s*7px/);
});
