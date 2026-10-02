import java.math.BigDecimal;
import java.math.RoundingMode;

public final class Interest {
    private Interest() {}

    /**
     * Simple interest, in cents, on a 360-day year.
     *
     * @throws IllegalArgumentException if the principal or the number of days is negative
     */
    public static long cents(long principalCents, BigDecimal annualRate, int days) {
        if (principalCents < 0) {
            throw new IllegalArgumentException("principal must not be negative");
        }
        if (days < 0) {
            throw new IllegalArgumentException("days must not be negative");
        }
        return BigDecimal.valueOf(principalCents)
                .multiply(annualRate)
                .multiply(BigDecimal.valueOf(days))
                .divide(BigDecimal.valueOf(360), 0, RoundingMode.HALF_UP)
                .longValueExact();
    }
}
