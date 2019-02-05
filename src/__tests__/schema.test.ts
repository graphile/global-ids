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

test("Can run regular insert and update mutations", async () => {
  const { data, errors } = await withContext(context =>
    graphql(
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
    )
  );
  expect(errors).toBeFalsy();
  const {
    createItem: { item },
  } = data;
  const { id, ...restOfItem } = item;
  expect(restOfItem).toMatchInlineSnapshot(`
Object {
  "label": "Something",
  "nodeId": "WyJpdGVtcyIsMV0=",
  "personByPersonOrganizationIdAndPersonIdentifier": Object {
    "identifier": "2",
    "nodeId": "WyJwZW9wbGUiLDIsIjIiXQ==",
    "organizationId": 2,
  },
  "personIdentifier": "2",
  "personOrganizationId": 2,
}
`);
});
test.todo("Can run nodeId insert and update mutations");
test.todo(
  "Get an error from insert if neither fields nor node ID are specified"
);
