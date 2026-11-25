// Minimal typing for the parts of pg used here. @types/pg is not in docs/VERSIONS.md, so it is not added.
declare module "pg" {
  export interface QueryResult {
    rows: Record<string, unknown>[];
  }
  export class Client {
    constructor(config?: { connectionString?: string });
    connect(): Promise<void>;
    query(text: string, values?: unknown[]): Promise<QueryResult>;
    end(): Promise<void>;
  }
  const pg: { Client: typeof Client };
  export default pg;
}
