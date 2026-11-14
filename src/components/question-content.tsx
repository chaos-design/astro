import { Code2, Eye } from "lucide-react";
import { useMemo, useState } from "react";
import { JsonViewer } from "./json-viewer";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "./ui/toggle-group";
import { renderMarkdownPreview } from "../lib/markdown-preview";
import {
  parseUserQuestionContent,
  type UserQuestionPrompt,
} from "../lib/user-question-content";
import type { TracePayload } from "../types/trace";

type QuestionViewMode = "preview" | "code";

/**
 * The user.question counterpart of PromptContent: the input tab of a question
 * event shows what the reader was asked, rendered as the rich text their
 * client would have shown, with the raw payload one Code toggle away. The
 * toolbar, layout and fallbacks mirror PromptContent so the two inspector
 * previews read as one surface.
 */
export function QuestionContent({ payload }: { payload: TracePayload }) {
  const content = useMemo(() => parseUserQuestionContent(payload), [payload]);
  const [viewMode, setViewMode] = useState<QuestionViewMode>("preview");

  return (
    <div className="prompt-input">
      <div className="prompt-input__toolbar">
        <ToggleGroup
          aria-label="User question view"
          className="prompt-input__mode"
          onValueChange={(value) => {
            if (value) {
              setViewMode(value as QuestionViewMode);
            }
          }}
          spacing={0}
          type="single"
          value={viewMode}
          variant="outline"
        >
          <ToggleGroupItem aria-label="Preview question content" value="preview">
            <Eye data-icon="inline-start" />
            Preview
          </ToggleGroupItem>
          <ToggleGroupItem aria-label="View question payload code" value="code">
            <Code2 data-icon="inline-start" />
            Code
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      {viewMode === "preview" ? (
        <div className="prompt-content">
          {content.prompts.length ? (
            content.prompts.map((prompt, index) => (
              <QuestionPromptSection
                index={index}
                key={`${prompt.title}-${index}`}
                prompt={prompt}
              />
            ))
          ) : content.message ? (
            <section className="prompt-content__section">
              <h3>Question</h3>
              <MarkdownPreview source={content.message} />
            </section>
          ) : (
            <section className="prompt-content__section">
              <p className="prompt-content__empty">
                No question content captured.
              </p>
            </section>
          )}
        </div>
      ) : (
        <div className="prompt-input__code">
          <JsonViewer emptyLabel="No question payload captured." value={payload} />
        </div>
      )}
    </div>
  );
}

function QuestionPromptSection({
  index,
  prompt,
}: {
  index: number;
  prompt: UserQuestionPrompt;
}) {
  return (
    <section className="prompt-content__section">
      <h3>{prompt.title || `Question ${index + 1}`}</h3>
      <MarkdownPreview source={prompt.question} />
      {prompt.options.length ? (
        <ul className="question-content__options">
          {prompt.options.map((option, optionIndex) => (
            <li key={optionIndex}>{option}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function MarkdownPreview({ source }: { source: string }) {
  const render = useMemo(() => renderMarkdownPreview(source), [source]);
  if (!render.valid) {
    // An invalid or empty markdown source renders as the captured text,
    // never as a broken or half-rendered document.
    return (
      <p className="prompt-content__text">
        {source || "No question text captured."}
      </p>
    );
  }
  return (
    <div
      className="markdown-preview"
      dangerouslySetInnerHTML={{ __html: render.html }}
    />
  );
}
