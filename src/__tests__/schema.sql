drop schema if exists global_ids cascade;

create schema global_ids;
set search_path to global_ids, public;

create table organizations (
  id serial primary key,
  name text not null,
  created_at timestamptz not null default now()
);

create table people (
  organization_id int not null references organizations on delete cascade,
  identifier text not null,
  name text not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, identifier)
);

create table items (
  id serial primary key,
  person_organization_id int not null,
  person_identifier text not null,
  label text not null,
  created_at timestamptz not null default now(),
  foreign key (person_organization_id, person_identifier) references people on delete cascade
);

insert into organizations (name) values
  ('The A Team'),
  ('Bob''s Uncles'),
  ('Charlie''s Angles'),
  ('Dave''s Protractors');

insert into people (organization_id, identifier, name) values
  (1, 'Colonel', 'Hannibal'),
  (1, 'Lieutenant', 'Faceman'),
  (1, 'Pilot', 'Howling Mad'),
  (1, 'Sergeant', 'Bad Attitude'),
  (2, '1', 'Robert'),
  (2, '2', 'Robby'),
  (2, '3', 'Robin'),
  (2, '4', 'Bob'),
  (2, '5', 'Roberto'),
  (3, '90', 'Right'),
  (3, '150', 'Obtuse'),
  (3, '34', 'Acute'),
  (3, '260', 'Reflex'),
  (4, 'green', 'Green Protractor');