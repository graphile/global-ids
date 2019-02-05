import { createPostGraphileSchema } from "postgraphile";
import { GraphQLSchema, printSchema, graphql } from "graphql";
import { Pool } from "pg";
import GlobalIdsPlugin from "..";

const DATABASE_URL = process.env.TEST_DATABASE_URL || "pggql_test";

let schema: GraphQLSchema;
let pool: Pool;

beforeAll(() => {
  pool = new Pool({
    connectionString: DATABASE_URL,
  });
});
afterAll(() => {
  pool.end();
});

async function withContext<T>(cb: (context: any) => Promise<T>) {
  const client = await pool.connect();
  await client.query("begin");
  try {
    const context = {
      pgClient: client,
    };
    return await cb(context);
  } finally {
    // rollback
    try {
      await client.query("rollback");
    } finally {
      await client.release();
    }
  }
}

beforeAll(async () => {
  schema = await createPostGraphileSchema(DATABASE_URL, "global_ids", {
    appendPlugins: [GlobalIdsPlugin],
  });
});

test("Schema matches snapshot", async () => {
  expect(printSchema(schema)).toMatchSnapshot();
});

test("Can run regular insert and update mutations", () =>
  withContext(async context => {
    const createResult = await graphql(
      schema,
      `
        mutation {
          createItem(
            input: {
              item: {
                personOrganizationId: 2
                personIdentifier: "2"
                label: "Something"
              }
            }
          ) {
            item {
              nodeId
              id
              personByPersonOrganizationIdAndPersonIdentifier {
                nodeId
                organizationId
                identifier
              }
              personOrganizationId
              personIdentifier
              label
            }
          }
        }
      `,
      null,
      context,
      {},
      null
    );
    expect(createResult.errors).toBeFalsy();
    expect(createResult.data).toBeTruthy();
    const {
      createItem: { item },
    } = createResult.data!;
    const { id, nodeId, ...restOfItem } = item;
    expect(restOfItem).toMatchInlineSnapshot(`
Object {
  "label": "Something",
  "personByPersonOrganizationIdAndPersonIdentifier": Object {
    "identifier": "2",
    "nodeId": "WyJwZW9wbGUiLDIsIjIiXQ==",
    "organizationId": 2,
  },
  "personIdentifier": "2",
  "personOrganizationId": 2,
}
`);

    const updateResult = await graphql(
      schema,
      `
        mutation($nodeId: ID!) {
          updateItem(
            input: { nodeId: $nodeId, itemPatch: { label: "Gadget" } }
          ) {
            item {
              nodeId
              id
              personByPersonOrganizationIdAndPersonIdentifier {
                nodeId
                organizationId
                identifier
              }
              personOrganizationId
              personIdentifier
              label
            }
          }
        }
      `,
      null,
      context,
      { nodeId },
      null
    );
    expect(updateResult.errors).toBeFalsy();
    expect(updateResult.data).toBeTruthy();
    const {
      updateItem: { item: updatedItem },
    } = updateResult.data!;
    const {
      id: updatedId,
      nodeId: updatedNodeId,
      ...restOfUpdatedItem
    } = updatedItem;
    expect(restOfUpdatedItem).toMatchInlineSnapshot(`
Object {
  "label": "Gadget",
  "personByPersonOrganizationIdAndPersonIdentifier": Object {
    "identifier": "2",
    "nodeId": "WyJwZW9wbGUiLDIsIjIiXQ==",
    "organizationId": 2,
  },
  "personIdentifier": "2",
  "personOrganizationId": 2,
}
`);
  }));

