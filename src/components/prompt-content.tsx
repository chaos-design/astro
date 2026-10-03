import { Code2, Eye, ImageOff, Quote } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "./ui/button";
import { JsonViewer } from "./json-viewer";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "./ui/sheet";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "./ui/toggle-group";
import { parsePromptContent, type PromptImage } from "../lib/prompt-content";
import type { TracePayload } from "../types/trace";

type PromptViewMode = "preview" | "code";

export function PromptContent({ payload }: { payload: TracePayload }) {
  const content = useMemo(() => parsePromptContent(payload), [payload]);
  const [expandedImage, setExpandedImage] = useState<PromptImage | null>(null);
  const [viewMode, setViewMode] = useState<PromptViewMode>("preview");

  return (
    <div className="prompt-input">
      <div className="prompt-input__toolbar">
        <ToggleGroup
          aria-label="Prompt input view"
          className="prompt-input__mode"
          onValueChange={(value) => {
            if (value) {
              setViewMode(value as PromptViewMode);
            }
          }}
          spacing={0}
          type="single"
          value={viewMode}
          variant="outline"
        >
          <ToggleGroupItem aria-label="Preview prompt input" value="preview">
            <Eye data-icon="inline-start" />
            Preview
          </ToggleGroupItem>
          <ToggleGroupItem aria-label="View prompt input code" value="code">
            <Code2 data-icon="inline-start" />
            Code
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      {viewMode === "preview" ? (
        <div className="prompt-content">
          <section className="prompt-content__section">
            <h3>Prompt</h3>
            <p className="prompt-content__text">
              {content.text || "No prompt text captured."}
            </p>
          </section>
          <section className="prompt-content__section">
            <h3>
              Images <span>{content.images.length}</span>
            </h3>
            {content.images.length ? (
              <div className="prompt-content__images">
                {content.images.map((image) => (
                  <PromptImagePreview
                    image={image}
                    key={image.id}
                    onOpen={setExpandedImage}
                  />
                ))}
              </div>
            ) : (
              <p className="prompt-content__empty">
                No image data in this event.
              </p>
            )}
          </section>
          <section className="prompt-content__section">
            <h3>
              References <span>{content.references.length}</span>
            </h3>
            {content.references.length ? (
              content.references.map((reference) => (
                <article className="prompt-reference" key={reference.id}>
                  <header>
                    <Quote aria-hidden="true" />
                    <span>{reference.title}</span>
                  </header>
                  {reference.source ? <code>{reference.source}</code> : null}
                  <pre>{reference.content}</pre>
                </article>
              ))
            ) : (
              <p className="prompt-content__empty">
                No reference data in this event.
              </p>
            )}
          </section>
        </div>
      ) : (
        <div className="prompt-input__code">
          <JsonViewer
            emptyLabel="No prompt input captured."
            value={payload}
          />
        </div>
      )}
      <Sheet
        open={expandedImage !== null}
        onOpenChange={(open) => {
          if (!open) {
            setExpandedImage(null);
          }
        }}
      >
        <SheetContent className="prompt-image-sheet">
          <SheetHeader>
            <SheetTitle>{expandedImage?.name || "Image"}</SheetTitle>
            <SheetDescription>{expandedImage?.source || "Captured image"}</SheetDescription>
          </SheetHeader>
          {expandedImage?.src ? (
            <img
              alt={expandedImage.name}
              className="prompt-image-sheet__image"
              referrerPolicy="no-referrer"
              src={expandedImage.src}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function PromptImagePreview({
  image,
  onOpen,
}: {
  image: PromptImage;
  onOpen: (image: PromptImage) => void;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <figure className="prompt-image">
      {image.src && !failed ? (
        <Button
          aria-label={`Expand ${image.name}`}
          className="prompt-image__button"
          onClick={() => onOpen(image)}
          type="button"
          variant="console"
        >
          <img
            alt={image.name}
            decoding="async"
            loading="lazy"
            onError={() => setFailed(true)}
            referrerPolicy="no-referrer"
            src={image.src}
          />
        </Button>
      ) : (
        <div className="prompt-image__unavailable" role="status">
          <ImageOff aria-hidden="true" />
          <span>{failed ? "Image unavailable" : "No preview data captured"}</span>
        </div>
      )}
      <figcaption>{image.name}</figcaption>
      {image.source ? <small>{image.source}</small> : null}
    </figure>
  );
}
