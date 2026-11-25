import { useEffect, useState } from "react";
import { Link, useFetcher } from "react-router";
import { toast } from "sonner";
import { MessageSquare } from "lucide-react";
import { UserRole } from "~/db/schema";
import { MAX_COMMENT_LENGTH } from "~/lib/comments";
import { formatFullDateTime, formatRelativeTime } from "~/lib/relative-time";
import type {
  LessonComment,
  LessonCommentThread,
} from "~/services/lessonCommentService";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { UserAvatar } from "~/components/user-avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog";

type CommentActionResult = { ok: boolean; error: string | null };

type DiscussionData = {
  threads: LessonCommentThread[];
  count: number;
  courseInstructorId: number;
  currentUserRole: UserRole;
};

type Viewer = {
  userId: number;
  role: UserRole;
  courseInstructorId: number;
};

export function LessonDiscussion({
  loginHref,
  currentUserId,
  discussion,
}: {
  loginHref: string;
  currentUserId: number | null;
  discussion: DiscussionData | null;
}) {
  if (!discussion || currentUserId === null) {
    return (
      <section className="mt-10 border-t pt-6">
        <h2 className="mb-4 text-xl font-semibold">Discussion</h2>
        <div className="flex items-center gap-3 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          <MessageSquare className="size-5 shrink-0" />
          <p>
            <Link to={loginHref} className="font-medium text-primary underline-offset-4 hover:underline">
              Log in
            </Link>{" "}
            to join the discussion.
          </p>
        </div>
      </section>
    );
  }

  const viewer: Viewer = {
    userId: currentUserId,
    role: discussion.currentUserRole,
    courseInstructorId: discussion.courseInstructorId,
  };

  return (
    <section className="mt-10 border-t pt-6">
      <h2 className="mb-4 text-xl font-semibold">
        Discussion ({discussion.count})
      </h2>

      <CommentForm
        placeholder="Ask a question or share your thoughts…"
        submitLabel="Post comment"
      />

      {discussion.threads.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">
          No comments yet. Be the first to start the discussion.
        </p>
      ) : (
        <ul className="mt-6 space-y-6">
          {discussion.threads.map((thread) => (
            <li key={thread.id}>
              <CommentThread
                thread={thread}
                viewer={viewer}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CommentThread({
  thread,
  viewer,
}: {
  thread: LessonCommentThread;
  viewer: Viewer;
}) {
  const [replying, setReplying] = useState(false);

  return (
    <div>
      <CommentItem
        comment={thread}
        viewer={viewer}
        isTopLevel
        onReply={() => setReplying(true)}
      />

      {(thread.replies.length > 0 || replying) && (
        <div className="mt-4 ml-11 space-y-4 border-l pl-4">
          {thread.replies.map((reply) => (
            <CommentItem
              key={reply.id}
              comment={reply}
              viewer={viewer}
              isTopLevel={false}
              onReply={() => setReplying(true)}
            />
          ))}

          {replying && (
            <CommentForm
              parentId={thread.id}
              placeholder={`Reply to ${thread.author.name}…`}
              submitLabel="Reply"
              autoFocus
              onDone={() => setReplying(false)}
              onCancel={() => setReplying(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function CommentItem({
  comment,
  viewer,
  isTopLevel,
  onReply,
}: {
  comment: LessonComment;
  viewer: Viewer;
  isTopLevel: boolean;
  onReply: () => void;
}) {
  const [editing, setEditing] = useState(false);

  const isAuthor = comment.author.id === viewer.userId;
  const canDelete =
    isAuthor ||
    viewer.userId === viewer.courseInstructorId ||
    viewer.role === UserRole.Admin;

  return (
    <article className="flex gap-3">
      <UserAvatar
        name={comment.author.name}
        avatarUrl={comment.author.avatarUrl}
        className="shrink-0"
      />
      <div className="min-w-0 flex-1">
        <header className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="font-medium">{comment.author.name}</span>
          <AuthorBadge
            authorId={comment.author.id}
            role={comment.author.role}
            courseInstructorId={viewer.courseInstructorId}
          />
          <CommentTimestamp createdAt={comment.createdAt} />
          {comment.editedAt && (
            <span className="text-xs text-muted-foreground">(edited)</span>
          )}
        </header>

        {editing ? (
          <EditCommentForm
            comment={comment}
            onDone={() => setEditing(false)}
          />
        ) : (
          <>
            <p className="mt-1 text-sm whitespace-pre-wrap break-words">
              {comment.content}
            </p>
            <div className="mt-1 -ml-2 flex items-center gap-1">
              <Button variant="ghost" size="xs" onClick={onReply}>
                Reply
              </Button>
              {isAuthor && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setEditing(true)}
                >
                  Edit
                </Button>
              )}
              {canDelete && (
                <DeleteCommentButton
                  commentId={comment.id}
                  isTopLevel={isTopLevel}
                />
              )}
            </div>
          </>
        )}
      </div>
    </article>
  );
}

function AuthorBadge({
  authorId,
  role,
  courseInstructorId,
}: {
  authorId: number;
  role: UserRole;
  courseInstructorId: number;
}) {
  if (authorId === courseInstructorId) {
    return <Badge>Instructor</Badge>;
  }
  if (role === UserRole.Instructor) {
    return <Badge variant="outline">Instructor</Badge>;
  }
  if (role === UserRole.Admin) {
    return <Badge variant="secondary">Admin</Badge>;
  }
  return null;
}

function CommentTimestamp({ createdAt }: { createdAt: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* Relative time depends on "now", so server and client may differ by
            a minute — suppress the hydration warning for this text only. */}
        <time
          dateTime={createdAt}
          suppressHydrationWarning
          className="text-xs text-muted-foreground"
        >
          {formatRelativeTime(createdAt)}
        </time>
      </TooltipTrigger>
      <TooltipContent suppressHydrationWarning>
        {formatFullDateTime(createdAt)}
      </TooltipContent>
    </Tooltip>
  );
}

/** Shows a toast on error and calls onSuccess once per successful submission. */
function useCommentFetcherResult(
  fetcher: ReturnType<typeof useFetcher<CommentActionResult>>,
  onSuccess?: () => void
) {
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.ok) {
      onSuccess?.();
    } else if (fetcher.data.error) {
      toast.error(fetcher.data.error);
    }
    // Only react to a new result, not to callback identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);
}

function CommentForm({
  parentId,
  placeholder,
  submitLabel,
  autoFocus,
  onDone,
  onCancel,
}: {
  parentId?: number;
  placeholder: string;
  submitLabel: string;
  autoFocus?: boolean;
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const fetcher = useFetcher<CommentActionResult>();
  const [content, setContent] = useState("");
  const isSubmitting = fetcher.state !== "idle";

  useCommentFetcherResult(fetcher, () => {
    setContent("");
    onDone?.();
  });

  return (
    <fetcher.Form method="post" className="space-y-2">
      <input type="hidden" name="intent" value="add-comment" />
      {parentId !== undefined && (
        <input type="hidden" name="parentId" value={parentId} />
      )}
      <Textarea
        name="content"
        aria-label={submitLabel}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={placeholder}
        maxLength={MAX_COMMENT_LENGTH}
        rows={parentId === undefined ? 3 : 2}
        autoFocus={autoFocus}
      />
      <CommentFormFooter
        length={content.length}
        canSubmit={content.trim().length > 0 && !isSubmitting}
        submitLabel={isSubmitting ? "Posting…" : submitLabel}
        onCancel={onCancel}
      />
    </fetcher.Form>
  );
}

function EditCommentForm({
  comment,
  onDone,
}: {
  comment: LessonComment;
  onDone: () => void;
}) {
  const fetcher = useFetcher<CommentActionResult>();
  const [content, setContent] = useState(comment.content);
  const isSubmitting = fetcher.state !== "idle";

  useCommentFetcherResult(fetcher, onDone);

  return (
    <fetcher.Form method="post" className="mt-1 space-y-2">
      <input type="hidden" name="intent" value="edit-comment" />
      <input type="hidden" name="commentId" value={comment.id} />
      <Textarea
        name="content"
        aria-label="Edit comment"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        maxLength={MAX_COMMENT_LENGTH}
        rows={3}
        autoFocus
      />
      <CommentFormFooter
        length={content.length}
        canSubmit={
          content.trim().length > 0 &&
          content.trim() !== comment.content &&
          !isSubmitting
        }
        submitLabel={isSubmitting ? "Saving…" : "Save"}
        onCancel={onDone}
      />
    </fetcher.Form>
  );
}

function CommentFormFooter({
  length,
  canSubmit,
  submitLabel,
  onCancel,
}: {
  length: number;
  canSubmit: boolean;
  submitLabel: string;
  onCancel?: () => void;
}) {
  return (
    <div className="flex items-center justify-end gap-2">
      {length > MAX_COMMENT_LENGTH * 0.8 && (
        <span className="mr-auto text-xs text-muted-foreground">
          {length}/{MAX_COMMENT_LENGTH}
        </span>
      )}
      {onCancel && (
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      )}
      <Button type="submit" size="sm" disabled={!canSubmit}>
        {submitLabel}
      </Button>
    </div>
  );
}

function DeleteCommentButton({
  commentId,
  isTopLevel,
}: {
  commentId: number;
  isTopLevel: boolean;
}) {
  const fetcher = useFetcher<CommentActionResult>();
  const isSubmitting = fetcher.state !== "idle";

  useCommentFetcherResult(fetcher);

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          className="text-destructive hover:text-destructive"
          disabled={isSubmitting}
        >
          {isSubmitting ? "Deleting…" : "Delete"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this comment?</AlertDialogTitle>
          <AlertDialogDescription>
            {isTopLevel
              ? "This will delete the comment and all of its replies — the whole thread will be removed. This can't be undone."
              : "This reply will be removed. This can't be undone."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-white hover:bg-destructive/90"
            onClick={() =>
              fetcher.submit(
                { intent: "delete-comment", commentId },
                { method: "post" }
              )
            }
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
