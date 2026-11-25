import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

import {
  rateCourse,
  getUserRatingForCourse,
  getCourseRatingSummary,
  getRatingSummariesForCourses,
  canUserRateCourse,
  isValidRating,
} from "./ratingService";

function createStudent(email: string) {
  return testDb
    .insert(schema.users)
    .values({ name: email, email, role: schema.UserRole.Student })
    .returning()
    .get();
}

function enroll(userId: number, courseId: number) {
  testDb.insert(schema.enrollments).values({ userId, courseId }).run();
}

describe("ratingService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("isValidRating", () => {
    it("accepts whole numbers 1-5", () => {
      for (const r of [1, 2, 3, 4, 5]) expect(isValidRating(r)).toBe(true);
    });

    it("rejects out-of-range and fractional values", () => {
      for (const r of [0, 6, -1, 2.5, NaN]) expect(isValidRating(r)).toBe(false);
    });
  });

  describe("rateCourse", () => {
    it("lets an enrolled student rate a course", () => {
      enroll(base.user.id, base.course.id);

      const rating = rateCourse(base.user.id, base.course.id, 4);

      expect(rating.rating).toBe(4);
      expect(getUserRatingForCourse(base.user.id, base.course.id)?.rating).toBe(4);
    });

    it("updates an existing rating instead of creating a duplicate", () => {
      enroll(base.user.id, base.course.id);

      rateCourse(base.user.id, base.course.id, 2);
      rateCourse(base.user.id, base.course.id, 5);

      expect(getCourseRatingSummary(base.course.id)).toEqual({
        average: 5,
        count: 1,
      });
    });

    it("rejects invalid ratings", () => {
      enroll(base.user.id, base.course.id);

      expect(() => rateCourse(base.user.id, base.course.id, 0)).toThrowError(
        "Rating must be a whole number between 1 and 5"
      );
      expect(() => rateCourse(base.user.id, base.course.id, 6)).toThrowError();
      expect(() => rateCourse(base.user.id, base.course.id, 3.5)).toThrowError();
    });

    it("prevents the course instructor from rating their own course", () => {
      enroll(base.instructor.id, base.course.id);

      expect(canUserRateCourse(base.instructor.id, base.course.id)).toBe(false);
      expect(() =>
        rateCourse(base.instructor.id, base.course.id, 5)
      ).toThrowError("You can't rate your own course");
    });

    it("prevents users who are not enrolled from rating", () => {
      expect(canUserRateCourse(base.user.id, base.course.id)).toBe(false);
      expect(() => rateCourse(base.user.id, base.course.id, 5)).toThrowError(
        "You must be enrolled to rate this course"
      );
    });

    it("throws for a non-existent course", () => {
      expect(() => rateCourse(base.user.id, 9999, 5)).toThrowError(
        "Course not found"
      );
    });
  });

  describe("getCourseRatingSummary", () => {
    it("returns null average and zero count when unrated", () => {
      expect(getCourseRatingSummary(base.course.id)).toEqual({
        average: null,
        count: 0,
      });
    });

    it("averages ratings across students", () => {
      const other = createStudent("other@example.com");
      enroll(base.user.id, base.course.id);
      enroll(other.id, base.course.id);

      rateCourse(base.user.id, base.course.id, 3);
      rateCourse(other.id, base.course.id, 4);

      expect(getCourseRatingSummary(base.course.id)).toEqual({
        average: 3.5,
        count: 2,
      });
    });
  });

  describe("getRatingSummariesForCourses", () => {
    it("returns summaries keyed by course id, omitting unrated courses", () => {
      const second = testDb
        .insert(schema.courses)
        .values({
          title: "Second",
          slug: "second",
          description: "x",
          instructorId: base.instructor.id,
          categoryId: base.category.id,
          status: schema.CourseStatus.Published,
        })
        .returning()
        .get();
      enroll(base.user.id, base.course.id);
      rateCourse(base.user.id, base.course.id, 5);

      const map = getRatingSummariesForCourses([base.course.id, second.id]);

      expect(map.get(base.course.id)).toEqual({ average: 5, count: 1 });
      expect(map.has(second.id)).toBe(false);
    });

    it("handles an empty id list", () => {
      expect(getRatingSummariesForCourses([]).size).toBe(0);
    });
  });
});
