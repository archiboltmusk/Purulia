-- Cleanup drives were removed from the site on 2026-10-08 and nothing calls these RPCs.
-- Revoke public execute so the anon key can no longer reach them (advisor 0028).
-- Idempotent: revoking an already-revoked privilege is a no-op.
do $do$
begin
  if to_regprocedure('public.kasa_drives()') is not null then
    revoke execute on function public.kasa_drives() from public, anon, authenticated;
  end if;
  if to_regprocedure('public.kasa_drive_going(uuid)') is not null then
    revoke execute on function public.kasa_drive_going(uuid) from public, anon, authenticated;
  end if;
end $do$;
