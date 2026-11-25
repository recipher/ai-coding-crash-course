import { eq, and, isNull, or, asc } from "drizzle-orm";
import { db } from "~/db";
import {
  lessonComments,
  lessons,
  modules,
  courses,
  users,
  UserRole,
} from "~/db/schema";
import { MAX_COMMENT_LENGTH } from "~/lib/comments";

// ─── Lesson Comment Service ───
// Plain-text discussion threads on lessons, one level deep: top-level comments
// and replies. Replying to a reply attaches to the top-level comment.
// Deletes are soft (deletedAt); deleting a top-level comment deletes its
// whole thread. Uses positional parameters (project convention).

export type CommentAuthor = {
  id: number;
  name: string;
  avatarUrl: string | null;
  role: UserRole;
};

export type LessonComment = {
  id: number;
  lessonId: number;
  parentId: number | null;
  content: string;
  createdAt: string;
  editedAt: string | null;
  author: CommentAuthor;
};

export type LessonCommentThread = LessonComment & {
  replies: LessonComment[];
};

/** Trims and validates comment text. Returns the trimmed content. */
export function assertValidCommentContent(content: string) {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    throw new Error("Comment cannot be empty");
  }
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    throw new Error(
      `Comment must be ${MAX_COMMENT_LENGTH} characters or fewer`
    );
  }
  return trimmed;
}

function findActiveComment(commentId: number) {
  return db
    .select()
    .from(lessonComments)
    .where(
      and(eq(lessonComments.id, commentId), isNull(lessonComments.deletedAt))
    )
    .get();
}

/**
 * All visible threads for a lesson: top-level comments newest first, each with
 * its replies oldest first. `count` includes replies.
 */
export function getCommentsForLesson(lessonId: number): {
  threads: LessonCommentThread[];
  count: number;
} {
  const rows = db
    .select({
      id: lessonComments.id,
      lessonId: lessonComments.lessonId,
      parentId: lessonComments.parentId,
      content: lessonComments.content,
      createdAt: lessonComments.createdAt,
      editedAt: lessonComments.editedAt,
      author: {
        id: users.id,
        name: users.name,
        avatarUrl: users.avatarUrl,
        role: users.role,
      },
    })
    .from(lessonComments)
    .innerJoin(users, eq(lessonComments.userId, users.id))
    .where(
      and(
        eq(lessonComments.lessonId, lessonId),
        isNull(lessonComments.deletedAt)
      )
    )
    .orderBy(asc(lessonComments.createdAt), asc(lessonComments.id))
    .all();

  const threads: LessonCommentThread[] = [];
  const byId = new Map<number, LessonCommentThread>();

  for (const row of rows) {
    if (row.parentId === null) {
      const thread = { ...row, replies: [] };
      threads.push(thread);
      byId.set(row.id, thread);
    }
  }

  let count = threads.length;
  for (const row of rows) {
    if (row.parentId !== null) {
      const parent = byId.get(row.parentId);
      // Replies to a deleted parent are deleted with it, but skip any orphan
      // defensively so it can't appear without its thread.
      if (parent) {
        parent.replies.push(row);
        count++;
      }
    }
  }

  // Rows are oldest-first; top-level comments display newest-first.
  threads.reverse();

  return { threads, count };
}

/**
 * Adds a comment to a lesson. When `parentId` points at a reply, the new
 * comment attaches to that reply's top-level comment.
 */
export function addComment(
  userId: number,
  lessonId: number,
  content: string,
  parentId?: number | null
) {
  const trimmed = assertValidCommentContent(content);

  const lesson = db
    .select({ id: lessons.id })
    .from(lessons)
    .where(eq(lessons.id, lessonId))
    .get();

  if (!lesson) {
    throw new Error("Lesson not found");
  }

  let topLevelParentId: number | null = null;

  if (parentId != null) {
    const parent = findActiveComment(parentId);
    if (!parent || parent.lessonId !== lessonId) {
      throw new Error("The comment you're replying to no longer exists");
    }
    topLevelParentId = parent.parentId ?? parent.id;
  }

  return db
    .insert(lessonComments)
    .values({ userId, lessonId, parentId: topLevelParentId, content: trimmed })
    .returning()
    .get();
}

/** Edits a comment's text. Only the original author may edit. */
export function editComment(userId: number, commentId: number, content: string) {
  const trimmed = assertValidCommentContent(content);

  const comment = findActiveComment(commentId);
  if (!comment) {
    throw new Error("Comment not found");
  }
  if (comment.userId !== userId) {
    throw new Error("You can only edit your own comments");
  }

  const now = new Date().toISOString();
  return db
    .update(lessonComments)
    .set({ content: trimmed, editedAt: now, updatedAt: now })
    .where(eq(lessonComments.id, commentId))
    .returning()
    .get();
}

/** Whether a user may delete a comment: its author, the course's instructor, or an admin. */
export function canDeleteComment(userId: number, commentId: number) {
  const row = db
    .select({
      authorId: lessonComments.userId,
      courseInstructorId: courses.instructorId,
    })
    .from(lessonComments)
    .innerJoin(lessons, eq(lessonComments.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(lessonComments.id, commentId))
    .get();

  if (!row) return false;
  if (row.authorId === userId || row.courseInstructorId === userId) return true;

  const user = db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .get();

  return user?.role === UserRole.Admin;
}

/**
 * Soft-deletes a comment. Deleting a top-level comment also deletes all of its
 * replies, in one transaction.
 */
export function deleteComment(userId: number, commentId: number) {
  const comment = findActiveComment(commentId);
  if (!comment) {
    throw new Error("Comment not found");
  }
  if (!canDeleteComment(userId, commentId)) {
    throw new Error("You don't have permission to delete this comment");
  }

  const now = new Date().toISOString();

  db.transaction((tx) => {
    tx.update(lessonComments)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          or(
            eq(lessonComments.id, commentId),
            eq(lessonComments.parentId, commentId)
          ),
          isNull(lessonComments.deletedAt)
        )
      )
      .run();
  });
}