test("Can run nodeId insert and update mutations", () =>
  withContext(async context => {
    const createResult = await graphql(
      schema,
      `
        mutation {
          createItem(
            input: {
              item: {
                personByPersonOrganizationIdAndPersonIdentifier: "WyJwZW9wbGUiLDIsIjIiXQ=="
                label: "Something"
              }
            }
          ) {
            item {
              nodeId
              id
              personByPersonOrganizationIdAndPersonIdentifier {
                nodeId
                organizationId
                identifier
              }
              personOrganizationId
              personIdentifier
              label
            }
          }
        }
      `,
      null,
      context,
      {},
      null
    );
    expect(createResult.errors).toBeFalsy();
    expect(createResult.data).toBeTruthy();
    const {
      createItem: { item },
    } = createResult.data!;
    const { id, nodeId, ...restOfItem } = item;
    expect(restOfItem).toMatchInlineSnapshot(`
Object {
  "label": "Something",
  "personByPersonOrganizationIdAndPersonIdentifier": Object {
    "identifier": "2",
    "nodeId": "WyJwZW9wbGUiLDIsIjIiXQ==",
    "organizationId": 2,
  },
  "personIdentifier": "2",
  "personOrganizationId": 2,
}
`);

    const updateResult = await graphql(
      schema,
      `
        mutation($nodeId: ID!) {
          updateItem(
            input: {
              nodeId: $nodeId
              itemPatch: {
                label: "Gadget"
                personByPersonOrganizationIdAndPersonIdentifier: "WyJwZW9wbGUiLDIsIjMiXQ=="
              }
            }
          ) {
            item {
              nodeId
              id
              personByPersonOrganizationIdAndPersonIdentifier {
                nodeId
                organizationId
                identifier
              }
              personOrganizationId
              personIdentifier
              label
            }
          }
        }
      `,
      null,
      context,
      { nodeId },
      null
    );
    expect(updateResult.errors).toBeFalsy();
    expect(updateResult.data).toBeTruthy();
    const {
      updateItem: { item: updatedItem },
    } = updateResult.data!;
    const {
      id: updatedId,
      nodeId: updatedNodeId,
      ...restOfUpdatedItem
    } = updatedItem;
    expect(restOfUpdatedItem).toMatchInlineSnapshot(`
Object {
  "label": "Gadget",
  "personByPersonOrganizationIdAndPersonIdentifier": Object {
    "identifier": "3",
    "nodeId": "WyJwZW9wbGUiLDIsIjMiXQ==",
    "organizationId": 2,
  },
  "personIdentifier": "3",
  "personOrganizationId": 2,
}
`);
  }));

test("Get an error from insert if neither fields nor node ID are specified", () =>
  withContext(async context => {
    const createResult = await graphql(
      schema,
      `
        mutation {
          createItem(input: { item: { label: "Something" } }) {
            item {
              nodeId
              id
              personByPersonOrganizationIdAndPersonIdentifier {
                nodeId
                organizationId
                identifier
              }
              personOrganizationId
              personIdentifier
              label
            }
          }
        }
      `,
      null,
      context,
      {},
      null
    );
    expect(createResult.errors).toBeTruthy();
    expect(createResult.errors).toMatchInlineSnapshot(`
Array [
  [GraphQLError: null value in column "person_organization_id" violates not-null constraint],
]
`);
  }));

test("Get an error from insert if both are specified and they don't agree", () =>
  withContext(async context => {
    const createResult = await graphql(
      schema,
      `
        mutation {
          createItem(
            input: {
              item: {
                label: "Something"
                personByPersonOrganizationIdAndPersonIdentifier: "WyJwZW9wbGUiLDIsIjIiXQ=="
                personOrganizationId: 2
                personIdentifier: "3" # Disagrees with above nodeId
              }
            }
          ) {
            item {
              nodeId
              id
              personByPersonOrganizationIdAndPersonIdentifier {
                nodeId
                organizationId
                identifier
              }
              personOrganizationId
              personIdentifier
              label
            }
          }
        }
      `,
      null,
      context,
      {},
      null
    );
    expect(createResult.errors).toBeTruthy();
    expect(createResult.errors).toMatchInlineSnapshot(`
Array [
  [GraphQLError: Cannot specify the individual keys and the relation nodeId with different values.],
]
`);
  }));

test("No error from insert if both are specified and they do agree", () =>
  withContext(async context => {
    const createResult = await graphql(
      schema,
      `
        mutation {
          createItem(
            input: {
              item: {
                label: "Something"
                personByPersonOrganizationIdAndPersonIdentifier: "WyJwZW9wbGUiLDIsIjIiXQ=="
                personOrganizationId: 2
                personIdentifier: "2" # Agrees with above nodeId
              }
            }
          ) {
            item {
              nodeId
              id
              personByPersonOrganizationIdAndPersonIdentifier {
                nodeId
                organizationId
                identifier
              }
              personOrganizationId
              personIdentifier
              label
            }
          }
        }
      `,
      null,
      context,
      {},
      null
    );
    expect(createResult.errors).toBeFalsy();
    expect(createResult.data).toBeTruthy();
    const {
      createItem: { item },
    } = createResult.data!;
    const { id, nodeId, ...restOfItem } = item;
    expect(restOfItem).toMatchInlineSnapshot(`
Object {
  "label": "Something",
  "personByPersonOrganizationIdAndPersonIdentifier": Object {
    "identifier": "2",
    "nodeId": "WyJwZW9wbGUiLDIsIjIiXQ==",
    "organizationId": 2,
  },
  "personIdentifier": "2",
  "personOrganizationId": 2,
}
`);
  }));

test.todo(
  "Get an error from update if both are specified and they don't agree"
);
