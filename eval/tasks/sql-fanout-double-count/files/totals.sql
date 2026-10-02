.mode list
.separator |
SELECT i.id,
       i.customer,
       COALESCE(SUM(l.cents), 0)  AS billed,
       COALESCE(SUM(p.cents), 0)  AS paid
  FROM invoice i
  LEFT JOIN line l    ON l.invoice_id = i.id
  LEFT JOIN payment p ON p.invoice_id = i.id
 GROUP BY i.id, i.customer
 ORDER BY i.id;
