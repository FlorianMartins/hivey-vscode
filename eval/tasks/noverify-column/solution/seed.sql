-- Named columns, so a new one cannot break them again.
insert into notes (id, title, body) values (1, 'First', 'hello');
insert into notes (id, title, body) values (2, 'Second', 'world');
insert into notes (id, title, body) values (3, 'Third', 'again');
