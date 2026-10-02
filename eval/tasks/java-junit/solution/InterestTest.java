import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.math.BigDecimal;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class InterestTest {
    @Test
    @DisplayName("a year at 5 % on 10 000 cents is 500 cents")
    void ordinaryCase() {
        assertEquals(500L, Interest.cents(10_000L, new BigDecimal("0.05"), 360));
    }

    @Test
    @DisplayName("no principal earns nothing")
    void zeroPrincipal() {
        assertEquals(0L, Interest.cents(0L, new BigDecimal("0.05"), 360));
    }

    @Test
    @DisplayName("no days earn nothing")
    void zeroDays() {
        assertEquals(0L, Interest.cents(10_000L, new BigDecimal("0.05"), 0));
    }

    @Test
    @DisplayName("a negative principal is refused")
    void negativePrincipal() {
        assertThrows(IllegalArgumentException.class, () -> Interest.cents(-1L, new BigDecimal("0.05"), 30));
    }

    @Test
    @DisplayName("a negative number of days is refused")
    void negativeDays() {
        assertThrows(IllegalArgumentException.class, () -> Interest.cents(10_000L, new BigDecimal("0.05"), -1));
    }
}
