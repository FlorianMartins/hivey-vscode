import java.util.List;

public class CustomerRepository {
    private final List<Customer> customers;

    public CustomerRepository(List<Customer> customers) {
        this.customers = customers;
    }

    public Customer find(String id) {
        for (Customer c : customers) {
            if (c.id().equals(id)) {
                return c;
            }
        }
        return null;
    }
}
