import { createPostGraphileSchema } from "postgraphile";
import { GraphQLSchema, printSchema } from "graphql";
import GlobalIdsPlugin from "..";

const DATABASE_URL = process.env.TEST_DATABASE_URL || "pggql_test";

let schema: GraphQLSchema;

beforeAll(async () => {
  schema = await createPostGraphileSchema(DATABASE_URL, "global_ids", {
    appendPlugins: [GlobalIdsPlugin],
  });
});

test("Schema matches snapshot", async () => {
  expect(printSchema(schema)).toMatchSnapshot();
});
