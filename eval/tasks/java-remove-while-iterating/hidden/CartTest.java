import java.time.LocalDate;
import java.util.List;

/** No test framework in this project: run with {@code java CartTest}, exit code is the verdict. */
public final class CartTest {
    private static int failures = 0;

    private static void check(boolean condition, String what) {
        if (!condition) {
            failures++;
            System.err.println("FAIL: " + what);
        }
    }

    public static void main(String[] args) {
        LocalDate today = LocalDate.parse("2026-05-10");
        Cart cart = new Cart();
        cart.add("A", 1, today.plusDays(1));
        cart.add("B", 1, today.minusDays(1));
        check(cart.removeExpired(today) == 1, "one item expired");
        check(cart.skus().equals(List.of("A")), "the other one stays");
        if (failures > 0) {
            System.exit(1);
        }
        System.out.println("ok");
    }
}
