SELECT c.name, COUNT(o.id) AS orders
FROM customer c
LEFT JOIN address a ON a.customer_id = c.id
LEFT JOIN orders o ON o.customer_id = c.id
GROUP BY c.name
ORDER BY c.name;
