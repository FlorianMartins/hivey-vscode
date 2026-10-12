public class Billing {
    private final CustomerRepository repository;

    public Billing(CustomerRepository repository) {
        this.repository = repository;
    }

    public long creditFor(String id) {
        return repository.find(id)
                .map(Customer::creditCents)
                .orElseThrow(() -> new IllegalArgumentException("no such customer: " + id));
    }
}
