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
exports.RegisterService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma.service");
let RegisterService = class RegisterService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async register(input) {
        const email = input.email.trim().toLowerCase();
        const { wa, eventId } = input;
        const mu = await this.prisma.masterUser.findUnique({ where: { email } });
        if (!mu) {
            throw new common_1.NotFoundException('Email tidak terdaftar pada master data');
        }
        const name = `${mu.firstName} ${mu.lastName}`.trim();
        const issuedRow = await this.prisma.$queryRaw `SELECT COUNT(*)::int AS count FROM "Ticket" WHERE "eventId" = ${eventId} AND "email" = ${email};`;
        const issued = issuedRow?.[0]?.count ?? 0;
        const remaining = mu.quota - issued;
        if (remaining <= 0) {
            const tickets = await this.prisma.ticket.findMany({
                where: {
                    eventId,
                },
                orderBy: { order: 'asc' },
                select: { code: true, order: true, status: true, },
            });
            const filtered = tickets.filter((t) => t.email === email);
            return {
                message: 'Kuota sudah habis untuk email ini',
                tickets: filtered,
                issued,
                quota: mu.quota,
                remaining: 0,
            };
        }
        const txResult = await this.prisma.$transaction(async (tx) => {
            const updated = await tx.$queryRaw `UPDATE "queue_counters" SET "nextOrder" = "nextOrder" + ${remaining} WHERE "eventId" = ${eventId} RETURNING "nextOrder";`;
            if (!updated?.[0]?.nextOrder) {
                throw new Error('QueueCounter belum di-seed untuk event ini');
            }
            const nextOrder = updated[0].nextOrder;
            const startOrder = nextOrder - remaining;
            const endOrder = nextOrder - 1;
            const rows = Array.from({ length: remaining }).map((_, i) => {
                const order = startOrder + i;
                const code = `AH-${order.toString().padStart(3, '0')}`;
                return {
                    code,
                    name,
                    email,
                    wa: wa ?? null,
                    status: client_1.TicketStatus.QUEUED,
                    order,
                    eventId,
                };
            });
            await tx.ticket.createMany({ data: rows, skipDuplicates: true });
            const created = await tx.ticket.findMany({
                where: {
                    eventId,
                    order: { gte: startOrder, lte: endOrder },
                },
                orderBy: { order: 'asc' },
                select: { code: true, order: true, status: true },
            });
            return { created, startOrder, endOrder };
        });
        const allForEmail = await this.prisma.$queryRaw `SELECT "code", "order", "status" FROM "Ticket" WHERE "eventId" = ${eventId} AND "email" = ${email} ORDER BY "order" ASC;`;
        return {
            message: `Berhasil alokasikan ${txResult.created.length} tiket`,
            tickets: allForEmail,
            issued: issued + txResult.created.length,
            quota: mu.quota,
            remaining: mu.quota - (issued + txResult.created.length),
            allocatedRange: { from: txResult.startOrder, to: txResult.endOrder },
        };
    }
};
exports.RegisterService = RegisterService;
exports.RegisterService = RegisterService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], RegisterService);
//# sourceMappingURL=register.service.js.map