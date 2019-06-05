import { Plugin } from "graphile-build";
import { PgConstraint, PgAttribute, PgClass, QueryBuilder, sql as SQL } from "graphile-build-pg";
import {
  makePluginByCombiningPlugins,
  makeWrapResolversPlugin,
} from "graphile-utils";
import { GraphQLFieldConfig } from "graphql";

function isForeignKey(c: PgConstraint): boolean {
  const pk = c.foreignClass && c.foreignClass.primaryKeyConstraint;
  return c.type === "f" && !!pk && pk.keyAttributes.every(a => c.foreignKeyAttributes.includes(a));
}

function containsSingleColumn(
  c: PgConstraint | void,
  attr: PgAttribute
): boolean {
  return (
    c != null && c.keyAttributes.length === 1 && c.keyAttributes[0] === attr
  );
}

function containsColumn(c: PgConstraint, attr: PgAttribute): boolean {
  return c.keyAttributes.includes(attr);
}

interface OmitContext {
  isPgCondition: boolean;
  isPgBaseInput: boolean;
  isPgPatch: boolean
}

type OmitAction = "filter" | "base" | "update" | "create";

function toOmitAction({ isPgCondition, isPgBaseInput, isPgPatch }: OmitContext): OmitAction {
  return isPgCondition
    ? "filter"
    : isPgBaseInput
      ? "base"
      : isPgPatch ? "update" : "create";
}

