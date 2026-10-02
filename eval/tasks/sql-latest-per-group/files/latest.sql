.mode list
.separator |
-- "column must appear in the GROUP BY clause" — so the column was added to the GROUP BY.
SELECT currency, MAX(on_date) AS on_date, rate
  FROM rate
 GROUP BY currency, rate
 ORDER BY currency;
