-- A sent/current quote version cannot gain line items after it becomes authoritative.
-- A later version may be assembled while the preceding version remains sent.
CREATE FUNCTION guard_quote_item_insert() RETURNS trigger AS $$
DECLARE
    version_number INT;
    current_number INT;
BEGIN
    SELECT qv.version_no, q.current_version_no
      INTO version_number, current_number
      FROM quote_versions qv
      JOIN quotes q ON q.id = qv.quote_id
     WHERE qv.id = NEW.quote_version_id
     FOR UPDATE OF q;

    IF version_number IS NULL THEN
        RETURN NEW; -- The foreign key reports the missing version.
    END IF;
    IF version_number <= current_number THEN
        RAISE EXCEPTION 'Historical quote items are immutable; create a new version.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_quote_items_guard_insert BEFORE INSERT ON quote_items
    FOR EACH ROW EXECUTE FUNCTION guard_quote_item_insert();
