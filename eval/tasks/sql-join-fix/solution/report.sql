-- The addresses are not joined at all: the question is about orders, and joining a second
-- one-to-many table multiplied every order row by the number of addresses the customer had.
SELECT c.name, COUNT(o.id) AS orders
FROM customer c
LEFT JOIN orders o ON o.customer_id = c.id
GROUP BY c.name
ORDER BY c.name;
