// prisma/seed-master-quota.ts
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const prisma = new PrismaClient();

function parseCSV(text: string) {
  const [headerLine, ...lines] = text.trim().split(/\r?\n/);
  const headers = headerLine.split(",");
  return lines.map((ln) => {
    const parts = ln.split(",");
    const rec: any = {};
    headers.forEach((h, i) => (rec[h.trim()] = (parts[i] ?? "").trim()));
    return rec;
  });
}

async function main() {
  const filePath = resolve(process.cwd(), "prisma", "master_users_quota.csv");
  const raw = readFileSync(filePath, "utf-8");
  const rows = parseCSV(raw);

  for (const r of rows) {
    const firstName = (r.first_name || "").trim();
    const lastName  = (r.last_name  || "").trim();
    const email     = (r.email      || "").toLowerCase();
    const quota     = Number(r.quota || 1);

    await prisma.masterUser.upsert({
      where: { email },
      update: { firstName, lastName, quota },
      create: { firstName, lastName, email, quota },
    });
  }
  console.log(`Seeded ${rows.length} master users.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
