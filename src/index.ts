import { Plugin } from "postgraphile";
import { PgConstraint, PgAttribute, PgClass } from "graphile-build-pg";

function isForeignKey(c: PgConstraint): boolean {
  return c.type === "f";
}

function containsColumn(c: PgConstraint, attr: PgAttribute): boolean {
  return c.keyAttributes.includes(attr);
}

const GlobalIdExtensionsPlugin: Plugin = function(builder) {
  // Find the relevant input types:
  //
  // - FooInput
  // - FooBaseInput
  // - FooPatch
  //
  // Apply changes:
  //
  // - Make foreign key fields optional (not required)
  // - Add optional node identifier fields
  //
  // Finally wrap the resolver to overwrite the relevant args.

  builder.hook(
    "GraphQLInputObjectType:fields:field",
    function MakeForeignKeyInputFieldsNullable(field, build, context) {
      const {
        graphql: { getNullableType },
      } = build;
      const {
        scope: {
          isPgRowType,
          isInputType,
          pgIntrospection,
          pgFieldIntrospection,
        },
      } = context;

      if (
        !isPgRowType ||
        !isInputType ||
        pgIntrospection.kind !== "class" ||
        pgFieldIntrospection.kind !== "attribute"
      ) {
        return field;
      }
      const table: PgClass = pgIntrospection;
      const attr: PgAttribute = pgFieldIntrospection;

      // If this field belongs to a foreign key, mark it nullable.
      if (
        table.constraints.some(c => isForeignKey(c) && containsColumn(c, attr))
      ) {
        return {
          ...field,
          type: getNullableType(field.type),
        };
      }

      return field;
    }
  );
  builder.hook("GraphQLInputObjectType:fields", (fields, build, context) => {
    const {
      extend,
      graphql: { GraphQLID },
      inflection,
    } = build;
    const {
      scope: {
        isPgRowType,
        isInputType,
        isPgPatch,
        isPgBaseInput,
        pgIntrospection,
      },
      fieldWithHooks,
    } = context;

    if (
      !isPgRowType ||
      !(isInputType || isPgPatch || isPgBaseInput) ||
      pgIntrospection.kind !== "class"
    ) {
      return fields;
    }
    const table: PgClass = pgIntrospection;
    const foreignKeys = table.constraints.filter(isForeignKey);
    return foreignKeys.reduce((memo, fk) => {
      // @ts-ignore
      const foreignTable: PgClass = fk.foreignClass;
      const fieldName = inflection.singleRelationByKeys(
        fk.keyAttributes,
        foreignTable,
        table,
        fk
      );
      return extend(memo, {
        [fieldName]: fieldWithHooks(
          fieldName,
          {
            type: GraphQLID,
          },
          {
            pgFieldIntrospection: fk,
            isPgForeignKeyNodeIdField: true,
          }
        ),
      });
    }, fields);
  });
};

export default GlobalIdExtensionsPlugin;
