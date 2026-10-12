DROP TABLE IF EXISTS payment;
DROP TABLE IF EXISTS invoice;

CREATE TABLE invoice (id INTEGER PRIMARY KEY, customer TEXT NOT NULL);
-- invoice_id is nullable: a payment arrives on the account before anyone knows which invoice.
CREATE TABLE payment (id INTEGER PRIMARY KEY, invoice_id INTEGER, cents INTEGER NOT NULL);

INSERT INTO invoice VALUES (1, 'Durand'), (2, 'Lefevre'), (3, 'Moreau');
INSERT INTO payment VALUES (1, 1, 1000), (2, NULL, 500), (3, 1, 250);
