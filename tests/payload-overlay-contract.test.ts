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
  // The `{ __html }` wrapper is memoized on the string: React compares the
  // wrapper object by identity, and an inline literal re-set identical
  // markup on every app tick — recreating the children and resetting any
  // horizontal scroll inside a wide code block about once a second.
  assert.match(overlay, /dangerouslySetInnerHTML=\{previewHtml\}/);
  assert.match(overlay, /\(\) => \(\{ __html: preview\.contentHtml \}\)/);
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

test("related data renders array elements as indexed group rows", () => {
  // The field walk emits one header row per element (`questions[0]`,
  // `options[1]`); the pane prints it as a section marker and indents the
  // members beneath, so repeated bare keys stay attributable.
  const previewLib = readFileSync(
    new URL("../src/lib/payload-preview.ts", import.meta.url),
    "utf8",
  );
  assert.match(previewLib, /groupHeader: true/);
  assert.match(overlay, /field\.groupHeader/);
  assert.match(overlay, /payload-overlay__field--group/);
  assert.match(overlay, /paddingInlineStart/);
  assert.match(stylesForOverlay, /\.payload-overlay__field--group \{/);
});

test("the markdown reading surface carries its own code language and token map", () => {
  // The fence renderer labels the block with its sanitized language; the
  // badge lives outside the scrolling <pre>, so wide code pans under it.
  const previewPipeline = readFileSync(
    new URL("../src/lib/markdown-preview.ts", import.meta.url),
    "utf8",
  );
  assert.match(previewPipeline, /class="md-code" data-lang="\$\{language\}"/);
  assert.match(stylesForOverlay, /\.md-code__lang \{/);
  // Every token class the registered grammars emit gets a colour; the
  // name/key family uses the dedicated accent instead of near-white text.
  assert.match(stylesForOverlay, /--code-accent: #7dd3fc/);
  assert.match(stylesForOverlay, /--code-accent: #0369a1/);
  assert.match(stylesForOverlay, /\.hljs-attr,\n\.markdown-preview pre code \.hljs-attribute/);
  assert.match(stylesForOverlay, /\.hljs-addition \{[^}]*--teal/);
  assert.match(stylesForOverlay, /\.hljs-deletion \{[^}]*--red/);
  // GFM task lists swap the marker for the checkbox.
  assert.match(stylesForOverlay, /li:has\(> input\[type="checkbox"\]\)/);
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
  // Structured questions win over the flattened Markdown for every row;
  // free-form message / plan text stays gated to question-keyed rows so a
  // prompt or command payload is never swallowed by the Question heading.
  assert.match(
    overlay,
    /question\.prompts\.length \|\|\s*\n\s*\(variant === "question" &&\s*\n\s*\(question\.message\.trim\(\) \|\| question\.plan\.trim\(\)\)\)/,
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
  // scroll only the rail list's own scrollTop, never a selection change and
  // never `scrollIntoView` (which walks every scrollable ancestor and would
  // yank the content pane's horizontal scroll back to the start).
  assert.match(overlay, /const row = selectedRowRef\.current;/);
  assert.match(overlay, /closest<HTMLElement>\("\.payload-overlay__atom-list"\)/);
  assert.match(overlay, /list\.scrollTop = rowBottom - list\.clientHeight/);
  assert.doesNotMatch(overlay, /scrollIntoView/);
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
 * The overlay's duration badge uses the same stepped ladder as the LOG list:
 * `formatDurationMs` lives in the shared `src/lib/duration-label.ts` module,
 * so the same closed pair reads with the same unit in both surfaces. No
 * second composite formatter may grow in the overlay.
 */
test("the overlay's duration badge shares the LOG unit ladder", () => {
  assert.match(app, /import \{ formatDurationMs \} from "\.\/lib\/duration-label";/);
  assert.match(railBinding, /formatDurationMs\(pairDuration\)/);
  assert.doesNotMatch(app, /formatOverlayDuration/);
  assert.doesNotMatch(app, /function formatDurationMs\(milliseconds: number\)/);
});

/**
 * The rail has its own search box: rail-local state filtering the chain over
 * the rows' display fields AND the row event's payload content (deep match
 * through the shared per-event haystacks the LOG warms), with the same
 * deferred-needle pattern the LOG uses, so a keystroke re-renders only the
 * rail. The head is one row — growing search input with a clear button,
 * jump-to-edge buttons, Live toggle. The jump buttons stay mounted
 * with reserved width and disable the unreachable edge, beside the search box
 * rather than floating over the chain.
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
    "the search box sits before the jump buttons and the Live toggle",
  );
  assert.match(overlay, /aria-label="清空搜索"/);
  assert.match(stylesForOverlay, /\.payload-overlay__rail-search \{\s*\n\s*flex: 1;\s*\n\s*min-width: 0;/);
  // Quick jump to either end lives in the head beside the search box, never as
  // a floating overlay over the chain, and the width is reserved so the input
  // beside it never shifts as the list scrolls.
  const searchAt = overlay.indexOf('className="payload-overlay__rail-search"');
  const controlsAt = overlay.indexOf("payload-overlay__rail-scroll-controls");
  const followAt = overlay.indexOf("payload-overlay__follow");
  assert.ok(
    searchAt < controlsAt && controlsAt < followAt,
    "the jump buttons sit between the search box and the Live toggle",
  );
  assert.match(overlay, /aria-label="滚动到顶部"/);
  assert.match(overlay, /aria-label="滚动到底部"/);
  assert.match(overlay, /disabled=\{!railEdges\.canScrollUp\}/);
  assert.match(overlay, /disabled=\{!railEdges\.canScrollDown\}/);
  assert.match(overlay, /scrollRailToEdge\("top"\)/);
  assert.match(overlay, /scrollRailToEdge\("bottom"\)/);
  assert.match(overlay, /onScroll=\{syncRailEdges\}/);
  assert.match(
    stylesForOverlay,
    /\.payload-overlay__rail-scroll-controls \{\s*\n\s*display: flex;\s*\n\s*flex: 0 0 48px;/,
  );
});

/**
 * The dialog title is a formal product name plus the inspected content, not a
 * raw atom label with an uppercase tab suffix. The per-event identity stays in
 * the rail and the eyebrow; the title reads as a named inspection surface.
 */
test("the overlay title names the inspection surface instead of the event label", () => {
  assert.match(overlayBinding, /label=\{`事件载荷检视 · /);
  assert.match(overlayBinding, /"输入载荷"/);
  assert.match(overlayBinding, /"输出载荷"/);
  assert.match(overlayBinding, /"原始数据"/);
  assert.doesNotMatch(overlayBinding, /inspectorTitle/);
});

/**
 * The two preview panes keep their titles pinned: 「原子内容」 / 「相关数据」
 * stay put while their bodies scroll under them. The related pane has no
 * section-wide fold — each value folds on its own instead.
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
  assert.match(
    overlay,
    /payload-overlay__pane-head">\s*\n\s*<h4 className="payload-overlay__pane-title">相关数据<\/h4>/,
  );
  assert.match(
    overlay,
    /payload-overlay__pane-title">相关数据<\/h4>[\s\S]*?<div\s*\n?\s*className="payload-overlay__body payload-overlay__related-body"/,
  );
});

/**
 * Folding is per related-data value, not per pane: a long path or blob gets
 * its own 展开 control while the short fields beside it stay readable. No
 * pane-wide cap may reappear — that was the bug this replaced.
 */
test("related values fold individually, never the whole pane", () => {
  const preview = readFileSync(
    new URL("../src/lib/payload-preview.ts", import.meta.url),
    "utf8",
  );
  assert.match(preview, /export const RELATED_VALUE_MAX_CHARS = 200;/);
  assert.match(preview, /export function isFoldableRelatedValue/);
  // A per-value component owns its own expanded state.
  assert.match(overlay, /function RelatedValue\(\{ value \}: \{ value: string \}\)/);
  assert.match(overlay, /const \[expanded, setExpanded\] = useState\(false\)/);
  assert.match(overlay, /isFoldableRelatedValue\(value\)/);
  assert.match(overlay, /value\.slice\(0, RELATED_VALUE_MAX_CHARS\)/);
  assert.match(overlay, /<dd><RelatedValue value=\{field\.value\} \/><\/dd>/);
  assert.match(overlay, /className="payload-overlay__field-more"/);
  // The old section-wide fold is gone.
  assert.doesNotMatch(overlay, /relatedExpanded/);
  assert.doesNotMatch(overlay, /related-toggle/);
  assert.doesNotMatch(stylesForOverlay, /\.payload-overlay__related-body\.is-folded/);
  assert.doesNotMatch(stylesForOverlay, /\.payload-overlay__related-toggle \{/);
});

/**
 * The reader's position belongs to the reader. While a run executes, following
 * advances the selection to every new event — and a streamed message arrives
 * as a new event every ~800ms — so the preview content is replaced under the
 * reader; the panes' scroll must survive that (the memo restores it) and only
 * a row the reader picked themselves re-anchors to the top.
 */
test("a follow advance keeps the reader's scroll; picking a row re-anchors", () => {
  // The panes' scroll is memoised by their onScroll handlers (ref writes
  // only — a streamed batch must not re-render to record a position).
  assert.match(overlay, /const readerScrollRef = useRef\(\{/);
  assert.match(overlay, /onScroll=\{handleContentScroll\}/);
  assert.match(overlay, /onScroll=\{handleRelatedScroll\}/);
  // Restore after the commit: the layout effect runs on every preview change
  // and puts the memo back, so the line the reader was on stays put.
  assert.match(overlay, /content\.scrollTop = memo\.contentTop;/);
  assert.match(overlay, /content\.scrollLeft = memo\.contentLeft;/);
  assert.match(
    overlay,
    /\}, \[preview\.contentHtml, selectedEventId, viewMode\]\);/,
  );
  // A rail pick is the one re-anchor: the click marks the row, the effect
  // consumes the mark and zeroes both panes.
  assert.match(overlay, /railPickedEventRef\.current = atom\.id;/);
  assert.match(overlay, /if \(picked && picked === selectedEventId\) \{/);
  assert.match(overlay, /content\.scrollTop = 0;/);
  // The Code view unmounts the panes and starts the memo over.
  assert.match(overlay, /if \(!content\) \{/);
  // Wide Markdown tables scroll inside their own block, like fenced code —
  // the pane wraps prose and never widens for one wide element.
  assert.match(
    stylesForOverlay,
    /\.payload-overlay \.markdown-preview table \{[\s*\S]*?overflow-x: auto;/,
  );
});

/**
 * The content pane previews the payload's *core* information — the tool
 * result, the prompt, the message content — rendered by its type (Markdown
 * lists, highlighted code, a structured patch as a diff), never the raw
 * envelope. The core extractor is the shared `payloadToMarkdown`, which now
 * also reads the camel `toolResponse` spelling and renders a structured patch
 * as a highlighted diff.
 */
test("the related pane lists every captured field, not just metadata", () => {
  assert.match(overlay, /collectPayloadFields\(payload\)/);
  const previewLib = readFileSync(
    new URL("../src/lib/payload-preview.ts", import.meta.url),
    "utf8",
  );
  assert.match(previewLib, /export function collectPayloadFields/);
  assert.match(previewLib, /value === "" \? '""'/);
  // Content keys are no longer dropped from the field inventory.
  assert.doesNotMatch(previewLib, /related\/\*content only\*\//);
});

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

/**
 * The recorder normalizes `toolInput` / `toolResponse` onto the snake names
 * even when the producer only carried the camel spelling, so an empty `{}` can
 * sit beside real content. That placeholder must never shadow the next
 * spelling — an empty tool_input once blanked every tool call's Input preview
 * while `toolInput.command` was right there.
 */
test("an empty tool_input placeholder never shadows the real spelling", () => {
  assert.match(app, /function payloadField\(/);
  assert.match(
    app,
    /payloadField\(\s*\n\s*boundEvent\.payload\.tool_input,\s*\n\s*boundEvent\.payload\.toolInput,\s*\n\s*\) \?\? boundEvent\.payload/,
  );
  assert.match(
    app,
    /payloadField\(\s*\n\s*boundEvent\.payload\.tool_response,\s*\n\s*boundEvent\.payload\.toolResponse,\s*\n\s*\) \?\? boundEvent\.payload/,
  );
  // The shadowing pattern is gone from every payload resolution.
  assert.doesNotMatch(app, /payload\.tool_input \|\|\s*\n\s*payload\.toolInput/);
  assert.doesNotMatch(app, /payload\.tool_response \|\|\s*\n\s*payload\.toolResponse/);
});

/**
 * Reader comfort in the global layer: a live batch must not reset the content
 * pane's scroll, each pane's scroll region keeps its own padding, the jump
 * buttons carry a tinted surface and a pointer cursor, and the Live control is
 * legible at rest with a larger hover response.
 */
test("scroll, padding and control polish keep the reading surface stable", () => {
  // Scroll confined to the rail, never scrollIntoView on all ancestors.
  assert.doesNotMatch(overlay, /scrollIntoView/);
  assert.match(overlay, /list\.scrollTop = rowTop/);

  // Padding moved off the pane onto head + body so the scroll region has an
  // inset on all sides while the bar still hugs the pane edge.
  assert.match(stylesForOverlay, /\.payload-overlay__pane--content \{\s*\n\s*min-width: 0;/);
  assert.match(
    stylesForOverlay,
    /\.payload-overlay__pane \.payload-overlay__body \{[\s*\S]*?padding: 10px 18px 20px;/,
  );
  assert.match(
    stylesForOverlay,
    /\.payload-overlay__pane--related \.payload-overlay__body \{[\s*\S]*?padding: 0 16px 20px;/,
  );

  // The rail head no longer prints a "LOG · N" counter beside the search box.
  assert.doesNotMatch(overlay, /payload-overlay__rail-title/);
  assert.doesNotMatch(stylesForOverlay, /\.payload-overlay__rail-title/);

  // Jump buttons: a tinted resting surface and a pointer cursor, with a dimmer
  // surface and the plain arrow on the disabled edge.
  assert.match(
    stylesForOverlay,
    /\.payload-overlay__rail-scroll-button \{[\s*\S]*?background: color-mix\(in srgb, var\(--selection-border\) 14%, var\(--panel-raised\)\);[\s*\S]*?cursor: pointer;/,
  );
  assert.match(
    stylesForOverlay,
    /\.payload-overlay__rail-scroll-button:disabled \{[\s*\S]*?background: color-mix\(in srgb, var\(--panel-raised\) 72%, transparent\);[\s*\S]*?cursor: default;/,
  );

  // Live: visible default background, stronger hover with a ring.
  assert.match(
    stylesForOverlay,
    /\.payload-overlay__follow \{[\s*\S]*?background: color-mix\(in srgb, var\(--panel-raised\) 70%, transparent\);/,
  );
  assert.match(
    stylesForOverlay,
    /\.payload-overlay__follow:hover:not\(:disabled\) \{[\s*\S]*?box-shadow: 0 0 0 3px/,
  );
});
