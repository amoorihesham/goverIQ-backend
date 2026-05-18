-- Reject any UPDATE or DELETE on audit_logs at the data-store level.
CREATE OR REPLACE FUNCTION audit_logs_append_only()
  RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only: % is not permitted', TG_OP;
END;
$$;

CREATE TRIGGER audit_logs_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();

-- Defence in depth (the trigger is the primary guard).
REVOKE UPDATE, DELETE ON audit_logs FROM PUBLIC;
