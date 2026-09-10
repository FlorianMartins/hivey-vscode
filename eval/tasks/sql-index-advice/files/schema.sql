CREATE TABLE movement (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL,
  booked_on TEXT NOT NULL,
  amount REAL NOT NULL
);
