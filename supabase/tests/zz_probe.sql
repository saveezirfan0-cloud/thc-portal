begin;
select plan(3);
\ir _shared/fixtures.psql
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from staff where id in (:'staffa', :'staffb')), 1, 'staff sees only self');
select is(current_user::text, 'authenticated', 'role switched');
reset role;
select is((select count(*)::int from staff where id in (:'staffa', :'staffb')), 2, 'owner sees both');
select * from finish();
rollback;
