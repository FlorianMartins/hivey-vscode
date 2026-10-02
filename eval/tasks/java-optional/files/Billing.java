public class Billing {
    private final CustomerRepository repository;

    public Billing(CustomerRepository repository) {
        this.repository = repository;
    }

    public long creditFor(String id) {
        Customer customer = repository.find(id);
        return customer.creditCents();
    }
}
