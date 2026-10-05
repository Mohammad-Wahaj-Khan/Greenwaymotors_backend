"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PostgresIntrospector = void 0;
const kysely_1 = require("kysely");
const enum_collection_1 = require("../../enum-collection");
const introspector_1 = require("../../introspector");
const database_metadata_1 = require("../../metadata/database-metadata");
const table_matcher_1 = require("../../table-matcher");
class PostgresIntrospector extends introspector_1.Introspector {
    constructor(options) {
        super();
        this.options = {
            defaultSchemas: options?.defaultSchemas && options.defaultSchemas.length > 0
                ? options.defaultSchemas
                : ['public'],
            domains: options?.domains ?? true,
            partitions: options?.partitions,
        };
    }
    createDatabaseMetadata({ domains, enums, partitions, tables: rawTables, }) {
        const tables = rawTables
            .map((table) => {
            const columns = table.columns.map((column) => {
                const dataType = this.getRootType(column, domains);
                const enumValues = enums.get(`${column.dataTypeSchema ?? this.options.defaultSchemas}.${dataType}`);
                const isArray = dataType.startsWith('_');
                return {
                    comment: column.comment ?? null,
                    dataType: isArray ? dataType.slice(1) : dataType,
                    dataTypeSchema: column.dataTypeSchema,
                    enumValues,
                    hasDefaultValue: column.hasDefaultValue,
                    isArray,
                    isAutoIncrementing: column.isAutoIncrementing,
                    isNullable: column.isNullable,
                    name: column.name,
                };
            });
            const isPartition = partitions.some((partition) => {
                return (partition.schema === table.schema && partition.name === table.name);
            });
            return {
                columns,
                isPartition,
                isView: table.isView,
                name: table.name,
                schema: table.schema,
            };
        })
            .filter((table) => {
            return this.options.partitions ? true : !table.isPartition;
        });
        return new database_metadata_1.DatabaseMetadata({ enums, tables });
    }
    getRootType(column, domains) {
        const foundDomain = domains.find((domain) => {
            return (domain.typeName === column.dataType &&
                domain.typeSchema === column.dataTypeSchema);
        });
        return foundDomain?.rootType ?? column.dataType;
    }
    async introspect(options) {
        const [tables, domains, enums, partitions, materializedViews] = await Promise.all([
            this.getTables(options),
            this.introspectDomains(options.db),
            this.introspectEnums(options.db),
            this.introspectPartitions(options.db),
            this.introspectMaterializedViews(options),
        ]);
        const allTables = [...tables, ...materializedViews];
        return this.createDatabaseMetadata({
            enums,
            domains,
            partitions,
            tables: allTables,
        });
    }
    async introspectDomains(db) {
        if (!this.options.domains) {
            return [];
        }
        const result = await (0, kysely_1.sql) `
      with recursive domain_hierarchy as (
        select oid, typbasetype
        from pg_type
        where typtype = 'd'
        and 'information_schema'::regnamespace::oid <> typnamespace

        union all

        select dh.oid, t.typbasetype
        from domain_hierarchy as dh
        join pg_type as t ON t.oid = dh.typbasetype
      )

      select
        t.typname as "typeName",
        t.typnamespace::regnamespace::text as "typeSchema",
        bt.typname as "rootType"
      from domain_hierarchy as dh
      join pg_type as t on dh.oid = t.oid
      join pg_type as bt on dh.typbasetype = bt.oid
      where bt.typbasetype = 0;
    `.execute(db);
        return result.rows;
    }
    async introspectEnums(db) {
        const enums = new enum_collection_1.EnumCollection();
        const rows = await db
            .withoutPlugins()
            .selectFrom('pg_type as type')
            .innerJoin('pg_enum as enum', 'type.oid', 'enum.enumtypid')
            .innerJoin('pg_catalog.pg_namespace as namespace', 'namespace.oid', 'type.typnamespace')
            .select([
            'namespace.nspname as schemaName',
            'type.typname as enumName',
            'enum.enumlabel as enumValue',
        ])
            .execute();
        for (const row of rows) {
            enums.add(`${row.schemaName}.${row.enumName}`, row.enumValue);
        }
        return enums;
    }
    async introspectPartitions(db) {
        const result = await (0, kysely_1.sql) `
      select pg_namespace.nspname as schema, pg_class.relname as name
      from pg_inherits
      join pg_class on pg_inherits.inhrelid = pg_class.oid
      join pg_namespace on pg_namespace.oid = pg_class.relnamespace;
    `.execute(db);
        return result.rows;
    }
    async introspectMaterializedViews(options) {
        const db = options.db;
        const materializedViews = await db.withoutPlugins().executeQuery((0, kysely_1.sql) `
        select
          n.nspname as table_schema,
          c.relname as table_name,
          a.attname as column_name,
          a.attnum as ordinal_position,
          pg_get_expr(ad.adbin, ad.adrelid) as column_default,
          case when a.attnotnull then 'NO' else 'YES' end as is_nullable,
          t.typname as data_type,
          tn.nspname as udt_schema,
          t.typname as udt_name,
          col_description(c.oid, a.attnum) as column_comment
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        join pg_attribute a on a.attrelid = c.oid
        join pg_type t on t.oid = a.atttypid
        join pg_namespace tn on tn.oid = t.typnamespace
        left join pg_attrdef ad on ad.adrelid = c.oid and ad.adnum = a.attnum
        where c.relkind = 'm'
          and a.attnum > 0
          and not a.attisdropped
        order by n.nspname, c.relname, a.attnum;
      `.compile(db));
        const tableMap = new Map();
        for (const row of materializedViews.rows) {
            const tableKey = `${row.table_schema}.${row.table_name}`;
            let table = tableMap.get(tableKey);
            if (!table) {
                table = {
                    name: row.table_name,
                    schema: row.table_schema,
                    isView: true,
                    columns: [],
                };
                tableMap.set(tableKey, table);
            }
            const isAutoIncrementing = row.column_default?.includes('nextval') ?? false;
            table.columns.push({
                name: row.column_name,
                dataType: row.udt_name,
                dataTypeSchema: row.udt_schema,
                isNullable: row.is_nullable === 'YES',
                isAutoIncrementing,
                hasDefaultValue: row.column_default !== null,
                comment: row.column_comment ?? undefined,
            });
        }
        let tables = Array.from(tableMap.values());
        if (options.includePattern) {
            const tableMatcher = new table_matcher_1.TableMatcher(options.includePattern);
            tables = tables.filter(({ name, schema }) => tableMatcher.match(schema, name));
        }
        if (options.excludePattern) {
            const tableMatcher = new table_matcher_1.TableMatcher(options.excludePattern);
            tables = tables.filter(({ name, schema }) => !tableMatcher.match(schema, name));
        }
        return tables;
    }
}
exports.PostgresIntrospector = PostgresIntrospector;
//# sourceMappingURL=postgres-introspector.js.map