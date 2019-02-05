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
    (context, build, _field, _options) => {
      const {
        scope: {
          isRootMutation,
          pgFieldIntrospection,
          isPgCreateMutationField,
          isPgUpdateMutationField,
        },
      } = context;
      const {
        inflection,
        getTypeAndIdentifiersFromNodeId,
        pgGetGqlTypeByTypeIdAndModifier,
      } = build;
      if (
        !isRootMutation ||
        !pgFieldIntrospection ||
        !(isPgCreateMutationField || isPgUpdateMutationField) ||
        pgFieldIntrospection.kind !== "class"
      ) {
        return null;
      }
      const table: PgClass = pgFieldIntrospection;
      const inputOrPatchFieldName = isPgCreateMutationField
        ? inflection.tableFieldName(table)
        : inflection.patchField(inflection.tableFieldName(table));
      return {
        table,
        inflection,
        getTypeAndIdentifiersFromNodeId,
        pgGetGqlTypeByTypeIdAndModifier,
        inputOrPatchFieldName,
      };
    },
    ({
      table,
      inflection,
      getTypeAndIdentifiersFromNodeId,
      pgGetGqlTypeByTypeIdAndModifier,
      inputOrPatchFieldName,
    }) => (resolver, parent, args, context, resolveInfo) => {
      // TODO: move as much of this logic into the filter as we can so we can
      // avoid runtime inflection, type lookup, etc
      const obj = {
        ...args.input[inputOrPatchFieldName],
      };
      const newArgs = {
        ...args,
        input: {
          ...args.input,
          [inputOrPatchFieldName]: obj,
        },
      };
      const foreignKeys = table.constraints.filter(isForeignKey);
      for (const fk of foreignKeys) {
        // @ts-ignore
        const foreignTable: PgClass = fk.foreignClass;
        const TableType = pgGetGqlTypeByTypeIdAndModifier(
          foreignTable.type.id,
          null
        );
        const fieldName = inflection.singleRelationByKeys(
          fk.keyAttributes,
          foreignTable,
          table,
          fk
        );
        if (obj[fieldName]) {
          const nodeId = obj[fieldName];
          const { Type, identifiers } = getTypeAndIdentifiersFromNodeId(nodeId);
          if (Type !== TableType) {
            return null;
          }
          fk.keyAttributes.forEach((attr, i) => {
            const keyFieldName = inflection.column(attr);
            const value = identifiers[i];
            if (
              obj[keyFieldName] !== undefined &&
              obj[keyFieldName] !== value
            ) {
              throw new Error(
                "Cannot specify the individual keys and the relation nodeId with different values."
              );
            }
            obj[keyFieldName] = value;
          });
          // We're no longer used, so clean us up
          delete obj[fieldName];
        }
      }
      return resolver(parent, newArgs, context, resolveInfo);
    }
  )
);

export default GlobalIdExtensionsPlugin;
