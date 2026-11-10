-- Demo salon for testing. Replace the phone number ID with yours from
-- Meta → WhatsApp → API Setup → "Phone number ID" (the test number is fine).

with s as (
  insert into salons (name, wa_phone_number_id, open_time, close_time, closed_days)
  values ('Demo Salon', 'REPLACE_WITH_PHONE_NUMBER_ID', '10:00', '20:00', '{}')
  returning id
),
st as (
  insert into staff (salon_id, name, off_days, sort)
  select s.id, x.name, x.off_days::int[], x.sort
  from s, (values ('Karthik', '{2}', 1), ('Arun', '{3}', 2), ('Vijay', '{1}', 3)) as x(name, off_days, sort)
  returning id
)
insert into services (salon_id, name, duration_min, price, sort)
select s.id, x.name, x.dur, x.price, x.sort
from s, (values
  ('Haircut',             30,  350, 1),
  ('Haircut + beard',     60,  550, 2),
  ('Beard trim',          30,  250, 3),
  ('Haircut + blow-dry',  60,  800, 4),
  ('Hair spa',            60, 1200, 5),
  ('Hair colour',        120, 2800, 6),
  ('Facial',              90, 1500, 7),
  ('Manicure',            60,  600, 8),
  ('Pedicure',            60,  700, 9)
) as x(name, dur, price, sort);
