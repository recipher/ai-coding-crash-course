import { eq, and, sql, inArray } from "drizzle-orm";
import { db } from "~/db";
import { courseRatings, courses } from "~/db/schema";
import { isUserEnrolled } from "./enrollmentService";

// ─── Rating Service ───
// Handles star ratings (1-5, no comment) for courses.
// One rating per user per course; re-rating updates the existing score.
// Uses positional parameters (project convention).

export const MIN_RATING = 1;
export const MAX_RATING = 5;

export type RatingSummary = { average: number | null; count: number };

export function isValidRating(rating: number) {
  return Number.isInteger(rating) && rating >= MIN_RATING && rating <= MAX_RATING;
}

export function getUserRatingForCourse(userId: number, courseId: number) {
  return db
    .select()
    .from(courseRatings)
    .where(
      and(eq(courseRatings.userId, userId), eq(courseRatings.courseId, courseId))
    )
    .get();
}

export function getCourseRatingSummary(courseId: number): RatingSummary {
  const result = db
    .select({
      average: sql<number | null>`avg(${courseRatings.rating})`,
      count: sql<number>`count(*)`,
    })
    .from(courseRatings)
    .where(eq(courseRatings.courseId, courseId))
    .get();

  return { average: result?.average ?? null, count: result?.count ?? 0 };
}

export function getRatingSummariesForCourses(courseIds: number[]) {
  const summaries = new Map<number, RatingSummary>();
  if (courseIds.length === 0) return summaries;

  const rows = db
    .select({
      courseId: courseRatings.courseId,
      average: sql<number>`avg(${courseRatings.rating})`,
      count: sql<number>`count(*)`,
    })
    .from(courseRatings)
    .where(inArray(courseRatings.courseId, courseIds))
    .groupBy(courseRatings.courseId)
    .all();

  for (const row of rows) {
    summaries.set(row.courseId, { average: row.average, count: row.count });
  }
  return summaries;
}

/**
 * Returns a reason the user can't rate the course, or null if they can.
 */
export function getRatingIneligibilityReason(userId: number, courseId: number) {
  const course = db
    .select({ instructorId: courses.instructorId })
    .from(courses)
    .where(eq(courses.id, courseId))
    .get();
  if (!course) {
    return "Course not found";
  }
  if (course.instructorId === userId) {
    return "You can't rate your own course";
  }
  if (!isUserEnrolled(userId, courseId)) {
    return "You must be enrolled to rate this course";
  }
  return null;
}

export function canUserRateCourse(userId: number, courseId: number) {
  return getRatingIneligibilityReason(userId, courseId) === null;
}

export function rateCourse(userId: number, courseId: number, rating: number) {
  if (!isValidRating(rating)) {
    throw new Error(
      `Rating must be a whole number between ${MIN_RATING} and ${MAX_RATING}`
    );
  }

  const reason = getRatingIneligibilityReason(userId, courseId);
  if (reason) {
    throw new Error(reason);
  }

  const now = new Date().toISOString();
  return db
    .insert(courseRatings)
    .values({ userId, courseId, rating, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: [courseRatings.userId, courseRatings.courseId],
      set: { rating, updatedAt: now },
    })
    .returning()
    .get();
}
