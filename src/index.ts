import { Plugin } from "postgraphile";
import { PgConstraint, PgAttribute, PgClass } from "graphile-build-pg";
import {
  makePluginByCombiningPlugins,
  makeWrapResolversPlugin,
} from "graphile-utils";

function isForeignKey(c: PgConstraint): boolean {
  return c.type === "f";
}

function containsColumn(c: PgConstraint, attr: PgAttribute): boolean {
  return c.keyAttributes.includes(attr);
}

// Find the relevant input types:
//
// - FooInput (isInputType)
// - FooBaseInput (isPgBaseInput)
// - FooPatch (isPgPatch)
//
// Apply changes:
//
// - Make foreign key fields optional (applies only to FooInput)
// - Add optional node identifier fields
//
// Finally wrap the resolver to overwrite the relevant args.

const GlobalIdExtensionsTweakFieldsPlugin: Plugin = function(builder) {
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

  builder.hook("GraphQLInputObjectType:fields", function AddNewNodeIdFields(
    fields,
    build,
    context
  ) {
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

const GlobalIdExtensionsPlugin = makePluginByCombiningPlugins(
  GlobalIdExtensionsTweakFieldsPlugin,
  makeWrapResolversPlugin(
    (context, _build, _field, _options) => {
      const {
        scope: { isRootMutation, pgIntrospection },
      } = context;
      if (
        !isRootMutation ||
        !pgIntrospection ||
        pgIntrospection.kind !== "class"
      ) {
        return null;
      }
      const table: PgClass = pgIntrospection;
      return {
        table,
      };
    },
    ({ table }) => (resolver, parent, args, context, resolveInfo) => {
      const newArgs = {
        ...args,
      };
      table;
      return resolver(parent, newArgs, context, resolveInfo);
    }
  )
);

export default GlobalIdExtensionsPlugin;
