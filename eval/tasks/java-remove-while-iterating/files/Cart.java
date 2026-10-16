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
        int removed = 0;
        for (Item item : items) {
            if (item.reservedUntil.isBefore(today)) {
                items.remove(item);
                removed++;
            }
        }
        return removed;
    }

    /** Removes every line whose quantity was set to zero or less. */
    public void dropEmptyLines() {
        for (Item item : items) {
            if (item.quantity <= 0) {
                items.remove(item);
            }
        }
    }

    public List<String> skus() {
        List<String> out = new ArrayList<>();
        for (Item item : items) {
            out.add(item.sku);
        }
        return out;
    }
}
