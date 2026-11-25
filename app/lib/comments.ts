// Comment limits live here rather than in lessonCommentService so that client
// components can import them without pulling the database driver into the
// browser bundle.

export const MAX_COMMENT_LENGTH = 2000;
