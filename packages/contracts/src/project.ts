import { z } from 'zod';
import { InputsSchema } from './intent';

/** A dotted path into a JSON record, "[]" marking an array: "total", "customer.card.last4", "lines[].product.title". */
const FieldPathSchema = z.string().regex(/^[A-Za-z_$][\w$]*(\[\])?(\.[A-Za-z_$][\w$]*(\[\])?)*$/, 'a field path like "total" or "items[].name"');

/**
 * Where one collection of the system of record is read, and how its records map onto the fields an oracle checks.
 * kind "http": the app's API (list and get paths). kind "browser-storage": an app with no server keeps its records in
 * the browser; the verifier reads localStorage[key] from the test's own browser page. Weaker than a server, but still the
 * app's real persistence, not what the page says.
 */
export const StoreConfigSchema = z
  .strictObject({
    kind: z.enum(['http', 'browser-storage']).default('http'),
    /** browser-storage only: the localStorage key the app saves under, e.g. "shopsphere-data". */
    key: z.string().min(1).optional(),
    /** null: the app's own origin. Otherwise the API's base URL, e.g. "https://api.example.com". */
    baseUrl: z.url().nullable().default(null),
    /** http only: path that lists the records, e.g. "/api/orders". */
    list: z.string().startsWith('/').optional(),
    /** http only: path that reads one record, with {id} where the id goes, e.g. "/api/orders/{id}". */
    get: z.string().startsWith('/').includes('{id}').optional(),
    /** Request headers; a value "env:NAME" is read from the environment at run time and never written anywhere. */
    headers: z.record(z.string(), z.string()).default({}),
    /** Where the list sits inside the response, e.g. "data.orders"; null when the response is the list itself. */
    recordsPath: FieldPathSchema.nullable().default(null),
    /** Paths in each record for the fields oracles check; the id is required, the rest only when the app has them. */
    fields: z
      .strictObject({
        id: FieldPathSchema.default('id'),
        items: FieldPathSchema.optional(),
        quantity: FieldPathSchema.optional(),
        total: FieldPathSchema.optional(),
        cardLast4: FieldPathSchema.optional(),
      })
      .default({ id: 'id' }),
  })
  .refine((store) => (store.kind === 'http' ? store.list !== undefined && store.get !== undefined : store.key !== undefined), {
    message: 'an http store needs "list" and "get"; a browser-storage store needs "key"',
  });
export type StoreConfig = z.infer<typeof StoreConfigSchema>;

/**
 * One app HackWave can verify, read from projects/<id>.json. The engine picks the project whose match covers the
 * target address, so a new app is added by adding its file; nothing in the code changes.
 */
export const ProjectSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'ids are lower-case words joined by hyphens'),
  name: z.string().min(1),
  /** Origins the app is served at; "*" stands for any port or any subdomain label, e.g. "http://localhost:*". */
  match: z.array(z.string().min(1)).min(1),
  /** The system of record, by the store name oracles use (state.store), e.g. { "orders": { ... } }. */
  stores: z.record(z.string().regex(/^[a-z][a-z0-9-]*$/), StoreConfigSchema),
  /**
   * The product list for goals typed in plain words: read from the app (list), or written here (items) for an app with
   * no catalogue API. null when the app sells nothing.
   */
  catalog: z
    .strictObject({
      list: z.string().startsWith('/').optional(),
      items: z.array(z.strictObject({ name: z.string().min(1), price: z.number().nonnegative() })).min(1).optional(),
      recordsPath: FieldPathSchema.nullable().default(null),
      name: FieldPathSchema.default('name'),
      price: FieldPathSchema.default('price'),
    })
    .refine((catalog) => catalog.list !== undefined || catalog.items !== undefined, 'a catalog needs "list" or "items"')
    .nullable()
    .default(null),
  /** Test data for goals typed in plain words on this app (names, emails, addresses); the AI only ever sees the keys. */
  inputs: InputsSchema.optional(),
});
export type Project = z.infer<typeof ProjectSchema>;
