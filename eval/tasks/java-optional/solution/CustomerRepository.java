import java.util.List;
import java.util.Optional;

public class CustomerRepository {
    private final List<Customer> customers;

    public CustomerRepository(List<Customer> customers) {
        this.customers = customers;
    }

    /**
     * Optional rather than null, so that "not found" is part of the signature instead of a fact the
     * caller has to know. The NullPointerException used to surface in the caller, with a stack
     * trace pointing at code that was doing nothing wrong.
     */
    public Optional<Customer> find(String id) {
        return customers.stream().filter(c -> c.id().equals(id)).findFirst();
    }
}
