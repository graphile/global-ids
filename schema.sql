drop schema if exists app_public, app_private, app_hidden cascade;
set search_path to public;

create extension if not exists pgcrypto;

create schema app_public;
set search_path to app_public, public;

create table organizations (
  id serial primary key,
  name text not null
);

create table users (
  organization_id int not null references organizations on delete cascade,
  uuid uuid not null default gen_random_uuid(),
  name text not null,
  primary key(organization_id, uuid)
);
