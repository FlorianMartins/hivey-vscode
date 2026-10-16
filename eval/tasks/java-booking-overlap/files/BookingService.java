import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Room bookings. */
public final class BookingService {
    private final Map<Integer, List<DateRange>> bookings = new HashMap<>();

    /** Books the room, or throws IllegalStateException if it is taken on any night of the stay. */
    public void book(int room, DateRange stay) {
        List<DateRange> taken = bookings.computeIfAbsent(room, r -> new ArrayList<>());
        for (DateRange existing : taken) {
            if (existing.overlaps(stay)) {
                throw new IllegalStateException("room " + room + " is taken: " + existing);
            }
        }
        taken.add(stay);
    }

    public boolean isFree(int room, DateRange stay) {
        for (DateRange existing : bookings.getOrDefault(room, List.of())) {
            if (existing.overlaps(stay)) {
                return false;
            }
        }
        return true;
    }

    public List<DateRange> bookingsOf(int room) {
        return List.copyOf(bookings.getOrDefault(room, List.of()));
    }
}
