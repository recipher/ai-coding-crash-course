import { useState } from "react";
import { Star } from "lucide-react";
import { cn } from "~/lib/utils";

const STARS = [1, 2, 3, 4, 5] as const;

/**
 * Read-only star display. Supports fractional values (e.g. 3.6 fills 60% of the 4th star).
 */
export function StarRatingDisplay({
  value,
  className,
  starClassName = "size-4",
}: {
  value: number;
  className?: string;
  starClassName?: string;
}) {
  return (
    <span
      className={cn("inline-flex items-center gap-0.5", className)}
      role="img"
      aria-label={`Rated ${value.toFixed(1)} out of 5`}
    >
      {STARS.map((star) => {
        const fill = Math.max(0, Math.min(1, value - (star - 1)));
        return (
          <span key={star} className="relative inline-block">
            <Star className={cn(starClassName, "text-muted-foreground/30")} />
            {fill > 0 && (
              <span
                className="absolute inset-0 overflow-hidden"
                style={{ width: `${fill * 100}%` }}
              >
                <Star
                  className={cn(starClassName, "fill-amber-400 text-amber-400")}
                />
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}

/**
 * Average rating with count, e.g. ★★★★☆ 4.2 (12 ratings).
 * Renders "No ratings yet" when there are none.
 */
export function CourseRatingSummary({
  average,
  count,
  className,
  starClassName,
  compact = false,
}: {
  average: number | null;
  count: number;
  className?: string;
  starClassName?: string;
  compact?: boolean;
}) {
  if (average === null || count === 0) {
    return (
      <span className={cn("text-muted-foreground", className)}>
        No ratings yet
      </span>
    );
  }

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span className="font-semibold text-foreground">
        {average.toFixed(1)}
      </span>
      <StarRatingDisplay value={average} starClassName={starClassName} />
      <span className="text-muted-foreground">
        ({count}
        {compact ? "" : count === 1 ? " rating" : " ratings"})
      </span>
    </span>
  );
}

/**
 * Interactive 1-5 star selector. Submits a native radio input named `name`,
 * so it works inside a <Form>/<fetcher.Form>. Calls onSelect when a star is chosen.
 */
export function StarRatingInput({
  name = "rating",
  value,
  onSelect,
  disabled = false,
}: {
  name?: string;
  value: number | null;
  onSelect?: (rating: number) => void;
  disabled?: boolean;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const active = hovered ?? value ?? 0;

  return (
    <fieldset
      className="inline-flex items-center gap-1"
      onMouseLeave={() => setHovered(null)}
      disabled={disabled}
    >
      <legend className="sr-only">Your rating</legend>
      {STARS.map((star) => (
        <label
          key={star}
          className={cn(
            "cursor-pointer rounded p-0.5 transition-transform has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
            !disabled && "hover:scale-110",
            disabled && "cursor-not-allowed opacity-60"
          )}
          onMouseEnter={() => setHovered(star)}
        >
          <input
            type="radio"
            name={name}
            value={star}
            checked={value === star}
            onChange={() => onSelect?.(star)}
            className="sr-only"
          />
          <Star
            className={cn(
              "size-7 transition-colors",
              star <= active
                ? "fill-amber-400 text-amber-400"
                : "text-muted-foreground/40"
            )}
          />
          <span className="sr-only">
            {star} star{star === 1 ? "" : "s"}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
