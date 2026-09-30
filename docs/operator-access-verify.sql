-- Security regression check: all synthetic accounts, sessions and jobs roll back.
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous,raw_user_meta_data) values
 ('b0000000-0000-4000-8000-000000000001','authenticated','authenticated','operator-a@example.invalid',now(),false,'{}'),
 ('b0000000-0000-4000-8000-000000000002','authenticated','authenticated','operator-b@example.invalid',now(),false,'{"owner":true,"admin":true}');
insert into auth.sessions(id,user_id,created_at,updated_at) values
 ('c0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001',now(),now()),
 ('c0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000002',now(),now());
insert into public.operator_access(user_id) values ('b0000000-0000-4000-8000-000000000001');
insert into public.operator_jobs(task_id,user_id,apply_changes) values
 ('d0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001',false),
 ('d0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000002',false);

set local role anon;
do $$ begin
  begin perform public.operator_access_check();raise exception 'Anonymous RPC allowed';exception when insufficient_privilege then null;end;
  begin perform count(*) from public.operator_access;raise exception 'Anonymous membership read allowed';exception when insufficient_privilege then null;end;
  begin perform count(*) from public.operator_jobs;raise exception 'Anonymous jobs read allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"c0000000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
do $$ declare gate jsonb; begin
  gate=public.operator_access_check();
  if gate->>'active_session'<>'true' or gate->>'allowed'<>'true' then raise exception 'Owner gate failed';end if;
  if (select count(*) from public.operator_jobs)<>1 then raise exception 'Owner job isolation failed';end if;
  if (select count(*) from public.operator_access)<>1 then raise exception 'Membership isolation failed';end if;
  begin update public.operator_access set enabled=true;raise exception 'Self admission write allowed';exception when insufficient_privilege then null;end;
  begin insert into public.operator_jobs(task_id,user_id,apply_changes) values ('d0000000-0000-4000-8000-000000000099','b0000000-0000-4000-8000-000000000001',true);raise exception 'Client job forgery allowed';exception when insufficient_privilege then null;end;
  begin perform count(*) from public.coding_approvals;raise exception 'Client approvals visible';exception when insufficient_privilege then null;end;
  begin perform count(*) from public.tasks;raise exception 'Client server history visible';exception when insufficient_privilege then null;end;
  begin perform count(*) from auth.sessions;raise exception 'Private auth sessions visible';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"b0000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"c0000000-0000-4000-8000-000000000002","user_metadata":{"owner":true,"admin":true}}',true);
set local role authenticated;
do $$ declare gate jsonb; begin
  gate=public.operator_access_check();
  if gate->>'active_session'<>'true' or gate->>'allowed'<>'false' then raise exception 'Unadmitted account accepted';end if;
  if (select count(*) from public.operator_jobs)<>0 then raise exception 'Unadmitted account saw jobs';end if;
end $$;
reset role;
insert into public.operator_access(user_id) values ('b0000000-0000-4000-8000-000000000002');
set local role authenticated;
do $$ begin
  if (select count(*) from public.operator_jobs)<>1 then raise exception 'Second owner isolation failed';end if;
  if exists(select 1 from public.operator_jobs where task_id='d0000000-0000-4000-8000-000000000001') then raise exception 'Foreign task visible';end if;
  if public.operator_access_check()->>'allowed'<>'true' then raise exception 'Fresh membership not observed';end if;
end $$;
reset role;
update public.operator_access set enabled=false where user_id='b0000000-0000-4000-8000-000000000002';
set local role authenticated;
do $$ begin
  if public.operator_access_check()->>'allowed'<>'false' then raise exception 'Revoked access still allowed';end if;
  if (select count(*) from public.operator_jobs)<>0 then raise exception 'Disabled member saw jobs';end if;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"c0000000-0000-4000-8000-000000000002"}',true);
set local role authenticated;
do $$ begin
  if public.operator_access_check()->>'active_session'<>'false' then raise exception 'Borrowed session accepted';end if;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"c0000000-0000-4000-8000-000000000001"}',true);
delete from auth.sessions where id='c0000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ begin
  if public.operator_access_check()->>'active_session'<>'false' then raise exception 'Revoked session accepted';end if;
end $$;
reset role;
rollback;
select 'PASS: owner admission, two-account RLS, anonymous denial, client-write denial, revoked admission and revoked/borrowed sessions; test rows rolled back' as verification;
