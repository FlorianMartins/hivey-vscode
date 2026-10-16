import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.Objects;

/**
 * A stay, from the check-in day to the check-out day.
 *
 * <p>Half-open: the check-in day is part of the stay, the check-out day is not. The night of the
 * check-out day belongs to the next guest.
 */
public final class DateRange {
    private final LocalDate start;
    private final LocalDate end;

    public DateRange(LocalDate start, LocalDate end) {
        if (!end.isAfter(start)) {
            throw new IllegalArgumentException("a stay is at least one night: " + start + " → " + end);
        }
        this.start = start;
        this.end = end;
    }

    public static DateRange of(String start, String end) {
        return new DateRange(LocalDate.parse(start), LocalDate.parse(end));
    }

    public LocalDate start() {
        return start;
    }

    public LocalDate end() {
        return end;
    }

    public long nights() {
        return ChronoUnit.DAYS.between(start, end);
    }

    /** Whether the night starting on {@code day} is part of this stay. */
    public boolean contains(LocalDate day) {
        return !day.isBefore(start) && day.isBefore(end);
    }

    /** Whether the two stays need the room on at least one common night. */
    public boolean overlaps(DateRange other) {
        return !start.isAfter(other.end) && !other.start.isAfter(end);
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof DateRange && ((DateRange) o).start.equals(start) && ((DateRange) o).end.equals(end);
    }

    @Override
    public int hashCode() {
        return Objects.hash(start, end);
    }

    @Override
    public String toString() {
        return start + " → " + end;
    }
}
