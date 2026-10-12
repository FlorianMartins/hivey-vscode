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
}
