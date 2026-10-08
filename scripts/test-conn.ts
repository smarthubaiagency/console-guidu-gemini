import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  try {
    const result = await prisma.$queryRaw<Array<{ current_user: string; current_database: string }>>`
      SELECT current_user, current_database()
    `;
    console.log("Prisma connected successfully via Supavisor pooler (6543):", result);
  } catch (error) {
    console.error("Prisma connection error:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
