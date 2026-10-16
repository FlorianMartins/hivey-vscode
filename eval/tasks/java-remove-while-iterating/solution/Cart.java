import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

/** A shopping cart. Reserved items expire when their reservation does. */
public final class Cart {
    public static final class Item {
        final String sku;
        int quantity;
        final LocalDate reservedUntil;

        public Item(String sku, int quantity, LocalDate reservedUntil) {
            this.sku = sku;
            this.quantity = quantity;
            this.reservedUntil = reservedUntil;
        }
    }

    private final List<Item> items = new ArrayList<>();

    public void add(String sku, int quantity, LocalDate reservedUntil) {
        items.add(new Item(sku, quantity, reservedUntil));
    }

    public void setQuantity(String sku, int quantity) {
        for (Item item : items) {
            if (item.sku.equals(sku)) {
                item.quantity = quantity;
            }
        }
    }

    /** Removes every item whose reservation ended before {@code today}; returns how many were removed. */
    public int removeExpired(LocalDate today) {
        // removeIf, not remove() inside a for-each: that throws ConcurrentModificationException, and
        // an index loop that removes skips the item right after every one it removes.
        int before = items.size();
        items.removeIf(item -> item.reservedUntil.isBefore(today));
        return before - items.size();
    }

    /** Removes every line whose quantity was set to zero or less. */
    public void dropEmptyLines() {
        // The same mistake as removeExpired had. When the removed line was the second-to-last one it
        // did not even throw: the loop ended early and silently kept the last line.
        items.removeIf(item -> item.quantity <= 0);
    }

    public List<String> skus() {
        List<String> out = new ArrayList<>();
        for (Item item : items) {
            out.add(item.sku);
        }
        return out;
    }
}
