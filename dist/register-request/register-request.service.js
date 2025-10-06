"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RegisterRequestService = void 0;
const common_1 = require("@nestjs/common");
const crypto_1 = require("crypto");
const prisma_service_1 = require("../prisma.service");
let RegisterRequestService = class RegisterRequestService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async getPoolRemaining(eventId) {
        const donate = await this.prisma.$queryRaw `
      SELECT COALESCE(SUM("amount"), 0)::int AS sum
      FROM "SurplusLedger"
      WHERE "eventId" = ${eventId} AND "type" = 'DONATE';
    `;
        const allocate = await this.prisma.$queryRaw `
      SELECT COALESCE(SUM("amount"), 0)::int AS sum
      FROM "SurplusLedger"
      WHERE "eventId" = ${eventId} AND "type" = 'ALLOCATE';
    `;
        return (donate?.[0]?.sum ?? 0) - (allocate?.[0]?.sum ?? 0);
    }
    async getPoolRemainingTx(tx, eventId) {
        const donate = await tx.$queryRaw `
      SELECT COALESCE(SUM("amount"), 0)::int AS sum
      FROM "SurplusLedger"
      WHERE "eventId" = ${eventId} AND "type" = 'DONATE';
    `;
        const allocate = await tx.$queryRaw `
      SELECT COALESCE(SUM("amount"), 0)::int AS sum
      FROM "SurplusLedger"
      WHERE "eventId" = ${eventId} AND "type" = 'ALLOCATE';
    `;
        return (donate?.[0]?.sum ?? 0) - (allocate?.[0]?.sum ?? 0);
    }
    async createRequest(input) {
        const eventId = input.eventId;
        const email = input.email.trim().toLowerCase();
        const name = input.name.trim();
        const wa = input.wa?.trim() ?? null;
        let source = input.source === 'GIMMICK' ? 'GIMMICK' : 'MASTER';
        const mu = await this.prisma.masterUser.findUnique({ where: { email } });
        if (!mu)
            source = input.source === 'GIMMICK' ? 'GIMMICK' : 'WALKIN';
        const issuedRow = await this.prisma.$queryRaw `
      SELECT COUNT(*)::int AS count
      FROM "Ticket"
      WHERE "eventId" = ${eventId} AND "email" = ${email};
    `;
        const issuedBefore = issuedRow?.[0]?.count ?? 0;
        const masterQuota = mu?.quota ?? 0;
        const quotaRemaining = Math.max(0, masterQuota - issuedBefore);
        const id = (0, crypto_1.randomUUID)();
        await this.prisma.$executeRaw `
      INSERT INTO "RegistrationRequest"
        ("id","eventId","email","name","wa","source","status","isMasterMatch","masterQuota","issuedBefore","createdAt","updatedAt")
      VALUES
        (${id}, ${eventId}, ${email}, ${name}, ${wa}, ${source}, 'PENDING', ${!!mu}, ${mu?.quota ?? null}, ${issuedBefore}, NOW(), NOW());
    `;
        const poolRemaining = await this.getPoolRemaining(eventId);
        return {
            ok: true,
            request: {
                id,
                eventId,
                email,
                name,
                wa,
                source,
                status: 'PENDING',
                isMasterMatch: !!mu,
                masterQuota,
                issuedBefore,
                quotaRemaining
            },
            poolRemaining
        };
    }
    async listPending(eventId) {
        const rows = await this.prisma.$queryRaw `
      SELECT "id","eventId","email","name","wa","source","status",
             "isMasterMatch","masterQuota","issuedBefore","createdAt"
      FROM "RegistrationRequest"
      WHERE "eventId" = ${eventId} AND "status" = 'PENDING'
      ORDER BY "createdAt" ASC;
    `;
        const pending = rows.map(it => {
            const masterQuota = it.masterQuota ?? 0;
            const issuedBefore = it.issuedBefore ?? 0;
            const quotaRemaining = Math.max(0, masterQuota - issuedBefore);
            return { ...it, quotaRemaining };
        });
        const poolRemaining = await this.getPoolRemaining(eventId);
        return { ok: true, eventId, poolRemaining, pending };
    }
    async confirm(input) {
        const { requestId } = input;
        const useCount = Number(input.useCount ?? 0);
        if (!requestId)
            throw new common_1.BadRequestException('requestId wajib diisi');
        if (!Number.isInteger(useCount) || useCount <= 0)
            throw new common_1.BadRequestException('useCount harus bilangan > 0');
        const result = await this.prisma.$transaction(async (tx) => {
            const reqRows = await tx.$queryRaw `
        SELECT "id","eventId","email","name","wa","source","status"
        FROM "RegistrationRequest"
        WHERE "id" = ${requestId}
        FOR UPDATE;
      `;
            const req = reqRows?.[0];
            if (!req)
                throw new common_1.NotFoundException('RegistrationRequest tidak ditemukan');
            if (req.status !== 'PENDING')
                throw new common_1.BadRequestException('Request sudah diproses');
            const { eventId, email, name, wa, source } = req;
            let donated = 0;
            let allocated = 0;
            if (source === 'MASTER') {
                const mu = await this.prisma.masterUser.findUnique({ where: { email } });
                if (!mu)
                    throw new common_1.BadRequestException('Email bukan MASTER saat dikonfirmasi');
                const issuedRow = await tx.$queryRaw `
          SELECT COUNT(*)::int AS count
          FROM "Ticket"
          WHERE "eventId" = ${eventId} AND "email" = ${email};
        `;
                const issued = issuedRow?.[0]?.count ?? 0;
                const remaining = mu.quota - issued;
                if (remaining <= 0)
                    throw new common_1.BadRequestException('Kuota MASTER sudah habis');
                if (useCount > remaining)
                    throw new common_1.BadRequestException(`Maksimal slot yang bisa dipakai: ${remaining}`);
                const updated = await tx.$queryRaw `
          UPDATE "queue_counters"
          SET "nextOrder" = "nextOrder" + ${useCount}
          WHERE "eventId" = ${eventId}
          RETURNING "nextOrder";
        `;
                const nextOrder = updated?.[0]?.nextOrder;
                if (!nextOrder)
                    throw new Error('QueueCounter belum di-seed untuk event ini');
                const startOrder = nextOrder - useCount;
                const endOrder = nextOrder - 1;
                for (let order = startOrder; order <= endOrder; order++) {
                    const code = `AH-${order.toString().padStart(3, '0')}`;
                    await tx.$executeRaw `
            INSERT INTO "Ticket" ("id","code","name","status","order","eventId","email","wa","createdAt","updatedAt")
            VALUES (${(0, crypto_1.randomUUID)()}, ${code}, ${name}, 'QUEUED', ${order}, ${eventId}, ${email}, ${wa}, NOW(), NOW())
            ON CONFLICT ("code") DO NOTHING;
          `;
                }
                const leftover = remaining - useCount;
                if (leftover > 0) {
                    await tx.$executeRaw `
            INSERT INTO "SurplusLedger" ("id","eventId","type","email","amount","refRequestId","createdAt")
            VALUES (${(0, crypto_1.randomUUID)()}, ${eventId}, 'DONATE', ${email}, ${leftover}, ${requestId}, NOW());
          `;
                    donated = leftover;
                }
            }
            else {
                const poolBefore = await this.getPoolRemainingTx(tx, eventId);
                if (poolBefore < useCount)
                    throw new common_1.BadRequestException(`Pool sisa tidak cukup. Tersedia: ${poolBefore}`);
                await tx.$executeRaw `
          INSERT INTO "SurplusLedger" ("id","eventId","type","email","amount","refRequestId","createdAt")
          VALUES (${(0, crypto_1.randomUUID)()}, ${eventId}, 'ALLOCATE', ${email}, ${useCount}, ${requestId}, NOW());
        `;
                allocated = useCount;
                const updated = await tx.$queryRaw `
          UPDATE "queue_counters"
          SET "nextOrder" = "nextOrder" + ${useCount}
          WHERE "eventId" = ${eventId}
          RETURNING "nextOrder";
        `;
                const nextOrder = updated?.[0]?.nextOrder;
                if (!nextOrder)
                    throw new Error('QueueCounter belum di-seed untuk event ini');
                const startOrder = nextOrder - useCount;
                const endOrder = nextOrder - 1;
                for (let order = startOrder; order <= endOrder; order++) {
                    const code = `AH-${order.toString().padStart(3, '0')}`;
                    await tx.$executeRaw `
            INSERT INTO "Ticket" ("id","code","name","status","order","eventId","email","wa","createdAt","updatedAt")
            VALUES (${(0, crypto_1.randomUUID)()}, ${code}, ${name}, 'QUEUED', ${order}, ${eventId}, ${email}, ${wa}, NOW(), NOW())
            ON CONFLICT ("code") DO NOTHING;
          `;
                }
            }
            await tx.$executeRaw `
        UPDATE "RegistrationRequest"
        SET "status" = 'CONFIRMED', "updatedAt" = NOW()
        WHERE "id" = ${requestId};
      `;
            const poolAfter = await this.getPoolRemainingTx(tx, eventId);
            const tickets = await tx.$queryRaw `
        SELECT "code","order","status"
        FROM "Ticket"
        WHERE "eventId" = ${eventId} AND "email" = ${email}
        ORDER BY "order" ASC;
      `;
            return { eventId, email, tickets, donated, allocated, poolAfter, requestId };
        });
        return { ok: true, ...result };
    }
};
exports.RegisterRequestService = RegisterRequestService;
exports.RegisterRequestService = RegisterRequestService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], RegisterRequestService);
//# sourceMappingURL=register-request.service.js.map