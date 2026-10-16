/** No test framework in this project: run with {@code java BookingServiceTest}, exit code is the verdict. */
public final class BookingServiceTest {
    private static int failures = 0;

    private static void check(boolean condition, String what) {
        if (!condition) {
            failures++;
            System.err.println("FAIL: " + what);
        }
    }

    private static boolean throwsIllegalState(Runnable r) {
        try {
            r.run();
            return false;
        } catch (IllegalStateException e) {
            return true;
        }
    }

    public static void main(String[] args) {
        BookingService service = new BookingService();
        service.book(12, DateRange.of("2026-07-01", "2026-07-05"));
        check(throwsIllegalState(() -> service.book(12, DateRange.of("2026-07-03", "2026-07-08"))), "an overlapping stay is refused");
        check(throwsIllegalState(() -> service.book(12, DateRange.of("2026-06-28", "2026-07-10"))), "a stay around another is refused");
        service.book(14, DateRange.of("2026-07-03", "2026-07-08"));
        check(service.bookingsOf(14).size() == 1, "another room is independent");
        check(DateRange.of("2026-07-01", "2026-07-05").nights() == 4, "four nights");
        if (failures > 0) {
            System.exit(1);
        }
        System.out.println("ok");
    }
}
