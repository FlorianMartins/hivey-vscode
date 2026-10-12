CREATE TABLE customer (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE address (id INTEGER PRIMARY KEY, customer_id INTEGER, city TEXT);
CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER, total REAL);

INSERT INTO customer VALUES (1, 'Dupont'), (2, 'Martin');
INSERT INTO address VALUES (1, 1, 'Lyon'), (2, 1, 'Paris'), (3, 2, 'Lille');
INSERT INTO orders VALUES (1, 1, 10.0), (2, 1, 20.0), (3, 2, 5.0);
