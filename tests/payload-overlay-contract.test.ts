import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const overlay = readFileSync(
  new URL("../src/components/payload-overlay.tsx", import.meta.url),
  "utf8",
);
const app = readFileSync(new URL("../src/app.tsx", import.meta.url), "utf8");
const stylesForOverlay = readFileSync(
  new URL("../src/styles.css", import.meta.url),
  "utf8",
);
const railBinding = app.slice(
  app.indexOf("const overlayAtoms"),
  app.indexOf("const overlayEventById"),
);
const overlayBinding = app.slice(
  app.indexOf("<PayloadOverlay"),
  app.indexOf("</section>", app.indexOf("<PayloadOverlay")),
);

/**
 * The global layer follows the atom's type: a user.question Input tab shows
 * the question / option / answer list the reader saw, while every other tab
 * reads as Markdown. Both must keep using one preview definition each.
 */
test("the overlay switches preview by atom type", () => {
  assert.match(overlay, /variant === "question"/);
  assert.match(overlay, /<QuestionPreview payload=\{activePayload as TracePayload\} \/>/);
  assert.match(overlay, /USER QUESTION/);
  assert.match(overlay, /dangerouslySetInnerHTML=\{\{ __html: preview\.contentHtml \}\}/);
});

test("the preview splits the atom's content from its related data", () => {
  assert.match(overlay, /splitPayloadPreview/);
  assert.match(overlay, /contentToMarkdown/);
  assert.match(overlay, /payload-overlay__pane--content/);
  assert.match(overlay, /payload-overlay__pane--related/);
  assert.match(overlay, /payload-overlay__fields/);
  assert.match(stylesForOverlay, /\.payload-overlay__preview-grid/);
  assert.match(stylesForOverlay, /\.payload-overlay__field\.is-annotation/);
});

test("prepared previews are cached per row and scoped by the inspector tab", () => {
  assert.match(overlay, /useRef<Map<string, PreparedPreview>>/);
  assert.match(overlay, /cache\.get\(rowKey\)/);
  assert.match(overlay, /cache\.set\(rowKey, prepared\)/);
  // One row's payload depends on which tab the layer was opened from, so the
  // cache key carries that scope and a tab switch re-resolves.
  assert.match(overlay, /cacheScope/);
  assert.match(overlay, /payloadForAtom/);
  assert.match(overlay, /variantForAtom/);
  assert.match(overlayBinding, /cacheScope=\{activeTab\}/);
});

test("the global overlay keeps both Preview and the raw JSON Code view", () => {
  assert.match(overlay, /<JsonViewer value=\{activePayload\} \/>/);
  assert.match(overlay, /Code2/);
  assert.match(overlay, /ToggleGroup/);
  assert.match(overlay, /viewMode/);
  assert.match(overlay, /value="preview"/);
  assert.match(overlay, /value="code"/);
  // The rendered content leads; Code is the raw form one toggle away.
  assert.ok(overlay.indexOf("viewMode === \"preview\"") < overlay.indexOf("payload-overlay__body--code"));
  assert.match(overlay, /切到 Code 查看原始载荷/);
});

test("an answers-only question falls back to the markdown answer preview", () => {
  assert.match(overlay, /parseUserQuestionContent/);
  assert.match(overlay, /showQuestion \?/);
  assert.match(
    overlay,
    /question\.prompts\.length \|\| question\.message\.trim\(\) \|\| question\.plan\.trim\(\)/,
  );
});

test("the inspector passes the raw question payload for question atoms", () => {
  assert.match(
    overlayBinding,
    /activeTab === "input" && questionEvent\s*\? questionEvent\.payload/,
  );
  assert.match(
    overlayBinding,
    /variant=\{activeTab === "input" && questionEvent \? "question" : "default"\}/,
  );
});

test("the inspector passes the raw prompt payload so the overlay previews its content", () => {
  assert.match(
    overlayBinding,
    /activeTab === "input" && promptEvent\s*\? promptEvent\.payload/,
  );
});

/**
 * The left rail is the run's message chain: every event of the run, newest
 * first, split by the LOG's turn separators. The pipeline-atom rail could not
 * reproduce the chain — each atom aggregated all events of its type and bound
 * only the newest one — so the rail now reads the same `buildLogEntries`
 * result the LOG list prints, one row per event with LOG row numbers.
 */
