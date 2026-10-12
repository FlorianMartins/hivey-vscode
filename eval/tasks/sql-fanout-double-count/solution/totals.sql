.mode list
.separator |
-- Each side aggregated BEFORE it is joined. Joining two one-to-many tables at once multiplies the
-- rows of each by the rows of the other, so every SUM counts each value as many times as the other
-- table had matches — three lines and two payments gave six of each.
SELECT i.id,
       i.customer,
       COALESCE(l.cents, 0) AS billed,
       COALESCE(p.cents, 0) AS paid
  FROM invoice i
  LEFT JOIN (SELECT invoice_id, SUM(cents) AS cents FROM line    GROUP BY invoice_id) l ON l.invoice_id = i.id
  LEFT JOIN (SELECT invoice_id, SUM(cents) AS cents FROM payment GROUP BY invoice_id) p ON p.invoice_id = i.id
 ORDER BY i.id;