function getNodeIdRelations(table: PgClass, build: any, context?: OmitContext) {
  const action = context ? toOmitAction(context) : "filter";

  return table.constraints
    .filter(isForeignKey)
    .filter(c => !build.pgOmit(c, action))
    .map((constraint) => {
      const sql: typeof SQL = build.pgSql;
      const foreignTable = constraint.foreignClass as PgClass;
      const TableType = build.pgGetGqlTypeByTypeIdAndModifier(
        foreignTable.type.id,
        null
      );
      const fieldName: string = build.inflection.singleRelationByKeys(
        constraint.keyAttributes,
        foreignTable,
        table,
        constraint
      );

      return {
        fieldName,
        constraint,
        TableType,
        // tslint:disable: no-unnecessary-type-annotation
        fromSingleNodeId(nodeId: string) {
          const { Type, identifiers } = nodeId
            ? build.getTypeAndIdentifiersFromNodeId(nodeId)
            : { Type: TableType, identifiers: null };

          if (Type !== TableType) {
            // TODO: error?
            return [];
          }

          return constraint.keyAttributes.map((attr, i) => {
            const value = identifiers && identifiers[i];
            // const foreignAttr = constraint.foreignKeyAttributes[i];
            return {
              columnName: attr.name,
              fieldName: build.inflection.column(attr) as string,
              // foreignColumnName: foreignAttr.name,
              // foreignFieldName: build.inflection.column(foreignAttr),
              value,
            };
          });
        },
        fromNodeId(nodeId: string | Array<string>) {
          if (nodeId === undefined) {
            return [];
          }

          const nodeIds = Array.isArray(nodeId) ? nodeId : [ nodeId ];
          return nodeIds.map(id => this.fromSingleNodeId(id));
        },
        sqlWhere(nodeId: string | Array<string>, builder: QueryBuilder) {
          const parsed = this.fromNodeId(nodeId);

          if (parsed.length === 0) {
            return;
          }

          const localColumns = parsed[0].map(p => sql.identifier(p.columnName));

          const values = parsed.reduce((memo, relation) => {
            const tuple = relation.map(({ value }) => sql.value(value));
            memo.push(sql.fragment`(${sql.join(tuple, ',')})`);
            return memo;
          }, [] as Array<Array<SQL.SQLNode>>);

          builder.where(sql.fragment`
            (${sql.join(localColumns, ',')}) IN (${sql.join(values, ',')})
          `);

          // TODO: this plugin is currently restricted to FK relations based on PKs
          //   in the future, lifting this constraint will require more sophisticated
          //   query building a la:

          // builder.where(sql.fragment`
          //   (${sql.join(localColumns, ',')}) IN (
          //     SELECT ${sql.join(remoteColumns, ',')}
          //     FROM ${sql.identifier(this.TableType.name)}
          //     WHERE ${sql.join(remotePKColumns, ',')} IN (${sql.join(values, ',')})
          //   )
          // `);
        }
        // tslint:enable: no-unnecessary-type-annotation
      };
    });
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

type DeprecationSelector = boolean | ((attr: PgAttribute) => boolean);
type DeprecationReason = string | ((preferredField: string) => string);

export interface GlobalIdPluginOptions {
  globalIdShouldDeprecate?: DeprecationSelector;
  globalIdDeprecationReason?: DeprecationReason;
}

const GlobalIdExtensionsTweakFieldsPlugin: Plugin = (builder, config) => {
  const options: GlobalIdPluginOptions = {
    globalIdShouldDeprecate: false,
    globalIdDeprecationReason: preferredField =>
      `Prefer using the Relay global identifier property \`${preferredField}\` instead.`,

    ...config,
  };

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

      const foreignKeys = getNodeIdRelations(table, build);

      // If this field belongs to a foreign key, mark it nullable.
      if (
        foreignKeys.some(f => containsColumn(f.constraint, attr))
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
      graphql: { GraphQLID, GraphQLList, GraphQLNonNull },
    } = build;
    const {
      scope: {
        isPgCondition,
        isPgRowType,
        isInputType,
        isPgPatch,
        isPgBaseInput,
        pgIntrospection,
      },
      fieldWithHooks,
    } = context;

    const table: PgClass = pgIntrospection;

    if (
      !isPgCondition && (
        !isPgRowType ||
        !(isInputType || isPgPatch || isPgBaseInput)
      ) ||
      !table ||
      table.kind !== "class"
    ) {
      return fields;
    }

    return getNodeIdRelations(table, build, {
      isPgBaseInput,
      isPgCondition,
      isPgPatch,
    }).reduce((memo, fk) =>
      extend(memo, {
        [fk.fieldName]: fieldWithHooks(
          fk.fieldName,
          {
            description: `The globally unique \`ID\` to be used in ${isPgCondition ? 'selecting' : 'specifying'} a single \`${fk.TableType.name}\`.`,
            type: isPgCondition ? new GraphQLList(new GraphQLNonNull(GraphQLID)) : GraphQLID,
          },
          {
            pgFieldIntrospection: fk.constraint,
            isPgForeignKeyNodeIdField: true,
          }
        ),
      })
    , fields);
  });

  builder.hook("GraphQLObjectType:fields:field:args", function AddConditionArgsGenerators(
    args,
    build,
    context
  ) {
    const {
      scope: {
        isPgFieldConnection,
        pgFieldIntrospection: procOrTable,
        pgFieldIntrospectionTable: tableIfProc,
      },
      addArgDataGenerator,
    } = context;

    const table: PgClass = tableIfProc || procOrTable;

    if (!isPgFieldConnection || !table || table.kind !== "class") {
      return args;
    }

    const foreignKeys = getNodeIdRelations(table, build);

    addArgDataGenerator(function({ condition }: any) {
      return {
        pgQuery: (queryBuilder: QueryBuilder) => {
          if (condition != null) {
            foreignKeys.forEach(fk => fk.sqlWhere(condition[fk.fieldName], queryBuilder));
          }
        },
      };
    });

    return args;
  });


  // add deprecations
  builder.hook("GraphQLObjectType:fields:field", (field, build, context) => {
    const {
      scope: { pgFieldIntrospection },
    } = context;

    if (
      !pgFieldIntrospection ||
      !pgFieldIntrospection.class ||
      pgFieldIntrospection.kind !== "attribute"
    ) {
      return field;
    }

    const attr: PgAttribute = pgFieldIntrospection;
    const table = attr.class;

    if (containsSingleColumn(table.primaryKeyConstraint, attr)) {
      return maybeDeprecate(field, attr, "nodeId");
    }

    const fk = getNodeIdRelations(table, build).find(
      f => containsSingleColumn(f.constraint, attr)
    );

    if (fk) {
      return maybeDeprecate(field, attr, `${fk.fieldName}.nodeId`);
    }

    return field;
  });

  function maybeDeprecate<T extends GraphQLFieldConfig<any, any>>(
    field: T,
    attr: PgAttribute,
    preferredField: string
  ): T {
    const condition =
      typeof options.globalIdShouldDeprecate === "function"
        ? options.globalIdShouldDeprecate(attr)
        : options.globalIdShouldDeprecate;

    const deprecationReason =
      field.deprecationReason ||
      (typeof options.globalIdDeprecationReason === "function"
        ? options.globalIdDeprecationReason(preferredField)
        : options.globalIdDeprecationReason);

    return condition && deprecationReason
      ? { ...field, deprecationReason }
      : field;
  }
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
        inputOrPatchFieldName,
        foreignKeys: getNodeIdRelations(table, build),
      };
    },
    ({
      inputOrPatchFieldName,
      foreignKeys,
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

      for (const fk of foreignKeys) {
        const nodeId = obj[fk.fieldName];
        // We're no longer used, so clean us up
        delete obj[fk.fieldName];

        for (const relation of fk.fromNodeId(nodeId)) {
          for (const identifier of relation) {
            if (
              obj[identifier.fieldName] !== undefined &&
              obj[identifier.fieldName] !== identifier.value
            ) {
              throw new Error(
                "Cannot specify the individual keys and the relation nodeId with different values."
              );
            }
            obj[identifier.fieldName] = identifier.value;
          }
        }
      }

      return resolver(parent, newArgs, context, resolveInfo);
    }
  )
);

export default GlobalIdExtensionsPlugin;
