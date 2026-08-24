import type { GraphCommentV1 } from "@rino/contracts";
import { ViewportPortal, useReactFlow } from "@xyflow/react";
import {
  memo,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useTranslation } from "react-i18next";

export const DEFAULT_COMMENT_WIDTH = 320;
export const DEFAULT_COMMENT_HEIGHT = 160;
export const MINIMUM_COMMENT_WIDTH = 160;
export const MINIMUM_COMMENT_HEIGHT = 80;

export interface CommentRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CommentGesture {
  kind: "move" | "resize-se" | "resize-sw";
  pointerId: number;
  startClientX: number;
  startClientY: number;
  start: CommentRectangle;
}

interface GraphCommentLayerProps {
  comments: readonly GraphCommentV1[];
  draft?: CommentRectangle;
  editable: boolean;
  selectedCommentId?: string;
  onSelect: (commentId: string | undefined) => void;
  onReplace: (comment: GraphCommentV1) => void;
  onRemove: (commentId: string) => void;
}

function rectangleFor(comment: GraphCommentV1): CommentRectangle {
  return {
    x: comment.position.x,
    y: comment.position.y,
    width: comment.size?.width ?? DEFAULT_COMMENT_WIDTH,
    height: comment.size?.height ?? DEFAULT_COMMENT_HEIGHT,
  };
}

function rectangleForPointer(
  gesture: CommentGesture,
  clientX: number,
  clientY: number,
  zoom: number,
): CommentRectangle {
  const deltaX = (clientX - gesture.startClientX) / zoom;
  const deltaY = (clientY - gesture.startClientY) / zoom;
  if (gesture.kind === "move") {
    return {
      ...gesture.start,
      x: gesture.start.x + deltaX,
      y: gesture.start.y + deltaY,
    };
  }
  if (gesture.kind === "resize-se") {
    return {
      ...gesture.start,
      width: Math.max(MINIMUM_COMMENT_WIDTH, gesture.start.width + deltaX),
      height: Math.max(MINIMUM_COMMENT_HEIGHT, gesture.start.height + deltaY),
    };
  }
  // resize-sw: Left boundary moves (x and width change), bottom boundary moves (height changes)
  const newWidth = Math.max(
    MINIMUM_COMMENT_WIDTH,
    gesture.start.width - deltaX,
  );
  const actualDeltaX = gesture.start.width - newWidth;
  return {
    x: gesture.start.x + actualDeltaX,
    y: gesture.start.y,
    width: newWidth,
    height: Math.max(MINIMUM_COMMENT_HEIGHT, gesture.start.height + deltaY),
  };
}

function GraphComment({
  comment,
  editable,
  selected,
  onSelect,
  onReplace,
}: {
  comment: GraphCommentV1;
  editable: boolean;
  selected: boolean;
  onSelect: () => void;
  onReplace: (comment: GraphCommentV1) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const { getZoom } = useReactFlow();
  const gestureRef = useRef<CommentGesture | undefined>(undefined);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [rectangle, setRectangle] = useState(() => rectangleFor(comment));
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (gestureRef.current === undefined) {
      setRectangle(rectangleFor(comment));
    }
  }, [comment]);

  const startGesture = (
    event: ReactPointerEvent<HTMLElement>,
    kind: CommentGesture["kind"],
  ) => {
    if (!editable || event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    onSelect();
    event.currentTarget.setPointerCapture(event.pointerId);
    gestureRef.current = {
      kind,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      start: rectangle,
    };
  };

  const moveGesture = (event: ReactPointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    if (gesture?.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const nextRectangle = rectangleForPointer(
      gesture,
      event.clientX,
      event.clientY,
      Math.max(getZoom(), 0.01),
    );
    setRectangle(nextRectangle);
    onReplace({
      ...comment,
      position: { x: nextRectangle.x, y: nextRectangle.y },
      size: {
        width: nextRectangle.width,
        height: nextRectangle.height,
      },
    });
  };

  const finishGesture = (event: ReactPointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    if (gesture?.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const finalRectangle = rectangleForPointer(
      gesture,
      event.clientX,
      event.clientY,
      Math.max(getZoom(), 0.01),
    );
    setRectangle(finalRectangle);
    gestureRef.current = undefined;
    onReplace({
      ...comment,
      position: { x: finalRectangle.x, y: finalRectangle.y },
      size: {
        width: finalRectangle.width,
        height: finalRectangle.height,
      },
    });
  };

  return (
    <article
      className="graph-comment"
      data-selected={selected ? "true" : undefined}
      style={{
        left: rectangle.x,
        top: rectangle.y,
        width: rectangle.width,
        height: rectangle.height,
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      <header
        className="graph-comment__header"
        onPointerDown={(event) => {
          if (
            event.target instanceof HTMLButtonElement ||
            (event.target instanceof Element && event.target.closest("button"))
          ) {
            return;
          }
          startGesture(event, "move");
        }}
        onDoubleClick={() => {
          if (editable) {
            setIsEditing(true);
            setTimeout(() => {
              textareaRef.current?.focus();
              textareaRef.current?.select();
            }, 0);
          }
        }}
        onPointerMove={moveGesture}
        onPointerUp={finishGesture}
        onPointerCancel={finishGesture}
      >
        <textarea
          ref={textareaRef}
          className="graph-comment__text nodrag nopan nowheel"
          aria-label={t("graph.comment.textLabel")}
          defaultValue={comment.text}
          maxLength={2000}
          readOnly={!editable || !isEditing}
          style={{ pointerEvents: isEditing ? "auto" : "none" }}
          onPointerDown={(event) => {
            if (isEditing) {
              event.stopPropagation();
            }
          }}
          onBlur={(event) => {
            setIsEditing(false);
            const text = event.currentTarget.value.trim();
            if (text !== comment.text) {
              onReplace({ ...comment, text });
            }
          }}
        />
      </header>
      {editable ? (
        <>
          <button
            type="button"
            className="graph-comment__resize graph-comment__resize--sw nodrag nopan"
            aria-label={t("graph.comment.resize")}
            onPointerDown={(event) => {
              startGesture(event, "resize-sw");
            }}
            onPointerMove={moveGesture}
            onPointerUp={finishGesture}
            onPointerCancel={finishGesture}
          />
          <button
            type="button"
            className="graph-comment__resize graph-comment__resize--se nodrag nopan"
            aria-label={t("graph.comment.resize")}
            onPointerDown={(event) => {
              startGesture(event, "resize-se");
            }}
            onPointerMove={moveGesture}
            onPointerUp={finishGesture}
            onPointerCancel={finishGesture}
          />
        </>
      ) : null}
    </article>
  );
}

const MemoizedGraphComment = memo(GraphComment);

export function GraphCommentLayer({
  comments,
  draft,
  editable,
  selectedCommentId,
  onSelect,
  onReplace,
  onRemove,
}: GraphCommentLayerProps) {
  return (
    <ViewportPortal>
      <div className="graph-comment-layer">
        {comments.map((comment) => (
          <MemoizedGraphComment
            key={comment.commentId}
            comment={comment}
            editable={editable}
            selected={comment.commentId === selectedCommentId}
            onSelect={() => {
              onSelect(comment.commentId);
            }}
            onReplace={onReplace}
            onRemove={() => {
              onRemove(comment.commentId);
            }}
          />
        ))}
        {draft === undefined ? null : (
          <div
            className="graph-comment graph-comment--draft"
            style={{
              left: draft.x,
              top: draft.y,
              width: draft.width,
              height: draft.height,
            }}
            aria-hidden="true"
          />
        )}
      </div>
    </ViewportPortal>
  );
}
