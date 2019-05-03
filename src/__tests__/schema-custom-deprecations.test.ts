import { createPostGraphileSchema } from "postgraphile";
import { printSchema } from "graphql";
import { Pool } from "pg";
import GlobalIdsPlugin from "..";

const DATABASE_URL = process.env.TEST_DATABASE_URL || "pggql_test";
let pool: Pool;

beforeAll(() => {
  pool = new Pool({
    connectionString: DATABASE_URL,
  });
});
afterAll(() => {
  pool.end();
});

test("Schema matches snapshot - configured deprecations", async () => {
  const schemaWithDeprecations = await createPostGraphileSchema(
    pool,
    "global_ids",
    {
      appendPlugins: [GlobalIdsPlugin],
      graphileBuildOptions: {
        globalIdDeprecationReason: "Deprecated",
        globalIdShouldDeprecate: attr => attr.name === "id",
      },
    }
  );
  expect(printSchema(schemaWithDeprecations)).toMatchSnapshot();
});
