-- The equality first, the range second. An index on (booked_on, account_id) could not use the
-- account at all once the range had been opened; this one seeks the account and then walks the
-- dates in order.
CREATE INDEX movement_account_booked ON movement (account_id, booked_on);
