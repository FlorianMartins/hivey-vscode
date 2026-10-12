DROP TABLE IF EXISTS rate;
CREATE TABLE rate (currency TEXT NOT NULL, on_date TEXT NOT NULL, rate TEXT NOT NULL);
INSERT INTO rate VALUES
  ('USD', '2026-09-30', '1.1050'),
  ('USD', '2026-10-01', '1.1120'),
  ('USD', '2026-10-02', '1.1085'),
  ('CHF', '2026-10-01', '0.9410'),
  ('CHF', '2026-10-02', '0.9365'),
  ('GBP', '2026-10-02', '0.8710');
