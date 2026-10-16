import java.time.LocalDate;
import java.util.List;

public final class CartHiddenTest {
    private static int failures = 0;
    private static final LocalDate TODAY = LocalDate.parse("2026-05-10");

    private static void check(boolean condition, String what) {
        if (!condition) {
            failures++;
            System.err.println("FAIL: " + what);
        }
    }

    /** One letter per item: x = expired, k = kept. */
    private static Cart cart(String layout) {
        Cart cart = new Cart();
        for (int i = 0; i < layout.length(); i++) {
            LocalDate until = layout.charAt(i) == 'x' ? TODAY.minusDays(1) : TODAY;
            cart.add(layout.charAt(i) + String.valueOf(i), 1, until);
        }
        return cart;
    }

    private static void expire(String layout) {
        Cart cart = cart(layout);
        long expected = layout.chars().filter(c -> c == 'x').count();
        int removed;
        try {
            removed = cart.removeExpired(TODAY);
        } catch (RuntimeException e) {
            check(false, layout + ": removeExpired threw " + e);
            return;
        }
        check(removed == expected, layout + ": removed " + removed + ", expected " + expected);
        for (String sku : cart.skus()) {
            check(sku.startsWith("k"), layout + ": " + sku + " survived");
        }
        check(cart.skus().size() == layout.length() - expected, layout + ": kept " + cart.skus());
    }

    private static void empty(String layout) {
        Cart cart = new Cart();
        for (int i = 0; i < layout.length(); i++) {
            cart.add(layout.charAt(i) + String.valueOf(i), layout.charAt(i) == '0' ? 0 : 2, TODAY);
        }
        try {
            cart.dropEmptyLines();
        } catch (RuntimeException e) {
            check(false, layout + ": dropEmptyLines threw " + e);
            return;
        }
        for (String sku : cart.skus()) {
            check(!sku.startsWith("0"), layout + ": empty line " + sku + " survived");
        }
        long kept = layout.chars().filter(c -> c != '0').count();
        check(cart.skus().size() == kept, layout + ": kept " + cart.skus());
    }

    public static void main(String[] args) {
        for (String layout : List.of("x", "k", "xx", "xk", "kx", "xxk", "kxx", "xkx", "xxx", "kxxk", "xkxkxx", "kkkxk", "")) {
            expire(layout);
        }
        // The same mistake, in the other method that removes while iterating.
        for (String layout : List.of("0", "00", "01", "10", "100", "010", "001", "1001", "0000", "")) {
            empty(layout);
        }
        // The order of what is kept does not change.
        Cart cart = cart("kxkxk");
        cart.removeExpired(TODAY);
        check(cart.skus().equals(List.of("k0", "k2", "k4")), "order kept: " + cart.skus());
        // An item reserved until today has not expired yet.
        Cart edge = new Cart();
        edge.add("T", 1, TODAY);
        check(edge.removeExpired(TODAY) == 0 && edge.skus().equals(List.of("T")), "reserved until today is still reserved");
        if (failures > 0) {
            System.exit(1);
        }
        System.out.println("ok");
    }
}
