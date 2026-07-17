import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../generated/client/client";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createDatabaseClient(connectionString: string) {
  if (!connectionString.startsWith("postgresql://") && !connectionString.startsWith("postgres://")) {
    throw new Error("DATABASE_URL must use the PostgreSQL protocol.");
  }

  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

export type DatabaseClient = ReturnType<typeof createDatabaseClient>;
export type TenantTransaction = Prisma.TransactionClient;

/**
 * Runs all application queries inside a transaction with PostgreSQL RLS tenant context.
 * Callers cannot use the unrestricted client within request handlers.
 */
export async function withTenant<T>(
  client: DatabaseClient,
  organizationId: string,
  operation: (transaction: TenantTransaction) => Promise<T>,
): Promise<T> {
  if (!uuidPattern.test(organizationId)) throw new Error("Invalid organization identifier.");

  return client.$transaction(async (transaction) => {
    await transaction.$executeRaw`SELECT set_config('app.current_organization_id', ${organizationId}, true)`;
    return operation(transaction);
  });
}

export { Prisma };
export * from "../generated/client/enums";
