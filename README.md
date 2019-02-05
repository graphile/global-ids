# @graphile/global-ids

Allows you to use Relay global object identifiers in more places.

## Purpose

Currently (v4.3.2) PostGraphile has support for Relay Global Object Identifiers:

- On every table output type, primarily useful for caching
- Fetching via the `{node:(nodeId: ...) {...}}` interface
- Fetching via the table-specific `{myTable(nodeId: ...) {...}}` interface
- Mutating via the `mutation {updateMyTable(input:{nodeId: ..., ...}){...}}` interface

However, you still have to use the underlying primary keys in many places:

- When referencing references to related tables: `mutation {updatePerson(input:{nodeId: ..., patch: {organizationId: 7}}){...}}`
- When calling SQL functions
- When dealing with custom types
- More places?

This plugin aims to let you use global IDs in more places.

## Status: Experimental

APIs in this plugin will currently be changing based on feedback from the
sponsor, if you use this plugin in your stack expect your GraphQL API to
change shape over time until the dust settles.

Progress:

- [x] Write initial README
- [x] Add nodeId support to relations in create mutations
- [x] Add nodeId support to relations in update mutations
- [x] Update README with instructions
- [ ] Add nodeId support to relations in condition input
- [ ] Add nodeId support to custom queries
- [ ] Add nodeId support to custom mutations
- [ ] Add nodeId support to computed columns (as secondary input)
- [ ] Update README with instructions

## Usage

Install:

```bash
yarn add @graphile/global-ids
```

Load on command line:

```bash
postgraphile --append-plugins @graphile/global-ids
```

Load in library usage:

```js
app.use(
  postgraphile(DB, SCHEMA, {
    //...
    appendPlugins: [require("@graphile/global-ids").default],
  })
);
```

Now you can choose to specify the NodeIDs through create/update mutations
instead of specifying the individual columns.

## Why is this not part of PostGraphile core?

Going all-out on NodeIDs is a large undertaking right now. The hybrid
approach this plugin takes moves some errors to run-time instead of
build-time, and I don't want to compromise the default user experience.

Imagine you have a schema like in [`./schema.sql`](./schema.sql). You could
issue a mutation such as:

```graphql
mutation CreateUser(
  $user: UserInput = { organizationId: 27, name: "Bobby Tables" }
) {
  createUser(input: { user: $user }) {
    user {
      nodeId
    }
  }
}
```

The input object `UserInput` defines which fields are required:

```graphql
input UserInput {
  organizationId: Int!
  uuid: UUID
  name: String!
}
```

If you were to omit the `organizationId` then that would be a compile-time error.

However, this plugin allows you to specify _either_ `organizationId` _or_
`organizationNodeId`; and GraphQL currently does not have a way of
representing this data requirement. So we have to handle validation of the
query at run-time, when the mutation is executed, because the new `UserInput`
type will look like:

```graphql
input UserInput {
  organizationId: Int
  organizationNodeId: ID
  uuid: UUI
  name: String!
}
```

It looks like both these `organization*` fields are optional, users have to
run the mutations to find out that they've missed a field that's implicitly
rather than explicitly required.

This may change depending on progress on https://github.com/facebook/graphql/pull/395

The aim of this plugin is to introduce a hybrid approach for teams that
wish to use NodeID everywhere, so we can discover everywhere it's necessary,
and then in a later version of PostGraphile we may add a flag to alternate
between the two methodologies.

## Sponsorship

This plugin is sponsored by MRI Technologies.
