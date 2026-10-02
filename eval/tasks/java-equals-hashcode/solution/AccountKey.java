import java.util.Objects;

public final class AccountKey {
    private final String company;
    private final String number;

    public AccountKey(String company, String number) {
        this.company = company;
        this.number = number;
    }

    @Override
    public boolean equals(Object other) {
        if (this == other) {
            return true;
        }
        if (!(other instanceof AccountKey)) {
            return false;
        }
        AccountKey that = (AccountKey) other;
        return company.equals(that.company) && number.equals(that.number);
    }

    /**
     * equals without hashCode is not a missing method, it is a broken contract: two equal objects
     * are required to have the same hash, and a HashMap that put one in bucket 7 looks for the
     * other in bucket 412. The entry is still there and can never be found again.
     */
    @Override
    public int hashCode() {
        return Objects.hash(company, number);
    }
}