test("the overlay rail is the run's message chain built from the LOG's own entries", () => {
  assert.match(railBinding, /buildLogEntries\(activeEvents, platformId\)/);
  // One data standard with the LOG list: the same builder yields the row
  // number, turn, pair duration and pair link the LOG row prints.
  assert.match(railBinding, /sequence: formatLogSequence\(index \+ 1\)/);
  assert.match(railBinding, /turn,/);
  assert.match(railBinding, /pairDuration,/);
  assert.match(railBinding, /pairLink,/);
  assert.match(railBinding, /atomType\?\.label \?\? ""/);
  assert.match(railBinding, /eventMeta\[event\.eventName\]\?\.tone/);
  // The chain must reach the harness atom the event commits to.
  assert.match(railBinding, /atomId: getAtomIdForEvent\(event, platformId\)/);
});

test("the rail splits the chain by turn with position-keyed separators", () => {
  assert.match(overlay, /atom\.turn !== previousTurn/);
  assert.match(overlay, /kind: "turn", turn: atom\.turn/);
  assert.match(overlay, /className="atomic-log__turn payload-overlay__turn"/);
  // Key by position, never by the turn value: two groups can legitimately
  // repeat a number, and duplicate keys leave orphaned chips behind.
  assert.match(overlay, /key=\{`rail-turn-\$\{railIndex\}`\}/);
  assert.doesNotMatch(overlay, /key=\{`rail-turn-\$\{item\.turn\}`\}/);
});

test("the rail renders newest first with each row keeping its LOG number", () => {
  // The newest-first reversal runs over the (optionally search-filtered)
  // source list, so a filtered chain keeps its order.
  assert.match(overlay, /\[\.\.\.source\]\.reverse\(\)/);
  assert.match(overlay, /<span className="log-sequence">\{atom\.sequence\}<\/span>/);
});

