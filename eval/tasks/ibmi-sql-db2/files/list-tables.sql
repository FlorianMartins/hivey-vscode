SELECT table_name, n_live_tup AS rows
FROM information_schema.tables
JOIN pg_stat_user_tables ON relname = table_name
WHERE table_schema = 'saleslib'
ORDER BY n_live_tup DESC;
