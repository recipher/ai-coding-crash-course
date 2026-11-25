import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;
let lesson: typeof schema.lessons.$inferSelect;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

// Import after mock so the module picks up our test db
import {
  addComment,
  editComment,
  deleteComment,
  canDeleteComment,
  getCommentsForLesson,
} from "./lessonCommentService";

function createUser(name: string, email: string, role: schema.UserRole) {
  return testDb
    .insert(schema.users)
    .values({ name, email, role })
    .returning()
    .get();
}

function createLesson(title: string) {
  const mod = testDb
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: `${title} module`, position: 1 })
    .returning()
    .get();
  return testDb
    .insert(schema.lessons)
    .values({ moduleId: mod.id, title, position: 1 })
    .returning()
    .get();
}

function rawComment(id: number) {
  return testDb
    .select()
    .from(schema.lessonComments)
    .where(eq(schema.lessonComments.id, id))
    .get()!;
}

describe("lessonCommentService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
    lesson = createLesson("Lesson 1");
  });

  describe("addComment", () => {
    it("stores a trimmed top-level comment", () => {
      const comment = addComment(base.user.id, lesson.id, "  Hello?  ");

      expect(comment.content).toBe("Hello?");
      expect(comment.parentId).toBeNull();
      expect(comment.editedAt).toBeNull();
    });

    it("preserves internal line breaks", () => {
      const comment = addComment(base.user.id, lesson.id, "line 1\nline 2");
      expect(comment.content).toBe("line 1\nline 2");
    });

    it.each(["", "   ", "\n\t "])("rejects empty content %j", (content) => {
      expect(() => addComment(base.user.id, lesson.id, content)).toThrowError(
        "Comment cannot be empty"
      );
    });

    it("accepts exactly 2000 characters and rejects 2001", () => {
      expect(() =>
        addComment(base.user.id, lesson.id, "a".repeat(2000))
      ).not.toThrow();
      expect(() =>
        addComment(base.user.id, lesson.id, "a".repeat(2001))
      ).toThrowError("Comment must be 2000 characters or fewer");
    });

    it("rejects a missing lesson", () => {
      expect(() => addComment(base.user.id, 9999, "hi")).toThrowError(
        "Lesson not found"
      );
    });

    it("attaches a reply to its parent", () => {
      const parent = addComment(base.user.id, lesson.id, "Question");
      const reply = addComment(base.instructor.id, lesson.id, "Answer", parent.id);

      expect(reply.parentId).toBe(parent.id);
    });

    it("flattens a reply-to-a-reply onto the top-level comment", () => {
      const parent = addComment(base.user.id, lesson.id, "Question");
      const reply = addComment(base.instructor.id, lesson.id, "Answer", parent.id);
      const nested = addComment(base.user.id, lesson.id, "Thanks", reply.id);

      expect(nested.parentId).toBe(parent.id);
    });

    it("rejects a parent from another lesson", () => {
      const other = createLesson("Lesson 2");
      const parent = addComment(base.user.id, other.id, "Elsewhere");

      expect(() =>
        addComment(base.user.id, lesson.id, "Reply", parent.id)
      ).toThrowError("The comment you're replying to no longer exists");
    });

    it("rejects replying to a deleted comment", () => {
      const parent = addComment(base.user.id, lesson.id, "Question");
      deleteComment(base.user.id, parent.id);

      expect(() =>
        addComment(base.user.id, lesson.id, "Reply", parent.id)
      ).toThrowError("The comment you're replying to no longer exists");
    });
  });

  describe("getCommentsForLesson", () => {
    it("returns top-level newest first and replies oldest first, with authors", () => {
      const first = addComment(base.user.id, lesson.id, "First");
      const second = addComment(base.user.id, lesson.id, "Second");
      addComment(base.instructor.id, lesson.id, "Reply A", first.id);
      addComment(base.user.id, lesson.id, "Reply B", first.id);

      const { threads, count } = getCommentsForLesson(lesson.id);

      expect(threads.map((t) => t.id)).toEqual([second.id, first.id]);
      expect(threads[1].replies.map((r) => r.content)).toEqual([
        "Reply A",
        "Reply B",
      ]);
      expect(threads[1].replies[0].author).toMatchObject({
        id: base.instructor.id,
        name: "Test Instructor",
        role: schema.UserRole.Instructor,
      });
      expect(count).toBe(4);
    });

    it("only returns comments for the requested lesson", () => {
      const other = createLesson("Lesson 2");
      addComment(base.user.id, other.id, "Elsewhere");

      expect(getCommentsForLesson(lesson.id)).toEqual({ threads: [], count: 0 });
    });

    it("excludes deleted comments from threads and count", () => {
      const keep = addComment(base.user.id, lesson.id, "Keep");
      const reply = addComment(base.user.id, lesson.id, "Gone reply", keep.id);
      const gone = addComment(base.user.id, lesson.id, "Gone");
      addComment(base.user.id, lesson.id, "Gone child", gone.id);

      deleteComment(base.user.id, reply.id);
      deleteComment(base.user.id, gone.id);

      const { threads, count } = getCommentsForLesson(lesson.id);
      expect(threads.map((t) => t.content)).toEqual(["Keep"]);
      expect(threads[0].replies).toEqual([]);
      expect(count).toBe(1);
    });
  });

  describe("editComment", () => {
    it("lets the author edit and sets editedAt", () => {
      const comment = addComment(base.user.id, lesson.id, "Typo");
      const edited = editComment(base.user.id, comment.id, "  Fixed  ");

      expect(edited.content).toBe("Fixed");
      expect(edited.editedAt).not.toBeNull();
    });

    it("rejects edits by anyone else, including instructors and admins", () => {
      const admin = createUser("Admin", "admin@example.com", schema.UserRole.Admin);
      const comment = addComment(base.user.id, lesson.id, "Mine");

      for (const userId of [base.instructor.id, admin.id]) {
        expect(() => editComment(userId, comment.id, "Hijacked")).toThrowError(
          "You can only edit your own comments"
        );
      }
      expect(rawComment(comment.id).content).toBe("Mine");
    });

    it("validates the new content", () => {
      const comment = addComment(base.user.id, lesson.id, "Mine");
      expect(() => editComment(base.user.id, comment.id, "  ")).toThrowError(
        "Comment cannot be empty"
      );
    });

    it("rejects editing a deleted comment", () => {
      const comment = addComment(base.user.id, lesson.id, "Mine");
      deleteComment(base.user.id, comment.id);
      expect(() => editComment(base.user.id, comment.id, "Back")).toThrowError(
        "Comment not found"
      );
    });
  });

  describe("deleteComment", () => {
    it("soft-deletes a top-level comment and all its replies", () => {
      const parent = addComment(base.user.id, lesson.id, "Question");
      const r1 = addComment(base.instructor.id, lesson.id, "A1", parent.id);
      const r2 = addComment(base.user.id, lesson.id, "A2", parent.id);
      const unrelated = addComment(base.user.id, lesson.id, "Other");

      deleteComment(base.user.id, parent.id);

      for (const id of [parent.id, r1.id, r2.id]) {
        expect(rawComment(id).deletedAt).not.toBeNull();
      }
      expect(rawComment(unrelated.id).deletedAt).toBeNull();
    });

    it("deleting a reply leaves its parent and siblings", () => {
      const parent = addComment(base.user.id, lesson.id, "Question");
      const r1 = addComment(base.user.id, lesson.id, "A1", parent.id);
      const r2 = addComment(base.user.id, lesson.id, "A2", parent.id);

      deleteComment(base.user.id, r1.id);

      expect(rawComment(r1.id).deletedAt).not.toBeNull();
      expect(rawComment(parent.id).deletedAt).toBeNull();
      expect(rawComment(r2.id).deletedAt).toBeNull();
    });

    it("allows the author, the course instructor and admins", () => {
      const admin = createUser("Admin", "admin@example.com", schema.UserRole.Admin);

      for (const userId of [base.user.id, base.instructor.id, admin.id]) {
        const comment = addComment(base.user.id, lesson.id, "Delete me");
        expect(canDeleteComment(userId, comment.id)).toBe(true);
        deleteComment(userId, comment.id);
        expect(rawComment(comment.id).deletedAt).not.toBeNull();
      }
    });

    it("rejects other students and instructors of other courses", () => {
      const student = createUser("Other", "other@example.com", schema.UserRole.Student);
      const otherInstructor = createUser(
        "Other Instructor",
        "oi@example.com",
        schema.UserRole.Instructor
      );
      const comment = addComment(base.user.id, lesson.id, "Mine");

      for (const userId of [student.id, otherInstructor.id]) {
        expect(canDeleteComment(userId, comment.id)).toBe(false);
        expect(() => deleteComment(userId, comment.id)).toThrowError(
          "You don't have permission to delete this comment"
        );
      }
      expect(rawComment(comment.id).deletedAt).toBeNull();
    });

    it("rejects deleting a missing or already-deleted comment", () => {
      const comment = addComment(base.user.id, lesson.id, "Mine");
      deleteComment(base.user.id, comment.id);

      expect(() => deleteComment(base.user.id, comment.id)).toThrowError(
        "Comment not found"
      );
      expect(() => deleteComment(base.user.id, 9999)).toThrowError(
        "Comment not found"
      );
    });
  });
});
