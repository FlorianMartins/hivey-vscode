DROP TABLE IF EXISTS payment;
DROP TABLE IF EXISTS line;
DROP TABLE IF EXISTS invoice;

CREATE TABLE invoice (id INTEGER PRIMARY KEY, customer TEXT NOT NULL);
CREATE TABLE line (invoice_id INTEGER NOT NULL, cents INTEGER NOT NULL);
CREATE TABLE payment (invoice_id INTEGER NOT NULL, cents INTEGER NOT NULL);

INSERT INTO invoice VALUES (1, 'Durand'), (2, 'Lefevre'), (3, 'Moreau');
-- Invoice 1 has three lines and two payments: the fan-out multiplies both sides.
INSERT INTO line VALUES (1, 1000), (1, 500), (1, 250), (2, 400), (3, 100), (3, 100);
INSERT INTO payment VALUES (1, 1000), (1, 750), (2, 400);