test("the rail row is the LOG row, not a second row imitation", () => {
  assert.match(overlay, /"atomic-log__row payload-overlay__atom"/);
  assert.match(overlay, /className="log-sequence"/);
  assert.match(overlay, /className="atomic-log__name"/);
  assert.match(overlay, /className="atomic-log__key"/);
  assert.match(overlay, /<time dateTime=\{atom\.timestamp\}/);
  assert.match(overlay, /className="atomic-log__summary"/);
  // Execution duration: the closed-pair badge the LOG row prints, with heat.
  assert.match(overlay, /atomic-log__duration heat-\$\{atom\.durationHeat\}/);
  assert.match(overlay, /成对耗时/);
  // Pair cross-reference marker, shared with the LOG and trajectory.
  assert.match(overlay, /<PairLinkMarker/);
  assert.match(stylesForOverlay, /\.payload-overlay__rail \.atomic-log__row \{/);
  assert.match(overlay, /payload-overlay__atom-type/);
  assert.match(overlay, /`tone-\$\{atom\.tone \|\| "unknown"\}`/);
  assert.match(overlay, /handleAtomKeyDown/);
  assert.match(stylesForOverlay, /\.payload-overlay__atom\.tone-tool \{[\s\S]*?--log-tone: var\(--amber\)/);
});

test("the rail stays readable: wider grid, larger type, wrapping names", () => {
  // The rail is wide enough for a full event key — no more `trajectory.pr…`.
  assert.match(
    stylesForOverlay,
    /\.payload-overlay__rail \{[\s\S]*?width: clamp\(236px, 26%, 384px\)/,
  );
  assert.match(
    stylesForOverlay,
    /\.payload-overlay__rail \.atomic-log__row \{[\s\S]*?grid-template-columns: 34px 6px minmax\(0, 1fr\) 72px/,
  );
  // The key and summary wrap instead of ellipsizing away the content. The
  // overrides must out-rank the base `.atomic-log__row …` rules (same layer,
  // later source), so they carry the row scope too.
  assert.match(
    stylesForOverlay,
    /\.payload-overlay__rail \.atomic-log__row \.atomic-log__key \{[\s\S]*?overflow-wrap: anywhere/,
  );
  assert.match(
    stylesForOverlay,
    /\.payload-overlay__rail \.atomic-log__row \.atomic-log__summary \{[\s\S]*?-webkit-line-clamp: 2/,
  );
  // One step larger than the LOG panel.
  assert.match(
    stylesForOverlay,
    /\.payload-overlay__rail \.atomic-log__row strong\.atomic-log__name \{[\s\S]*?font-size: var\(--text-body\)/,
  );
});

test("the LOG and the rail share one row-gap token, with a wider rail value", () => {
  // Both lists reuse `.atomic-log__row`; the gap belongs to one definition.
  assert.match(stylesForOverlay, /--log-row-gap: 6px;/);
  assert.match(
    stylesForOverlay,
    /\.atomic-log__list \{[\s\S]*?gap: var\(--log-row-gap\);/,
  );
  assert.match(
    stylesForOverlay,
    /\.payload-overlay__atom-list \{[\s\S]*?--log-row-gap: 10px;[\s\S]*?gap: var\(--log-row-gap\);/,
  );
});

test("the inspector threads the chain, selection and follow into the overlay", () => {
  assert.match(overlayBinding, /atoms=\{overlayAtoms\}/);
  assert.match(overlayBinding, /selectedEventId=\{overlaySelectedEventId\}/);
  assert.match(overlayBinding, /onSelectAtom=\{onOverlaySelectEvent\}/);
  assert.match(overlayBinding, /runningEventId=\{overlayRunningEventId\}/);
  assert.match(overlayBinding, /following=\{overlayFollowing\}/);
  assert.match(overlayBinding, /followAvailable=\{overlayFollowAvailable\}/);
  assert.match(overlayBinding, /onFollowingChange=\{onOverlayFollowingChange\}/);
});

/**
 * Picking a rail row commits the same state the LOG's own select handler
 * writes — the picked event plus the harness atom it maps to — so the rail,
 * LOG, canvas and inspector cannot disagree about what is selected.
 */
test("the rail and the LOG share one event-selection commit", () => {
  assert.match(
    app,
    /const handleOverlaySelectEvent = useCallback\(\s*\n\s*\(atomId: string, eventId: string\) => \{/,
  );
  assert.match(
    app,
    /handleOverlaySelectEvent[\s\S]*?setSelectedAtomId\(atomId \|\| null\);\s*\n\s*setSelectedEventId\(eventId\);/,
  );
  // The payload of a picked row resolves the row's own event, not just the
  // atom's newest one.
  assert.match(
    app,
    /const rowEvent = eventId \? overlayEventById\.get\(eventId\) \?\? null : null;/,
  );
});

/**
 * The rail header's 跟随 toggle mirrors the console's live following: arming
 * restores the follow state, disarming pins the current atom, and the toggle
 * is only armable while the open run executes.
 */
test("the rail's follow toggle mirrors the console's live following", () => {
  assert.match(overlay, /aria-pressed=\{following\}/);
  assert.match(overlay, /onFollowingChange\(!following\)/);
  // The recorded status decides availability, so the toggle is never dead on
  // a run whose capsule still reads RUNNING.
  assert.match(overlay, /disabled=\{!followAvailable\}/);
  // Armed, the rail keeps the selected row in view as new events land —
  // scroll only, never a selection change.
  assert.match(
    overlay,
    /if \(!open \|\| !following\) \{\s*\n\s*return;\s*\n\s*\}\s*\n\s*selectedRowRef\.current\?\.scrollIntoView/,
  );
  assert.match(
    app,
    /const handleOverlayFollowingChange = useCallback\(/,
  );
  assert.match(
    app,
    /handleOverlayFollowingChange[\s\S]*?setSelectedAtomId\(undefined\);\s*\n\s*setSelectedEventId\(latestPromptRun\?\.events\.at\(-1\)\?\.id \|\| ""\);/,
  );
  assert.match(
    app,
    /handleOverlayFollowingChange[\s\S]*?setSelectedAtomId\(currentAtomId \|\| null\);/,
  );
  assert.match(
    app,
    /overlayFollowing=\{overlayFollowing\}/,
  );
  assert.match(
    app,
    /overlayFollowAvailable=\{overlayFollowAvailable\}/,
  );
  // Availability keys off the *recorded* status (the RUNNING capsule the RUN
  // HISTORY card keeps printing, STALE included) — a finished run has nothing
  // to follow; a silent-but-recorded-running run stays clickable.
  assert.match(
    app,
    /const sessionRecordedStatus = activeSession\s*\n\s*\? getRunHistoryDisplayStatus\(activeSession\.status, activePromptRuns\)/,
  );
  assert.match(
    app,
    /overlayFollowAvailable =\s*\n\s*Boolean\(activeSession\) &&\s*\n\s*!isDemo &&\s*\n\s*!replayMode &&\s*\n\s*isLiveRunStatus\(sessionRecordedStatus\)/,
  );
  // Armed is the follow posture: no explicit atom selection, so a genuinely
  // executing message keeps advancing to its newest atom.
  assert.match(
    app,
    /const overlayFollowing =\s*\n\s*overlayFollowAvailable && selectedAtomId === undefined;/,
  );
  // Arming rides the session's newest prompt run, like the footer Live jump.
  assert.match(
    app,
    /handleOverlayFollowingChange[\s\S]*?latestPromptRun\.key !== activePromptRunKey[\s\S]*?setActivePromptRunKey\(latestPromptRun\.key\)/,
  );
});

test("the follow toggle reads as the console's Live mark with a breathing halo", () => {
  assert.match(overlay, />\s*Live\s*<\/button>/);
  assert.match(stylesForOverlay, /\.payload-overlay__follow\.is-armed \{[\s\S]*?animation: payload-follow-breathe/);
  assert.match(stylesForOverlay, /@keyframes payload-follow-breathe/);
});

/**
 * Rail rows carry no hover styling: the list is scanned for one selected step,
 * and sweeping the pointer must not repaint rows (selected / running / pair
 * partner rows keep their own state, which the base :hover rule would
 * otherwise out-rank).
 */
test("rail rows keep no hover styling but the selected row reads strongly", () => {
  assert.match(
    stylesForOverlay,
    /\.payload-overlay__rail\s*\n\s*\.atomic-log__row:hover:not\(\.is-selected\):not\(\.is-running\):not\(\.is-pair-partner\)/,
  );
  assert.match(
    stylesForOverlay,
    /\.payload-overlay__rail \.atomic-log__row\.is-selected strong\.atomic-log__name \{[\s\S]*?font-size: 12px/,
  );
});

/**
 * A payload whose split has no prose (arguments, contract envelopes,
 * structured results) still renders: its JSON is dumped as a highlighted code
 * block instead of an empty pane, so switching rows always changes the
 * content the reader sees.
 */
test("a payload without prose falls back to highlighted JSON", () => {
  assert.match(overlay, /split\.content\.trim\(\)/);
  assert.match(overlay, /fallbackPayloadMarkdown\(payload\)/);
  // The fallback lives in the one preview-definition module the overlay
  // imports from; no second dump heuristic grows in the component.
  assert.match(
    overlay,
    /import \{\s*\n\s*contentToMarkdown,\s*\n\s*fallbackPayloadMarkdown,/,
  );
});

/**
 * The overlay's duration badge keeps the exact milliseconds: the global layer
 * exists to inspect ONE step's latency, where the lists' stepped units would
 * round away the digits being inspected. The LOG and trajectory badges keep
 * their stepped `formatDurationMs`.
 */
test("the overlay's duration badge keeps exact milliseconds", () => {
  assert.match(app, /function formatDurationMsExact\(milliseconds: number\)/);
  assert.match(railBinding, /formatDurationMsExact\(pairDuration\)/);
  assert.match(app, /function formatDurationMs\(milliseconds: number\)/);
});

/**
 * The rail has its own search box: rail-local state filtering the chain over
 * the rows' display fields AND the row event's payload content (deep match
 * through the shared per-event haystacks the LOG warms), with the same
 * deferred-needle pattern the LOG uses, so a keystroke re-renders only the
 * rail. The head is one row — counter, growing search input with a clear
 * button, Live toggle.
 */
test("the rail filters its chain through a local search box", () => {
  assert.match(overlay, /const \[query, setQuery\] = useState\(""\)/);
  assert.match(overlay, /useDeferredValue\(query\)/);
  assert.match(overlay, /placeholder="搜索事件或内容"/);
  assert.match(overlay, /没有匹配的事件/);
  // Deep content match rides the caller's callback.
  assert.match(overlay, /searchEvent\?\.\(atom\.id, needle\)/);
  assert.match(
    app,
    /const overlaySearchEvent = useCallback\(\s*\n\s*\(eventId: string, needle: string\) => \{\s*\n\s*const event = overlayEventById\.get\(eventId\);\s*\n\s*return event \? matchesEventQuery\(event, needle\) : false;/,
  );
  assert.match(overlayBinding, /searchEvent=\{overlaySearchEvent\}/);
  // One row: the search box lives inside the head, with a clear button.
  assert.match(overlay, /className="payload-overlay__rail-head">/);
  assert.ok(
    overlay.indexOf('className="payload-overlay__rail-search"') <
      overlay.indexOf("payload-overlay__follow"),
    "the search box sits between the counter and the Live toggle",
  );
  assert.match(overlay, /aria-label="清空搜索"/);
  assert.match(stylesForOverlay, /\.payload-overlay__rail-search \{\s*\n\s*flex: 1;\s*\n\s*min-width: 0;/);
});

/**
 * The two preview panes keep their titles pinned: 「原子内容」 / 「相关数据」
 * stay put while their bodies scroll under them. The related pane's head also
 * carries its fold toggle.
 */
test("the pane titles stay pinned while their bodies scroll", () => {
  assert.match(
    stylesForOverlay,
    /\.payload-overlay__pane \{[\s\S]*?overflow: hidden/,
  );
  assert.match(
    stylesForOverlay,
    /\.payload-overlay__pane \.payload-overlay__body \{[\s\S]*?overflow: auto/,
  );
  // The related pane wraps its fields in the same scrolling body, under a
  // head that carries the fold toggle.
  assert.match(
    overlay,
    /payload-overlay__pane-head">\s*\n\s*<h4 className="payload-overlay__pane-title">相关数据<\/h4>/,
  );
  assert.match(
    overlay,
    /payload-overlay__pane-title">相关数据<\/h4>[\s\S]*?<div\s*\n?\s*className=\{cn\(\s*\n\s*"payload-overlay__body payload-overlay__related-body"/,
  );
});

/**
 * The related pane folds by default: its body is capped so the content pane
 * keeps the room, and one toggle expands it downward (and collapses again).
 */
test("the related data folds behind an expand toggle", () => {
  assert.match(overlay, /const \[relatedExpanded, setRelatedExpanded\] = useState\(false\)/);
  assert.match(overlay, /aria-expanded=\{relatedExpanded\}/);
  assert.match(overlay, /\{relatedExpanded \? "收起" : "展开"\}/);
  assert.match(
    overlay,
    /!relatedExpanded && preview\.related\.length > 0 && "is-folded"/,
  );
  assert.match(
    stylesForOverlay,
    /\.payload-overlay__related-body\.is-folded \{\s*\n\s*max-height: 200px;/,
  );
  assert.match(stylesForOverlay, /\.payload-overlay__related-toggle \{/);
});

/**
 * The content pane previews the payload's *core* information — the tool
 * result, the prompt, the message content — rendered by its type (Markdown
 * lists, highlighted code, a structured patch as a diff), never the raw
 * envelope. The core extractor is the shared `payloadToMarkdown`, which now
 * also reads the camel `toolResponse` spelling and renders a structured patch
 * as a highlighted diff.
 */
test("the content pane extracts the payload's core information", () => {
  assert.match(overlay, /payloadToMarkdown\(payload\) \|\| fallbackPayloadMarkdown\(payload\)/);
  const markdown = readFileSync(
    new URL("../src/lib/payload-markdown.ts", import.meta.url),
    "utf8",
  );
  assert.match(markdown, /"toolResponse",/);
  assert.match(markdown, /function structuredPatchToMarkdown/);
  assert.match(markdown, /Fenced as `diff`/);
  assert.match(markdown, /findPatchMarkdown\(value, depth, new WeakSet\(\)\)/);
});
