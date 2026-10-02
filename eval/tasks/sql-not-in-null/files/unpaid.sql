.mode list
.separator |
SELECT id, customer
  FROM invoice
 WHERE id NOT IN (SELECT invoice_id FROM payment)
 ORDER BY id;
