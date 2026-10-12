.mode list
.separator |
-- An aggregate picks the maximum of ONE column; the other columns come from whichever row the
-- engine happened to be holding, which is not the row the maximum came from. Ranking the rows and
-- keeping the first names the row explicitly.
WITH ranked AS (
  SELECT currency, on_date, rate,
         ROW_NUMBER() OVER (PARTITION BY currency ORDER BY on_date DESC) AS n
    FROM rate
)
SELECT currency, on_date, rate
  FROM ranked
 WHERE n = 1
 ORDER BY currency;
