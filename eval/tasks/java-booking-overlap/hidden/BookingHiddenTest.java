import java.time.LocalDate;

public final class BookingHiddenTest {
    private static int failures = 0;

    private static void check(boolean condition, String what) {
        if (!condition) {
            failures++;
            System.err.println("FAIL: " + what);
        }
    }

    private static boolean books(BookingService service, int room, String from, String to) {
        try {
            service.book(room, DateRange.of(from, to));
            return true;
        } catch (IllegalStateException e) {
            return false;
        }
    }

    public static void main(String[] args) {
        BookingService service = new BookingService();
        check(books(service, 12, "2026-07-05", "2026-07-10"), "first stay");
        check(books(service, 12, "2026-07-10", "2026-07-12"), "a stay starting on the previous check-out day is free");
        check(books(service, 12, "2026-07-01", "2026-07-05"), "a stay ending on the next check-in day is free");
        check(!books(service, 12, "2026-07-09", "2026-07-11"), "a stay sharing one night is refused");
        check(!books(service, 12, "2026-07-04", "2026-07-06"), "a stay sharing the first night is refused");
        check(!books(service, 12, "2026-07-06", "2026-07-07"), "a stay inside another is refused");
        check(service.bookingsOf(12).size() == 3, "three stays booked back to back");

        DateRange a = DateRange.of("2026-03-01", "2026-03-04");
        check(!a.overlaps(DateRange.of("2026-03-04", "2026-03-05")), "touching after: no common night");
        check(!DateRange.of("2026-03-04", "2026-03-05").overlaps(a), "overlaps is symmetric");
        check(!a.overlaps(DateRange.of("2026-02-27", "2026-03-01")), "touching before: no common night");
        check(a.overlaps(DateRange.of("2026-03-03", "2026-03-04")), "the last night is shared");
        check(a.overlaps(DateRange.of("2026-03-01", "2026-03-02")), "the first night is shared");
        check(a.overlaps(a), "a stay overlaps itself");
        check(a.overlaps(DateRange.of("2026-02-01", "2026-04-01")), "a stay inside a longer one");

        check(service.isFree(12, DateRange.of("2026-07-12", "2026-07-15")), "free from the last check-out day");
        check(!service.isFree(12, DateRange.of("2026-07-11", "2026-07-15")), "not free on a booked night");
        check(a.contains(LocalDate.parse("2026-03-03")) && !a.contains(LocalDate.parse("2026-03-04")), "contains is unchanged");

        if (failures > 0) {
            System.exit(1);
        }
        System.out.println("ok");
    }
}
