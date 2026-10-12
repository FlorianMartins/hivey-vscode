.mode list
.separator |
-- NOT IN over a subquery containing NULL is never true: `id <> NULL` is unknown, so the whole
-- condition is unknown for every row and nothing comes back. NOT EXISTS asks the question that was
-- meant — is there a payment for this invoice — and an unmatched NULL simply does not match.
SELECT i.id, i.customer
  FROM invoice i
 WHERE NOT EXISTS (SELECT 1 FROM payment p WHERE p.invoice_id = i.id)
 ORDER BY i.id;
